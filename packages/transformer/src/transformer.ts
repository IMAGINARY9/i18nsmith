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
  ensureUseTranslationBinding,
  ensureUseTranslationImport,
  findNearestFunctionScope,
} from './react-adapter.js';
import { formatFileWithPrettier } from './formatting.js';
import {
  CandidateStatus,
  FileTransformRecord,
  TransformCandidate,
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
  };
  this.localeStore = options.localeStore ?? new LocaleStore(localesDir, localeStoreOptions);
  this.defaultWrite = options.write ?? false;
    this.sourceLocale = config.sourceLanguage ?? 'en';
    this.targetLocales = (config.targetLanguages ?? []).filter(Boolean);
    this.translationAdapter = this.normalizeTranslationAdapter(config.translationAdapter);
  }

  public async run(runOptions: TransformRunOptions = {}): Promise<TransformSummary> {
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

    const filesChanged = new Map<string, SourceFile>();
    const skippedFiles: FileTransformRecord[] = [];

    const shouldProcess = write || generateDiffs;

    if (shouldProcess) {
      for (const candidate of enriched) {
        if (candidate.status !== 'pending') {
          continue;
        }

        try {
          const sourceFile = candidate.raw.sourceFile;
          
          if (write) {
            ensureUseTranslationImport(sourceFile, {
              moduleSpecifier: this.translationAdapter.module,
              namedImport: this.translationAdapter.hookName,
            });
          }

          const scope = findNearestFunctionScope(candidate.raw.node);
          if (!scope) {
            candidate.status = 'skipped';
            candidate.reason = 'No React component/function scope found';
            skippedFiles.push({ filePath: candidate.filePath, reason: candidate.reason });
            continue;
          }

          if (write) {
            ensureUseTranslationBinding(scope, this.translationAdapter.hookName);
            this.applyCandidate(candidate);
            candidate.status = 'applied';
            filesChanged.set(candidate.filePath, sourceFile);
          }

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
        } catch (error) {
          candidate.status = 'skipped';
          candidate.reason = (error as Error).message;
          skippedFiles.push({ filePath: candidate.filePath, reason: candidate.reason });
        }
      }

      if (write) {
        await Promise.all(
          Array.from(filesChanged.values()).map(async (file) => {
            await file.save();
            await formatFileWithPrettier(file.getFilePath());
          })
        );
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

  private checkDependencies() {
    if (this.translationAdapter.module !== 'react-i18next') {
      return;
    }

    const pkgPath = path.resolve(this.workspaceRoot, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return;
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const missing: string[] = [];
      if (!deps['react-i18next']) {
        missing.push('react-i18next');
      }
      if (!deps['i18next']) {
        missing.push('i18next');
      }

      if (missing.length) {
        console.warn(
          `\n⚠️  Warning: ${missing.join(' & ')} missing from package.json.\n` +
          '   The default adapter relies on them. Install both dependencies:\n' +
          '   npm install react-i18next i18next --save\n'
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
      const { node: _node, sourceFile: _sourceFile, ...serializableCandidate } = candidate;

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
}
