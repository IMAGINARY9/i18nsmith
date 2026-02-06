import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import {
  Node,
  Project,
  SourceFile,
} from 'ts-morph';
import {
  buildLocaleDiffs,
  I18nConfig,
  KeyGenerationContext,
  KeyGenerator,
  KeyValidator,
  LocaleStore,
  ScanCandidate,
  Scanner,
  ScannerNodeCandidate,
  SourceFileDiffEntry,
  generateValueFromKey,
  AdapterRegistry,
  ReactAdapter,
  VueAdapter,
  FrameworkAdapter,
  AdapterDependencyCheck,
} from '@i18nsmith/core';
import { DEFAULT_TRANSLATABLE_ATTRIBUTES } from '@i18nsmith/core';
import {
  CandidateStatus,
  FileTransformRecord,
  TransformCandidate,
  TransformProgress,
  TransformRunOptions,
  TransformSummary,
  TransformerOptions,
} from './types.js';
import { formatFileWithPrettier } from './formatting.js';

interface InternalCandidate extends TransformCandidate {
  raw: ScannerNodeCandidate;
}

interface ProgressState {
  processed: number;
  applied: number;
  skipped: number;
  errors: number;
  total: number;
}

export class Transformer {
  private readonly workspaceRoot: string;
  private readonly project: Project;
  private readonly keyGenerator: KeyGenerator;
  private readonly keyValidator: KeyValidator;
  private readonly localeStore: LocaleStore;
  private readonly defaultWrite: boolean;
  private readonly sourceLocale: string;
  private readonly targetLocales: string[];
  private readonly usesExternalProject: boolean;
  // Per-run dedupe state. Must be cleared at the beginning of each run.
  // Keeping it on the instance caused subsequent runs to mislabel candidates as duplicates
  // and could lead to confusing multi-pass behavior/reporting.
  private readonly seenHashes = new Map<string, string>();
  private readonly translationAdapter: { module: string; hookName: string };
  private readonly registry: AdapterRegistry;

  constructor(private readonly config: I18nConfig, options: TransformerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
  this.usesExternalProject = Boolean(options.project);
  this.project = options.project ?? new Project({ skipAddingFilesFromTsConfig: true });
  const namespace = options.keyNamespace ?? this.config.keyGeneration?.namespace ?? 'common';
  this.keyGenerator =
    options.keyGenerator ??
    new KeyGenerator({
      namespace,
      hashLength: this.config.keyGeneration?.shortHashLen ?? 6,
      workspaceRoot: this.workspaceRoot,
    });
  this.keyValidator = new KeyValidator(this.config.sync?.suspiciousKeyPolicy ?? 'skip');
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
  const localeStoreOptions = {
    format: config.locales?.format ?? 'auto',
    delimiter: config.locales?.delimiter ?? '.',
    sortKeys: config.locales?.sortKeys ?? 'alphabetical',
  };
  this.localeStore = options.localeStore ?? new LocaleStore(localesDir, localeStoreOptions);
  this.defaultWrite = options.write ?? false;
    this.sourceLocale = config.sourceLanguage ?? 'en';
    this.targetLocales = (config.targetLanguages ?? []).filter(Boolean);
    this.translationAdapter = this.normalizeTranslationAdapter(config.translationAdapter);
    this.registry = new AdapterRegistry();
    this.registry.register(new ReactAdapter(this.config, this.workspaceRoot));
    this.registry.register(new VueAdapter(this.config, this.workspaceRoot));
  }





  public async run(runOptions: TransformRunOptions = {}): Promise<TransformSummary> {
    // Reset per-run state
    this.seenHashes.clear();

    const write = runOptions.write ?? this.defaultWrite;
    const generateDiffs = runOptions.diff ?? false;

    if (write) {
      this.checkDependencies();
    }

    const originalLocaleData = new Map<string, Record<string, string>>();
    if (generateDiffs) {
      const storedLocales = await this.localeStore.getStoredLocales();
      const allLocales = new Set([this.sourceLocale, ...this.targetLocales, ...storedLocales]);
      for (const locale of allLocales) {
        originalLocaleData.set(locale, await this.localeStore.get(locale));
      }
    }

    const normalizedTargets = Array.isArray(runOptions.targets) && runOptions.targets.length
      ? runOptions.targets.map((t) => this.normalizeTargetPath(t))
      : undefined;

    const scanner = new Scanner(this.config, {
      workspaceRoot: this.workspaceRoot,
      project: this.project,
    });
    const scanSummary = scanner.scan({
      targets: normalizedTargets,
      scanCalls: runOptions.migrateTextKeys,
    });

    const preparedCandidates = await this.prepareCandidates(scanSummary.candidates);
    const sourceDiffs: SourceFileDiffEntry[] = [];
    const changedFiles = new Set<string>();
    const skippedFiles: FileTransformRecord[] = [];

    const shouldProcess = write || generateDiffs;
    const allTargetLocales = new Set(this.targetLocales);
    if (shouldProcess) {
      const stored = await this.localeStore.getStoredLocales();
      stored.forEach((l) => allTargetLocales.add(l));
      allTargetLocales.delete(this.sourceLocale);
    }

    const transformableByFile = new Map<string, TransformCandidate[]>();
    for (const candidate of preparedCandidates) {
      if (candidate.status !== 'pending' && candidate.status !== 'existing') {
        continue;
      }
      const list = transformableByFile.get(candidate.filePath) ?? [];
      list.push(candidate);
      transformableByFile.set(candidate.filePath, list);
    }

    const totalTransformable = Array.from(transformableByFile.values()).reduce((sum, list) => sum + list.length, 0);
    const enableProgress = Boolean(write && runOptions.onProgress && totalTransformable > 0);
    const progressState = {
      processed: 0,
      applied: 0,
      skipped: 0,
      errors: 0,
      total: totalTransformable,
    };

    const emitProgress = () => {
      if (!enableProgress || !runOptions.onProgress) {
        return;
      }
      const percent = progressState.total === 0
        ? 100
        : Math.min(100, Math.round((progressState.processed / progressState.total) * 100));
      const payload: TransformProgress = {
        stage: 'apply',
        processed: progressState.processed,
        total: progressState.total,
        percent,
        applied: progressState.applied,
        skipped: progressState.skipped,
        remaining: Math.max(progressState.total - progressState.processed, 0),
        errors: progressState.errors,
        message: 'Applying transformations',
      };
      runOptions.onProgress(payload);
    };

    emitProgress();

    if (shouldProcess && transformableByFile.size > 0) {
      const fileImportCache = new Map<string, { module: string; hookName: string }>();

      // Preflight check: validate all adapter dependencies before processing
      const adaptersToCheck = new Set<FrameworkAdapter>();
      for (const [relativePath] of transformableByFile.entries()) {
        const filePath = this.normalizeTargetPath(relativePath);
        const adapter = this.registry.getForFile(filePath);
        if (adapter) {
          adaptersToCheck.add(adapter);
        }
      }

      const allFailedDeps: Array<{ adapter: string; deps: AdapterDependencyCheck[] }> = [];
      for (const adapter of adaptersToCheck) {
        const dependencyChecks = adapter.checkDependencies();
        const failedDeps = dependencyChecks.filter(dep => !dep.available);
        if (failedDeps.length > 0) {
          allFailedDeps.push({ adapter: adapter.name, deps: failedDeps });
        }
      }

      if (allFailedDeps.length > 0) {
        const errorMessages = allFailedDeps.map(({ adapter, deps }) => {
          const depMessages = deps.map(dep => `  - ${dep.name}: ${dep.installHint || 'Install required dependency'}`);
          return `Adapter "${adapter}" has missing dependencies:\n${depMessages.join('\n')}`;
        });
        throw new Error(`Preflight check failed:\n${errorMessages.join('\n\n')}`);
      }

      for (const [relativePath, plans] of transformableByFile.entries()) {
        const filePath = this.normalizeTargetPath(relativePath);
        const adapter = this.registry.getForFile(filePath);

        if (!adapter) {
          const reason = `No adapter available for file type: ${relativePath}`;
          for (const plan of plans) {
            progressState.processed += 1;
            plan.status = 'skipped';
            plan.reason = reason;
            skippedFiles.push({ filePath: plan.filePath, reason });
            progressState.skipped += 1;
            progressState.errors += 1;
            emitProgress();
          }
          continue;
        }

        // Check adapter dependencies
        const dependencyChecks = adapter.checkDependencies();
        const failedDeps = dependencyChecks.filter(dep => !dep.available);
        if (failedDeps.length > 0) {
          const reason = `Missing dependencies: ${failedDeps.map(dep => dep.name).join(', ')}`;
          for (const plan of plans) {
            progressState.processed += 1;
            plan.status = 'skipped';
            plan.reason = reason;
            skippedFiles.push({ filePath: plan.filePath, reason });
            progressState.skipped += 1;
            progressState.errors += 1;
            emitProgress();
          }
          continue;
        }

        // Use adapter to mutate the file
        const content = await fs.readFile(filePath, 'utf-8');
        const result = adapter.mutate(filePath, content, plans, {
          config: this.config,
          workspaceRoot: this.workspaceRoot,
          translationAdapter: this.translationAdapter,
        });

        if (result.didMutate) {
          if (write) {
            await fs.writeFile(filePath, result.content, 'utf-8');
            await formatFileWithPrettier(filePath);
            changedFiles.add(filePath);
          }

          // Mark all plans as applied
          for (const plan of plans) {
            progressState.processed += 1;
            progressState.applied += 1;
            plan.status = 'applied';
            emitProgress();
          }

          // Handle diffs if needed
          if (generateDiffs && result.edits.length > 0) {
            // Generate source diffs from adapter edits
            // This would need to be implemented based on result.edits
          }
        } else {
          // No mutations applied
          for (const plan of plans) {
            progressState.processed += 1;
            plan.status = 'skipped';
            plan.reason = 'No mutations applied by adapter';
            skippedFiles.push({ filePath: plan.filePath, reason: 'No mutations applied by adapter' });
            progressState.skipped += 1;
            emitProgress();
          }
        }

        // Locale store upserts — identical for all frameworks
        for (const plan of plans) {
          if (plan.status === 'applied') {
            const sourceValue =
              (await this.findLegacyLocaleValue(this.sourceLocale, plan.text)) ??
              plan.text ??
              generateValueFromKey(plan.suggestedKey);
            await this.localeStore.upsert(this.sourceLocale, plan.suggestedKey, sourceValue);

            const shouldMigrate = this.config.seedTargetLocales || runOptions.migrateTextKeys;
            if (shouldMigrate) {
              const allTargetLocales = new Set(this.targetLocales);
              const stored = await this.localeStore.getStoredLocales();
              stored.forEach((l) => allTargetLocales.add(l));
              allTargetLocales.delete(this.sourceLocale);
              for (const locale of allTargetLocales) {
                const legacyValue = await this.findLegacyLocaleValue(locale, plan.text);
                await this.localeStore.upsert(locale, plan.suggestedKey, legacyValue ?? '');
              }
            }
          }
        }
      }
    }

    const localeStats = write ? await this.localeStore.flush() : [];
    
    const diffs = generateDiffs
      ? await this.generateDiffs(originalLocaleData)
      : [];

    const candidateStats = preparedCandidates.reduce(
      (acc, candidate) => {
        acc.total += 1;
        acc[candidate.status] += 1;
        return acc;
      },
      {
        total: 0,
        pending: 0,
        existing: 0,
        duplicate: 0,
        applied: 0,
        skipped: 0,
      }
    );

    const skippedReasons = preparedCandidates.reduce<Record<string, number>>((acc, candidate) => {
      if (candidate.status !== 'skipped') {
        return acc;
      }
      const reason = candidate.reason ?? 'unknown';
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});

    return {
      filesScanned: scanSummary.filesScanned,
      filesChanged: Array.from(changedFiles),
      candidates: preparedCandidates,
      candidateStats,
      skippedReasons: Object.keys(skippedReasons).length ? skippedReasons : undefined,
      localeStats,
      diffs,
      sourceDiffs,
      skippedFiles,
      write,
    };
  }

  private normalizeTargetPath(target: string): string {
    if (!target) {
      return target;
    }
    // Scanner resolves targets via fast-glob using workspace-root-based patterns.
    // Returning an absolute path prevents accidental scanning when a relative path
    // bypasses exclude globs in some host setups.
    return path.isAbsolute(target) ? target : path.join(this.workspaceRoot, target);
  }

  private async generateDiffs(originalData: Map<string, Record<string, string>>) {
    const projectedData = new Map<string, Record<string, string>>();
    const storedLocales = await this.localeStore.getStoredLocales();
    const allLocales = new Set([this.sourceLocale, ...this.targetLocales, ...storedLocales]);
    for (const locale of allLocales) {
      projectedData.set(locale, await this.localeStore.get(locale));
    }

    return buildLocaleDiffs(
      originalData,
      projectedData,
      (locale) => this.localeStore.getFilePath(locale),
      this.workspaceRoot
    );
  }

  /**
   * Known adapter module -> required dependencies mapping.
   * Only warn about dependencies for known adapters.
   */
  private static readonly ADAPTER_DEPENDENCIES: Record<string, string[]> = {
    'react-i18next': ['react-i18next', 'i18next'],
    'next-intl': ['next-intl'],
    'vue-i18n': ['vue-i18n'],
    '@lingui/react': ['@lingui/core', '@lingui/react'],
  };

  private checkDependencies() {
    const requiredDeps = Transformer.ADAPTER_DEPENDENCIES[this.translationAdapter.module];
    
    // Skip dependency check for unknown/custom adapters
    if (!requiredDeps) {
      return;
    }

    const pkgPath = path.resolve(this.workspaceRoot, 'package.json');
    if (!existsSync(pkgPath)) {
      return;
    }

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const missing = requiredDeps.filter((dep) => !deps[dep]);

      if (missing.length) {
        const installCmd = missing.join(' ');
        console.warn(
          `\n⚠️  Warning: ${missing.join(' & ')} missing from package.json.\n` +
          `   The ${this.translationAdapter.module} adapter requires them. Install with:\n` +
          `   npm install ${installCmd} --save\n`
        );
      }
    } catch (e) {
      // Ignore errors reading package.json
    }
  }

  private async prepareCandidates(candidates: ScanCandidate[]): Promise<TransformCandidate[]> {
    const result: TransformCandidate[] = [];

    for (const candidate of candidates) {
      const generated = this.keyGenerator.generate(candidate.text, this.buildContext(candidate));
      let status: CandidateStatus = 'pending';
      let reason: string | undefined;
      let suggestedKey = generated.key;

      // Check for path collisions with existing keys
      let collision = await this.localeStore.checkKeyCollision(this.sourceLocale, suggestedKey);
      let attempts = 0;
      while (collision && attempts < 5) {
        attempts++;
        // Resolve collision by appending suffix
        if (collision === 'parent-is-leaf') {
          // e.g. 'a.b' exists, trying to add 'a.b.c' -> 'a.b_c'
          // Try to flatten the last segment separator
          const lastDot = suggestedKey.lastIndexOf('.');
          if (lastDot !== -1) {
            suggestedKey = suggestedKey.substring(0, lastDot) + '_' + suggestedKey.substring(lastDot + 1);
          } else {
            suggestedKey = `${suggestedKey}_${attempts}`;
          }
        } else {
          // e.g. 'a.b.c.d' exists, trying to add 'a.b.c' -> 'a.b.c_text'
          suggestedKey = `${suggestedKey}_text`;
        }
        collision = await this.localeStore.checkKeyCollision(this.sourceLocale, suggestedKey);
      }

      if (collision) {
        status = 'skipped';
        reason = `Key collision detected: ${collision}`;
      }

      // Pre-flight validation: check if generated key is suspicious
      const validation = this.keyValidator.validate(suggestedKey, candidate.text);
      if (!validation.valid) {
        status = 'skipped';
        reason = validation.suggestion ?? `Suspicious key: ${validation.reason}`;
        result.push({
          ...candidate,
          suggestedKey,
          hash: generated.hash,
          status,
          reason,
        });
        continue;
      }

      if (this.seenHashes.has(generated.hash)) {
        status = 'duplicate';
        reason = `Duplicate of ${this.seenHashes.get(generated.hash)}`;
      } else {
        this.seenHashes.set(generated.hash, candidate.id);
        const existing = await this.localeStore.getValue(this.sourceLocale, suggestedKey);
        if (existing) {
          status = 'existing';
        }
      }

      result.push({
        ...candidate,
        suggestedKey,
        hash: generated.hash,
        status,
        reason,
      });
    }

    return result;
  }

  private buildContext(candidate: ScanCandidate): KeyGenerationContext {
    return {
      filePath: path.resolve(this.workspaceRoot, candidate.filePath),
      kind: candidate.kind,
      context: candidate.context,
    };
  }

  /**
   * Option A guardrail (docs/extraction-edge-cases.md):
   * reject JSX expressions that look like pluralization/concatenation logic.
   *
   * We skip these because they typically require manual i18n logic
   * (plural rules, ICU messages, or separate keys) and naive replacement would
   * produce awkward seed values like "item(s)".
   */
  private getUnsafeJsxExpressionReason(node: Node): string | undefined {
    // Unwrap common wrappers so we can inspect the actual expression.
    let current: Node = node;
    while (
      Node.isParenthesizedExpression(current) ||
      Node.isAsExpression(current) ||
      Node.isNonNullExpression(current) ||
      Node.isTypeAssertion(current)
    ) {
      current = current.getExpression();
    }

    if (!Node.isJsxExpression(current)) {
      return undefined;
    }

    const expr = current.getExpression();
    if (!expr) {
      return undefined;
    }

    // `{'item' + (count === 1 ? '' : 's')}` or `{count === 1 ? 'item' : 'items'}`
    if (Node.isBinaryExpression(expr)) {
      const operator = expr.getOperatorToken().getText();
      if (operator === '+') {
        // Most JSX string concatenation for pluralization ends up here.
        if (this.containsConditionalOrLogical(expr.getLeft()) || this.containsConditionalOrLogical(expr.getRight())) {
          return 'Pluralization/concatenation expression detected (manual review required)';
        }
      }
    }

    if (Node.isConditionalExpression(expr)) {
      // Often used for plural selection: `count === 1 ? 'item' : 'items'`
      return 'Conditional expression detected (pluralization/concat; manual review required)';
    }

    // Template strings are okay when they are simple interpolation, but if they
    // embed conditionals/logicals, it's likely pluralization.
    if (Node.isTemplateExpression(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
      if (this.containsConditionalOrLogical(expr)) {
        return 'Template expression with logic detected (manual review required)';
      }
    }

    return undefined;
  }

  private containsConditionalOrLogical(node: Node): boolean {
    if (Node.isConditionalExpression(node)) {
      return true;
    }
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getText();
      if (op === '||' || op === '&&' || op === '??') {
        return true;
      }
    }
    return node.forEachDescendant((d) => {
      if (Node.isConditionalExpression(d)) {
        return true;
      }
      if (Node.isBinaryExpression(d)) {
        const op = d.getOperatorToken().getText();
        if (op === '||' || op === '&&' || op === '??') {
          return true;
        }
      }
      return undefined;
    }) === true;
  }

  private applyCandidate(candidate: InternalCandidate): boolean {
    const node = candidate.raw.node;
    const keyCall = `t('${candidate.suggestedKey}')`;

    if (candidate.kind === 'jsx-text') {
      if (!Node.isJsxText(node)) {
        throw new Error('Candidate node mismatch for jsx-text');
      }
      const replacement = `{${keyCall}}`;
      if (node.getText() === replacement) {
        return false;
      }
      node.replaceWithText(replacement);
      return true;
    }

    if (candidate.kind === 'jsx-attribute') {
      if (!Node.isJsxAttribute(node)) {
        throw new Error('Candidate node mismatch for jsx-attribute');
      }

      const newInitializer = `{${keyCall}}`;
      const initializer = node.getInitializer();
      if (
        initializer &&
        this.normalizeTranslationSnippet(initializer.getText()) ===
          this.normalizeTranslationSnippet(newInitializer)
      ) {
        return false;
      }
      node.setInitializer(newInitializer);
      return true;
    }

    if (candidate.kind === 'jsx-expression') {
      if (!Node.isJsxExpression(node)) {
        throw new Error('Candidate node mismatch for jsx-expression');
      }

      // Guardrail (Option A): skip pluralization/concat expressions.
      const unsafeReason = this.getUnsafeJsxExpressionReason(node);
      if (unsafeReason) {
        candidate.status = 'skipped';
        candidate.reason = unsafeReason;
        return false;
      }

      // Guardrail: if this expression is used as a JSX attribute initializer,
      // only transform it when that attribute is in the Scanner allowlist.
      const parent = node.getParent();
      if (Node.isJsxAttribute(parent)) {
        const attributeName = parent.getNameNode().getText();
        if (!DEFAULT_TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
          candidate.status = 'skipped';
          candidate.reason = `Non-translatable attribute: ${attributeName}`;
          return false;
        }
      }

      const expression = node.getExpression();
      if (expression) {
        if (
          this.normalizeTranslationSnippet(expression.getText()) ===
          this.normalizeTranslationSnippet(keyCall)
        ) {
          return false;
        }
        expression.replaceWithText(keyCall);
        return true;
      }
      const wrapped = `{${keyCall}}`;
      if (
        this.normalizeTranslationSnippet(node.getText()) ===
        this.normalizeTranslationSnippet(wrapped)
      ) {
        return false;
      }
      node.replaceWithText(wrapped);
      return true;
    }

    if (candidate.kind === 'call-expression') {
      if (!Node.isCallExpression(node)) {
        throw new Error('Candidate node mismatch for call-expression');
      }
      const [arg] = node.getArguments();
      if (arg && Node.isStringLiteral(arg)) {
        if (arg.getLiteralText() === candidate.suggestedKey) {
          return false;
        }
        arg.replaceWithText(`'${candidate.suggestedKey}'`);
        return true;
      }
      return false;
    }

    throw new Error(`Unsupported candidate kind: ${candidate.kind}`);
  }

  private normalizeTranslationAdapter(
    adapter: I18nConfig['translationAdapter']
  ): { module: string; hookName: string } {
    const module = adapter?.module?.trim() || 'react-i18next';
    const hookName = adapter?.hookName?.trim() || 'useTranslation';
    return { module, hookName };
  }

  private async findLegacyLocaleValue(locale: string, rawKey: string): Promise<string | undefined> {
    const candidates = this.buildLegacyKeyCandidates(rawKey);
    for (const key of candidates) {
      const value = await this.localeStore.getValue(locale, key);
      if (typeof value !== 'undefined') {
        return value;
      }
    }
    return undefined;
  }

  private buildLegacyKeyCandidates(rawKey: string): string[] {
    const variants = new Set<string>();
    if (rawKey) {
      variants.add(rawKey);
      variants.add(rawKey.trim());
      variants.add(rawKey.replace(/\s+/g, ' ').trim());
    }
    return Array.from(variants).filter(Boolean);
  }

  private getRelativeModulePath(moduleSpecifier: string, sourceFilePath: string): string {
    // If it's an alias (starts with @/) or a package name (no ./ or /), return as is
    if (moduleSpecifier.startsWith('@/') || (!moduleSpecifier.startsWith('.') && !path.isAbsolute(moduleSpecifier))) {
      return moduleSpecifier;
    }

    // Convert the module path to absolute path (whether it starts with . or not)
    const absoluteModuleFullPath = path.isAbsolute(moduleSpecifier) 
      ? moduleSpecifier 
      : path.resolve(this.workspaceRoot, moduleSpecifier);
    
    // Convert to relative path from the source file's directory
    const sourceDir = path.dirname(sourceFilePath);
    const relativePath = path.relative(sourceDir, absoluteModuleFullPath);

    // Remove .tsx extension for imports
    const withoutExtension = relativePath.replace(/\.tsx?$/, '');
    
    // Ensure it starts with ./ for relative imports
    if (!withoutExtension.startsWith('.')) {
      return './' + withoutExtension;
    }

    return withoutExtension;
  }

  private normalizeTranslationSnippet(text: string): string {
    return text
      .replace(/\s+/g, '')
      .replace(/`/g, '\'')
      .replace(/"/g, '\'')
      .replace(/[{}]/g, '')
      .trim();
  }
}
