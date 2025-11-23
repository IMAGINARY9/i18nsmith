import path from 'path';
import {
  JsxAttribute,
  JsxExpression,
  JsxText,
  Node,
  Project,
  SourceFile,
} from 'ts-morph';
import {
  DetailedScanSummary,
  I18nConfig,
  KeyGenerationContext,
  KeyGenerator,
  LocaleStore,
  Scanner,
  ScannerNodeCandidate,
} from '@i18nsmith/core';
import {
  ensureUseTranslationBinding,
  ensureUseTranslationImport,
  findNearestFunctionScope,
} from './react-adapter.js';
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
  private readonly localeStore: LocaleStore;
  private readonly defaultWrite: boolean;
  private readonly sourceLocale: string;
  private readonly targetLocales: string[];
  private readonly seenHashes = new Map<string, string>();

  constructor(private readonly config: I18nConfig, options: TransformerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
  this.project = options.project ?? new Project({ skipAddingFilesFromTsConfig: true });
  const namespace = options.keyNamespace ?? this.configTranslationNamespace();
  this.keyGenerator = options.keyGenerator ?? new KeyGenerator({ namespace });
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
  this.localeStore = options.localeStore ?? new LocaleStore(localesDir);
  this.defaultWrite = options.write ?? false;
    this.sourceLocale = config.sourceLanguage ?? 'en';
    this.targetLocales = (config.targetLanguages ?? []).filter(Boolean);
  }

  public async run(runOptions: TransformRunOptions = {}): Promise<TransformSummary> {
    const write = runOptions.write ?? this.defaultWrite;

    const scanner = new Scanner(this.config, {
      workspaceRoot: this.workspaceRoot,
      project: this.project,
    });
  const summary = scanner.scan({ collectNodes: true });

    const enriched = await this.enrichCandidates(summary.detailedCandidates);

    const filesChanged = new Map<string, SourceFile>();
    const skippedFiles: FileTransformRecord[] = [];

    if (write) {
      for (const candidate of enriched) {
        if (candidate.status !== 'pending') {
          continue;
        }

        try {
          const sourceFile = candidate.raw.sourceFile;
          ensureUseTranslationImport(sourceFile);
          const scope = findNearestFunctionScope(candidate.raw.node);
          if (!scope) {
            candidate.status = 'skipped';
            candidate.reason = 'No React component/function scope found';
            skippedFiles.push({ filePath: candidate.filePath, reason: candidate.reason });
            continue;
          }

          ensureUseTranslationBinding(scope);
          this.applyCandidate(candidate);
          await this.localeStore.upsert(this.sourceLocale, candidate.suggestedKey, candidate.text);
          for (const locale of this.targetLocales) {
            if (locale === this.sourceLocale) {
              continue;
            }
            await this.localeStore.upsert(locale, candidate.suggestedKey, '');
          }
          candidate.status = 'applied';
          filesChanged.set(candidate.filePath, sourceFile);
        } catch (error) {
          candidate.status = 'skipped';
          candidate.reason = (error as Error).message;
          skippedFiles.push({ filePath: candidate.filePath, reason: candidate.reason });
        }
      }

      await Promise.all(
        Array.from(filesChanged.values()).map((file) => file.save())
      );
    }

    const localeStats = write ? await this.localeStore.flush() : [];

    return {
      filesScanned: summary.filesScanned,
      filesChanged: Array.from(filesChanged.keys()),
      candidates: enriched,
      localeStats,
      skippedFiles,
      write,
    };
  }

  private async enrichCandidates(nodes: ScannerNodeCandidate[]): Promise<InternalCandidate[]> {
    const result: InternalCandidate[] = [];

    for (const candidate of nodes) {
      const generated = this.keyGenerator.generate(candidate.text, this.buildContext(candidate));
      let status: CandidateStatus = 'pending';
      let reason: string | undefined;

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
        ...candidate,
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

    throw new Error(`Unsupported candidate kind: ${candidate.kind}`);
  }

  private configTranslationNamespace(): string {
    const translation = this.config.translation as { namespace?: string } | undefined;
    return translation?.namespace ?? 'common';
  }
}
