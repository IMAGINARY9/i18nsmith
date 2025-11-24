import path from 'path';
import { CallExpression, Node, Project, SourceFile } from 'ts-morph';
import { EmptyValuePolicy, I18nConfig, DEFAULT_PLACEHOLDER_FORMATS, DEFAULT_EMPTY_VALUE_MARKERS } from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';
import { buildPlaceholderPatterns, extractPlaceholders, PlaceholderPatternInstance } from './placeholders.js';

export interface TranslationReference {
  key: string;
  filePath: string;
  position: {
    line: number;
    column: number;
  };
}

export interface MissingKeyRecord {
  key: string;
  references: TranslationReference[];
}

export interface UnusedKeyRecord {
  key: string;
  locales: string[];
}

export interface SyncSummary {
  filesScanned: number;
  references: TranslationReference[];
  missingKeys: MissingKeyRecord[];
  unusedKeys: UnusedKeyRecord[];
  localeStats: LocaleFileStats[];
  localePreview: LocaleDiffPreview[];
  placeholderIssues: PlaceholderIssue[];
  emptyValueViolations: EmptyValueViolation[];
  dynamicKeyWarnings: DynamicKeyWarning[];
  validation: SyncValidationState;
  assumedKeys: string[];
  write: boolean;
}

export interface SyncSelection {
  missing?: string[];
  unused?: string[];
}

export interface PlaceholderIssue {
  key: string;
  locale: string;
  missing: string[];
  extra: string[];
  references: TranslationReference[];
  sourceValue?: string;
  targetValue?: string;
}

export type EmptyValueViolationReason = 'empty' | 'whitespace' | 'placeholder' | 'null';

export interface EmptyValueViolation {
  key: string;
  locale: string;
  value: string | null;
  reason: EmptyValueViolationReason;
}

export type DynamicKeyReason = 'template' | 'binary' | 'expression';

export interface DynamicKeyWarning {
  filePath: string;
  position: {
    line: number;
    column: number;
  };
  expression: string;
  reason: DynamicKeyReason;
}

export interface SyncValidationState {
  interpolations: boolean;
  emptyValuePolicy: EmptyValuePolicy;
}

export interface LocaleDiffPreview {
  locale: string;
  add: string[];
  remove: string[];
}

export interface SyncerOptions {
  workspaceRoot?: string;
  project?: Project;
  localeStore?: LocaleStore;
  translationIdentifier?: string;
}

export interface SyncRunOptions {
  write?: boolean;
  validateInterpolations?: boolean;
  emptyValuePolicy?: EmptyValuePolicy;
  assumedKeys?: string[];
  selection?: SyncSelection;
}

interface ResolvedSyncRunOptions {
  write: boolean;
  validateInterpolations: boolean;
  emptyValuePolicy: EmptyValuePolicy;
  assumedKeys: Set<string>;
  selectedMissingKeys?: Set<string>;
  selectedUnusedKeys?: Set<string>;
}

export class Syncer {
  private readonly project: Project;
  private readonly workspaceRoot: string;
  private readonly localeStore: LocaleStore;
  private readonly translationIdentifier: string;
  private readonly sourceLocale: string;
  private readonly targetLocales: string[];
  private readonly placeholderPatterns: PlaceholderPatternInstance[];
  private readonly defaultValidateInterpolations: boolean;
  private readonly defaultEmptyValuePolicy: EmptyValuePolicy;
  private readonly emptyValueMarkers: Set<string>;
  private readonly defaultAssumedKeys: string[];

  constructor(private readonly config: I18nConfig, options: SyncerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.project = options.project ?? new Project({
      skipAddingFilesFromTsConfig: true,
    });
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
    this.localeStore = options.localeStore ?? new LocaleStore(localesDir);
    const syncOptions = this.config.sync ?? {};
    const placeholderFormats = syncOptions.placeholderFormats?.length
      ? syncOptions.placeholderFormats
      : DEFAULT_PLACEHOLDER_FORMATS;
    this.placeholderPatterns = buildPlaceholderPatterns(placeholderFormats);
    this.translationIdentifier = options.translationIdentifier ?? syncOptions.translationIdentifier ?? 't';
    this.sourceLocale = config.sourceLanguage ?? 'en';
    this.targetLocales = (config.targetLanguages ?? []).filter(Boolean);
    this.defaultValidateInterpolations = syncOptions.validateInterpolations ?? false;
    this.defaultEmptyValuePolicy = syncOptions.emptyValuePolicy ?? 'warn';
    const emptyMarkers = syncOptions.emptyValueMarkers?.length
      ? syncOptions.emptyValueMarkers
      : DEFAULT_EMPTY_VALUE_MARKERS;
    this.emptyValueMarkers = new Set(emptyMarkers.map((marker) => marker.toLowerCase()));
    this.defaultAssumedKeys = syncOptions.dynamicKeyAssumptions ?? [];
  }

  public async run(runOptions: SyncRunOptions = {}): Promise<SyncSummary> {
    const runtime = this.resolveRuntimeOptions(runOptions);
    const write = runtime.write;
    const files = this.loadFiles();
  const { references, referencesByKey, keySet, dynamicKeyWarnings } = this.collectReferences(files, runtime.assumedKeys);

  const localeData = await this.collectLocaleData();
  const localeKeySets = this.buildLocaleKeySets(localeData);
    const sourceLocaleKeys = localeKeySets.get(this.sourceLocale) ?? new Set<string>();

    const localeDiff = new Map<string, { add: Set<string>; remove: Set<string> }>();

    const previewAdd = (locale: string, key: string) => {
      if (!localeDiff.has(locale)) {
        localeDiff.set(locale, { add: new Set(), remove: new Set() });
      }
      localeDiff.get(locale)!.add.add(key);
    };

    const previewRemove = (locale: string, key: string) => {
      if (!localeDiff.has(locale)) {
        localeDiff.set(locale, { add: new Set(), remove: new Set() });
      }
      localeDiff.get(locale)!.remove.add(key);
    };

    const missingKeys = Array.from(keySet)
      .filter((key) => !sourceLocaleKeys.has(key))
      .map((key) => ({
        key,
        references: referencesByKey.get(key) ?? [],
      }));

    const missingKeysToApply = this.filterSelection(missingKeys, runtime.selectedMissingKeys);
    for (const record of missingKeysToApply) {
      previewAdd(this.sourceLocale, record.key);
      if (this.config.seedTargetLocales) {
        for (const locale of this.targetLocales) {
          previewAdd(locale, record.key);
        }
      }
    }

    const unusedKeyMap = new Map<string, Set<string>>();
    for (const [locale, keys] of localeKeySets) {
      for (const key of keys) {
        if (keySet.has(key)) {
          continue;
        }
        if (!unusedKeyMap.has(key)) {
          unusedKeyMap.set(key, new Set());
        }
        unusedKeyMap.get(key)!.add(locale);
      }
    }

    const unusedKeys: UnusedKeyRecord[] = Array.from(unusedKeyMap.entries()).map(([key, locales]) => ({
      key,
      locales: Array.from(locales).sort(),
    }));

    const unusedKeysToApply = this.filterSelection(unusedKeys, runtime.selectedUnusedKeys);
    for (const record of unusedKeysToApply) {
      record.locales.forEach((locale) => previewRemove(locale, record.key));
    }

    const placeholderIssues = runtime.validateInterpolations
      ? this.collectPlaceholderIssues(localeData, referencesByKey)
      : [];
    const emptyValueViolations = this.collectEmptyValueViolations(localeData);

    let localeStats: LocaleFileStats[] = [];
    if (write) {
      await this.applyMissingKeys(missingKeysToApply);
      await this.applyUnusedKeys(unusedKeysToApply);
      localeStats = await this.localeStore.flush();
    }

    const localePreview: LocaleDiffPreview[] = Array.from(localeDiff.entries()).map(([locale, diff]) => ({
      locale,
      add: Array.from(diff.add).sort(),
      remove: Array.from(diff.remove).sort(),
    }));

    return {
      filesScanned: files.length,
      references,
      missingKeys,
      unusedKeys,
      localeStats,
      localePreview,
      placeholderIssues,
      emptyValueViolations,
      dynamicKeyWarnings,
      validation: {
        interpolations: runtime.validateInterpolations,
        emptyValuePolicy: runtime.emptyValuePolicy,
      },
      assumedKeys: Array.from(runtime.assumedKeys).sort(),
      write,
    };
  }

  private loadFiles(): SourceFile[] {
    const patterns = this.resolveGlobPatterns(this.getGlobPatterns());
    let files = this.project.getSourceFiles();
    if (files.length === 0) {
      files = this.project.addSourceFilesAtPaths(patterns);
    }
    return files;
  }

  private collectReferences(files: SourceFile[], assumedKeys: Set<string>) {
    const references: TranslationReference[] = [];
    const referencesByKey = new Map<string, TranslationReference[]>();
    const keySet = new Set<string>();
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];

    for (const file of files) {
      file.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) {
          return;
        }

        const analysis = this.extractKeyFromCall(node);
        if (!analysis) {
          return;
        }

        if (analysis.kind === 'dynamic') {
          dynamicKeyWarnings.push(this.createDynamicWarning(file, node, analysis.reason));
          return;
        }

        const reference = this.createReference(file, node, analysis.key);
        references.push(reference);
        keySet.add(analysis.key);
        if (!referencesByKey.has(analysis.key)) {
          referencesByKey.set(analysis.key, []);
        }
        referencesByKey.get(analysis.key)!.push(reference);
      });
    }

    for (const key of assumedKeys) {
      keySet.add(key);
      if (!referencesByKey.has(key)) {
        referencesByKey.set(key, []);
      }
    }

    return { references, referencesByKey, keySet, dynamicKeyWarnings };
  }

  private extractKeyFromCall(
    node: CallExpression
  ):
    | { kind: 'literal'; key: string }
    | { kind: 'dynamic'; reason: DynamicKeyReason }
    | undefined {
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== this.translationIdentifier) {
      return undefined;
    }

    const [arg] = node.getArguments();
    if (!arg) {
      return undefined;
    }

    if (Node.isStringLiteral(arg)) {
      return { kind: 'literal', key: arg.getLiteralText() };
    }

    if (Node.isNoSubstitutionTemplateLiteral(arg)) {
      return { kind: 'literal', key: arg.getLiteralText() };
    }

    if (Node.isTemplateExpression(arg)) {
      return { kind: 'dynamic', reason: 'template' };
    }

    if (Node.isBinaryExpression(arg)) {
      return { kind: 'dynamic', reason: 'binary' };
    }

    return { kind: 'dynamic', reason: 'expression' };
  }

  private createReference(file: SourceFile, node: CallExpression, key: string): TranslationReference {
    const position = file.getLineAndColumnAtPos(node.getStart());
    return {
      key,
      filePath: this.getRelativePath(file.getFilePath()),
      position,
    };
  }

  private async collectLocaleData(): Promise<Map<string, Record<string, string>>> {
    const locales = [this.sourceLocale, ...this.targetLocales];
    const result = new Map<string, Record<string, string>>();

    for (const locale of locales) {
      const data = await this.localeStore.get(locale);
      result.set(locale, data);
    }

    return result;
  }

  private buildLocaleKeySets(localeData: Map<string, Record<string, string>>): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    for (const [locale, data] of localeData.entries()) {
      map.set(locale, new Set(Object.keys(data)));
    }
    return map;
  }

  private async applyMissingKeys(missingKeys: MissingKeyRecord[]) {
    for (const record of missingKeys) {
      await this.localeStore.upsert(this.sourceLocale, record.key, record.key);
      if (this.config.seedTargetLocales) {
        for (const locale of this.targetLocales) {
          await this.localeStore.upsert(locale, record.key, '');
        }
      }
    }
  }

  private async applyUnusedKeys(unusedKeys: UnusedKeyRecord[]) {
    for (const record of unusedKeys) {
      for (const locale of record.locales) {
        await this.localeStore.remove(locale, record.key);
      }
    }
  }

  private getGlobPatterns(): string[] {
    const includes = Array.isArray(this.config.include) && this.config.include.length
      ? this.config.include
      : ['src/**/*.{ts,tsx,js,jsx}'];
    const excludes = this.config.exclude?.map((pattern) => `!${pattern}`) ?? [];
    return [...includes, ...excludes];
  }

  private getRelativePath(filePath: string): string {
    const relative = path.relative(this.workspaceRoot, filePath);
    return relative || filePath;
  }

  private resolveGlobPatterns(patterns: string[]): string[] {
    return patterns.map((pattern) => {
      const isNegated = pattern.startsWith('!');
      const rawPattern = isNegated ? pattern.slice(1) : pattern;
      const absolute = path.isAbsolute(rawPattern)
        ? rawPattern
        : path.join(this.workspaceRoot, rawPattern);
      return isNegated ? `!${absolute}` : absolute;
    });
  }

  private collectPlaceholderIssues(
    localeData: Map<string, Record<string, string>>,
    referencesByKey: Map<string, TranslationReference[]>
  ): PlaceholderIssue[] {
    const issues: PlaceholderIssue[] = [];
    const sourceData = localeData.get(this.sourceLocale) ?? {};

    for (const [key, sourceValue] of Object.entries(sourceData)) {
      const sourcePlaceholders = this.extractPlaceholdersFromValue(sourceValue);
      const sourceSet = sourcePlaceholders;

      for (const locale of this.targetLocales) {
        const targetValue = localeData.get(locale)?.[key];
        if (typeof targetValue === 'undefined') {
          continue;
        }

        const targetSet = this.extractPlaceholdersFromValue(targetValue);
        const missing = Array.from(sourceSet).filter((token) => !targetSet.has(token));
        const extra = Array.from(targetSet).filter((token) => !sourceSet.has(token));

        if (!missing.length && !extra.length) {
          continue;
        }

        issues.push({
          key,
          locale,
          missing,
          extra,
          references: referencesByKey.get(key) ?? [],
          sourceValue,
          targetValue,
        });
      }
    }

    return issues;
  }

  private collectEmptyValueViolations(localeData: Map<string, Record<string, string>>): EmptyValueViolation[] {
    const violations: EmptyValueViolation[] = [];

    for (const locale of this.targetLocales) {
      const data = localeData.get(locale);
      if (!data) {
        continue;
      }

      for (const [key, value] of Object.entries(data)) {
        const reason = this.getEmptyValueReason(value);
        if (!reason) {
          continue;
        }

        violations.push({
          key,
          locale,
          value: typeof value === 'string' ? value : null,
          reason,
        });
      }
    }

    return violations;
  }

  private getEmptyValueReason(value: unknown): EmptyValueViolationReason | null {
    if (value === null || typeof value === 'undefined') {
      return 'null';
    }

    if (typeof value !== 'string') {
      return null;
    }

    if (value.length === 0) {
      return 'empty';
    }

    const trimmed = value.trim();
    if (!trimmed.length) {
      return 'whitespace';
    }

    if (this.emptyValueMarkers.has(trimmed.toLowerCase())) {
      return 'placeholder';
    }

    return null;
  }

  private extractPlaceholdersFromValue(value: unknown): Set<string> {
    if (typeof value !== 'string') {
      return new Set();
    }
    return new Set(extractPlaceholders(value, this.placeholderPatterns));
  }

  private resolveRuntimeOptions(runOptions: SyncRunOptions): ResolvedSyncRunOptions {
    const write = runOptions.write ?? false;
    const validateInterpolations = runOptions.validateInterpolations ?? this.defaultValidateInterpolations;
    const emptyValuePolicy = runOptions.emptyValuePolicy ?? this.defaultEmptyValuePolicy;

    const assumedKeys = new Set<string>();
    const candidates = [...this.defaultAssumedKeys, ...(runOptions.assumedKeys ?? [])];
    for (const key of candidates) {
      const normalized = key.trim();
      if (normalized.length) {
        assumedKeys.add(normalized);
      }
    }

    const selectedMissingKeys = this.buildSelectionSet(runOptions.selection?.missing);
    const selectedUnusedKeys = this.buildSelectionSet(runOptions.selection?.unused);

    return {
      write,
      validateInterpolations,
      emptyValuePolicy,
      assumedKeys,
      selectedMissingKeys,
      selectedUnusedKeys,
    };
  }

  private createDynamicWarning(file: SourceFile, node: CallExpression, reason: DynamicKeyReason): DynamicKeyWarning {
    const [arg] = node.getArguments();
    const position = file.getLineAndColumnAtPos((arg ?? node).getStart());
    const expression = arg ? arg.getText() : node.getText();

    return {
      filePath: this.getRelativePath(file.getFilePath()),
      position,
      expression,
      reason,
    };
  }

  private filterSelection<T extends { key: string }>(items: T[], selection?: Set<string>): T[] {
    if (!selection) {
      return items;
    }
    return items.filter((item) => selection.has(item.key));
  }

  private buildSelectionSet(keys?: string[]): Set<string> | undefined {
    if (!keys) {
      return undefined;
    }
    const next = new Set<string>();
    for (const key of keys) {
      const normalized = key?.trim();
      if (normalized) {
        next.add(normalized);
      }
    }
    return next;
  }
}
