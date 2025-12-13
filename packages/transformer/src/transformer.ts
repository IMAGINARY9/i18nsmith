import fs from 'fs';
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
  Scanner,
  ScannerNodeCandidate,
  generateValueFromKey,
} from '@i18nsmith/core';
import {
  detectExistingTranslationImport,
  ensureClientDirective,
  ensureUseTranslationBinding,
  ensureUseTranslationImport,
  findNearestFunctionScope,
} from './react-adapter.js';
import { formatFileWithPrettier } from './formatting.js';
import {
  CandidateStatus,
  FileTransformRecord,
  TransformCandidate,
  TransformProgress,
  TransformRunOptions,
  TransformSummary,
  TransformerOptions,
} from './types.js';

interface InternalCandidate extends TransformCandidate {
  raw: ScannerNodeCandidate;
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
  // Per-run dedupe state. Must be cleared at the beginning of each run.
  // Keeping it on the instance caused subsequent runs to mislabel candidates as duplicates
  // and could lead to confusing multi-pass behavior/reporting.
  private readonly seenHashes = new Map<string, string>();
  private readonly translationAdapter: { module: string; hookName: string };

  constructor(private readonly config: I18nConfig, options: TransformerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
  this.project = options.project ?? new Project({ skipAddingFilesFromTsConfig: true });
  const namespace = options.keyNamespace ?? this.config.keyGeneration?.namespace ?? 'common';
  this.keyGenerator = options.keyGenerator ?? new KeyGenerator({ namespace, hashLength: this.config.keyGeneration?.shortHashLen ?? 6 });
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
      for (const locale of [this.sourceLocale, ...this.targetLocales]) {
        originalLocaleData.set(locale, await this.localeStore.get(locale));
      }
    }

    const scanner = new Scanner(this.config, {
      workspaceRoot: this.workspaceRoot,
      project: this.project,
    });
    const summary = scanner.scan({
      collectNodes: true,
      targets: runOptions.targets,
      scanCalls: runOptions.migrateTextKeys,
    });

    const enriched = await this.enrichCandidates(summary.detailedCandidates);
    const transformableCandidates = enriched.filter(
      (candidate) => candidate.status === 'pending' || candidate.status === 'existing'
    );

    const filesChanged = new Map<string, SourceFile>();
    const skippedFiles: FileTransformRecord[] = [];

    const shouldProcess = write || generateDiffs;
    const enableProgress = Boolean(write && runOptions.onProgress && transformableCandidates.length > 0);
    const progressState = {
      processed: 0,
      applied: 0,
      skipped: 0,
      errors: 0,
      total: transformableCandidates.length,
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

    if (shouldProcess) {
      // Track detected imports per file to avoid redundant detection
      const fileImportCache = new Map<string, { module: string; hookName: string }>();

      for (const candidate of enriched) {
        // Process both 'pending' (new) and 'existing' (key exists but code not transformed) candidates
        if (candidate.status !== 'pending' && candidate.status !== 'existing') {
          continue;
        }

        progressState.processed += 1;
        let skipCounted = false;

        // Track original status to determine if we need to upsert locale data
        const wasExisting = candidate.status === 'existing';

        try {
          const sourceFile = candidate.raw.sourceFile;
          const filePath = candidate.filePath;

          // Determine which adapter to use for this file
          let adapterForFile = this.translationAdapter;

          // Check if we've already detected an import for this file
          if (!fileImportCache.has(filePath)) {
            const detected = detectExistingTranslationImport(sourceFile);
            if (detected) {
              fileImportCache.set(filePath, {
                module: detected.moduleSpecifier,
                hookName: detected.namedImport,
              });
            }
          }

          const cachedAdapter = fileImportCache.get(filePath);
          if (cachedAdapter) {
            adapterForFile = cachedAdapter;
          }
          
          if (write) {
            // Convert absolute module path to relative path for the source file
            const relativeModulePath = this.getRelativeModulePath(adapterForFile.module, filePath);
            ensureUseTranslationImport(sourceFile, {
              moduleSpecifier: relativeModulePath,
              namedImport: adapterForFile.hookName,
            });
          }

          const scope = findNearestFunctionScope(candidate.raw.node);
          if (!scope) {
            candidate.status = 'skipped';
            candidate.reason = 'No React component/function scope found';
            skippedFiles.push({ filePath: candidate.filePath, reason: candidate.reason });
            progressState.skipped += 1;
            skipCounted = true;
            emitProgress();
            continue;
          }

          if (write) {
            ensureUseTranslationBinding(scope, adapterForFile.hookName);
            ensureClientDirective(sourceFile);
            this.applyCandidate(candidate);
            candidate.status = 'applied';
            filesChanged.set(candidate.filePath, sourceFile);
            progressState.applied += 1;
          }

          // Only upsert to locale store if this is a new key (wasExisting = false)
          if (!wasExisting) {
            const sourceValue =
              (await this.findLegacyLocaleValue(this.sourceLocale, candidate.text)) ??
              candidate.text ??
              generateValueFromKey(candidate.suggestedKey);
            await this.localeStore.upsert(this.sourceLocale, candidate.suggestedKey, sourceValue);
            
            const shouldMigrate = this.config.seedTargetLocales || runOptions.migrateTextKeys;
            if (shouldMigrate) {
              for (const locale of this.targetLocales) {
                const legacyValue = await this.findLegacyLocaleValue(locale, candidate.text);
                await this.localeStore.upsert(locale, candidate.suggestedKey, legacyValue ?? '');
              }
            }
          }
        } catch (error) {
          candidate.status = 'skipped';
          candidate.reason = (error as Error).message;
          skippedFiles.push({ filePath: candidate.filePath, reason: candidate.reason });
          progressState.skipped += 1;
          progressState.errors += 1;
          skipCounted = true;
        }

        if (candidate.status === 'skipped' && !skipCounted) {
          progressState.skipped += 1;
          skipCounted = true;
        }

        emitProgress();
      }

      if (write) {
        const changedFiles = Array.from(filesChanged.values());

        await Promise.all(
          changedFiles.map(async (file) => {
            await file.save();
            await formatFileWithPrettier(file.getFilePath());
          })
        );

        // Important for iterative runs: ts-morph keeps SourceFile ASTs in memory.
        // After we mutate+format on disk, the in-memory AST can drift from disk,
        // which can cause the next scan to see a different shape and produce new
        // candidates in waves. Refresh ensures scan always reflects the current file.
        for (const file of changedFiles) {
          try {
            file.refreshFromFileSystemSync();
          } catch {
            // Best-effort refresh; ignore if file was removed or inaccessible.
          }
        }
      }
    }

    const localeStats = write ? await this.localeStore.flush() : [];
    
    const diffs = generateDiffs
      ? await this.generateDiffs(originalLocaleData)
      : [];

    return {
      filesScanned: summary.filesScanned,
      filesChanged: Array.from(filesChanged.keys()),
      candidates: enriched.map(({ raw: _raw, ...rest }) => rest),
      localeStats,
      diffs,
      skippedFiles,
      write,
    };
  }

  private async generateDiffs(originalData: Map<string, Record<string, string>>) {
    const projectedData = new Map<string, Record<string, string>>();
    for (const locale of [this.sourceLocale, ...this.targetLocales]) {
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
    if (!fs.existsSync(pkgPath)) {
      return;
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
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

  private async enrichCandidates(nodes: ScannerNodeCandidate[]): Promise<InternalCandidate[]> {
    const result: InternalCandidate[] = [];

    for (const candidate of nodes) {
      const generated = this.keyGenerator.generate(candidate.text, this.buildContext(candidate));
      let status: CandidateStatus = 'pending';
      let reason: string | undefined;

  // Extract only serializable fields from ScannerNodeCandidate (exclude node, sourceFile)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { node, sourceFile, ...serializableCandidate } = candidate;

      // Pre-flight validation: check if generated key is suspicious
      const validation = this.keyValidator.validate(generated.key, candidate.text);
      if (!validation.valid) {
        status = 'skipped';
        reason = validation.suggestion ?? `Suspicious key: ${validation.reason}`;
        result.push({
          ...serializableCandidate,
          suggestedKey: generated.key,
          hash: generated.hash,
          status,
          reason,
          raw: candidate,
        });
        continue;
      }

      if (this.seenHashes.has(generated.hash)) {
        status = 'duplicate';
        reason = `Duplicate of ${this.seenHashes.get(generated.hash)}`;
      } else {
        this.seenHashes.set(generated.hash, candidate.id);
        const existing = await this.localeStore.getValue(this.sourceLocale, generated.key);
        if (existing) {
          status = 'existing';
        }
      }

      result.push({
        ...serializableCandidate,
        suggestedKey: generated.key,
        hash: generated.hash,
        status,
        reason,
        raw: candidate,
      });
    }

    return result;
  }

  private buildContext(candidate: ScannerNodeCandidate): KeyGenerationContext {
    return {
      filePath: path.resolve(this.workspaceRoot, candidate.filePath),
      kind: candidate.kind,
      context: candidate.context,
    };
  }

  private applyCandidate(candidate: InternalCandidate) {
    const node = candidate.raw.node;
    const keyCall = `t('${candidate.suggestedKey}')`;

    if (candidate.kind === 'jsx-text') {
      if (!Node.isJsxText(node)) {
        throw new Error('Candidate node mismatch for jsx-text');
      }
      node.replaceWithText(`{${keyCall}}`);
      return;
    }

    if (candidate.kind === 'jsx-attribute') {
      if (!Node.isJsxAttribute(node)) {
        throw new Error('Candidate node mismatch for jsx-attribute');
      }
      node.setInitializer(`{${keyCall}}`);
      return;
    }

    if (candidate.kind === 'jsx-expression') {
      if (!Node.isJsxExpression(node)) {
        throw new Error('Candidate node mismatch for jsx-expression');
      }
      const expression = node.getExpression();
      if (expression) {
        expression.replaceWithText(keyCall);
      } else {
        node.replaceWithText(`{${keyCall}}`);
      }
      return;
    }

    if (candidate.kind === 'call-expression') {
      if (!Node.isCallExpression(node)) {
        throw new Error('Candidate node mismatch for call-expression');
      }
      const [arg] = node.getArguments();
      if (arg && Node.isStringLiteral(arg)) {
        arg.replaceWithText(`'${candidate.suggestedKey}'`);
      }
      return;
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
}
