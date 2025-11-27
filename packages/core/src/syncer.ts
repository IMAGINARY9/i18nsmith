import fs from 'fs/promises';
import path from 'path';
import { CallExpression, Node, Project, SourceFile } from 'ts-morph';
import fg from 'fast-glob';
import {
  EmptyValuePolicy,
  I18nConfig,
  DEFAULT_PLACEHOLDER_FORMATS,
  DEFAULT_EMPTY_VALUE_MARKERS,
  SuspiciousKeyPolicy,
} from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';
import { buildPlaceholderPatterns, extractPlaceholders, PlaceholderPatternInstance } from './placeholders.js';
import { ActionableItem } from './actionable.js';
import { buildLocaleDiffs, buildLocalePreview, LocaleDiffEntry, LocaleDiffPreview } from './diff-utils.js';
import { generateValueFromKey } from './value-generator.js';

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
  suspicious?: boolean;
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
  diffs: LocaleDiffEntry[];
  placeholderIssues: PlaceholderIssue[];
  emptyValueViolations: EmptyValueViolation[];
  dynamicKeyWarnings: DynamicKeyWarning[];
  suspiciousKeys: SuspiciousKeyWarning[];
  validation: SyncValidationState;
  assumedKeys: string[];
  write: boolean;
  actionableItems: ActionableItem[];
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

export type SuspiciousKeyReason =
  | 'contains-spaces'
  | 'single-word-no-namespace'
  | 'trailing-punctuation'
  | 'pascal-case-sentence'
  | 'sentence-article';

export interface DynamicKeyWarning {
  filePath: string;
  position: {
    line: number;
    column: number;
  };
  expression: string;
  reason: DynamicKeyReason;
}

export interface SuspiciousKeyWarning {
  key: string;
  filePath: string;
  position: {
    line: number;
    column: number;
  };
  reason: SuspiciousKeyReason | string;
}

export interface SyncValidationState {
  interpolations: boolean;
  emptyValuePolicy: EmptyValuePolicy;
}

interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

interface ReferenceCacheEntry {
  fingerprint: FileFingerprint;
  references: TranslationReference[];
  dynamicKeyWarnings: DynamicKeyWarning[];
}

interface ReferenceCacheFile {
  version: number;
  translationIdentifier: string;
  files: Record<string, ReferenceCacheEntry>;
}

interface TargetReferenceFilter {
  absolute: Set<string>;
  relative: Set<string>;
}

const REFERENCE_CACHE_VERSION = 1;

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
  diff?: boolean;
  invalidateCache?: boolean;
  targets?: string[];
}

interface ResolvedSyncRunOptions {
  write: boolean;
  validateInterpolations: boolean;
  emptyValuePolicy: EmptyValuePolicy;
  assumedKeys: Set<string>;
  displayAssumedKeys: Set<string>;
  selectedMissingKeys?: Set<string>;
  selectedUnusedKeys?: Set<string>;
  generateDiffs: boolean;
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
  private readonly dynamicKeyGlobMatchers: RegExp[];
  private readonly cacheDir: string;
  private readonly referenceCachePath: string;
  private readonly suspiciousKeyPolicy: SuspiciousKeyPolicy;

  constructor(private readonly config: I18nConfig, options: SyncerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.project = options.project ?? new Project({
      skipAddingFilesFromTsConfig: true,
    });
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
    const localeStoreOptions = {
      format: config.locales?.format ?? 'auto',
      delimiter: config.locales?.delimiter ?? '.',
    };
    this.localeStore = options.localeStore ?? new LocaleStore(localesDir, localeStoreOptions);
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
    this.suspiciousKeyPolicy = syncOptions.suspiciousKeyPolicy ?? 'skip';
    this.defaultAssumedKeys = syncOptions.dynamicKeyAssumptions ?? [];
    const globPatterns = syncOptions.dynamicKeyGlobs ?? [];
    this.dynamicKeyGlobMatchers = globPatterns
      .map((pattern) => pattern.trim())
      .filter(Boolean)
      .map((pattern) => this.compileGlob(pattern));
    this.cacheDir = path.join(this.workspaceRoot, '.i18nsmith', 'cache');
    this.referenceCachePath = path.join(this.cacheDir, 'sync-references.json');
  }

  public async run(runOptions: SyncRunOptions = {}): Promise<SyncSummary> {
    const runtime = this.resolveRuntimeOptions(runOptions);
    const write = runtime.write;
    const targetFilter = await this.resolveTargetReferenceFilter(runOptions.targets);
    let filePaths = await this.resolveSourceFilePaths();
    if (targetFilter) {
      filePaths = filePaths.filter((filePath) => targetFilter.absolute.has(filePath));
    }
    const cacheState = await this.loadReferenceCache(runOptions.invalidateCache);
    const nextCacheEntries: Record<string, ReferenceCacheEntry> = targetFilter
      ? { ...(cacheState?.files ?? {}) }
      : {};
    const { references, referencesByKey, keySet, dynamicKeyWarnings } = await this.collectReferences(
      filePaths,
      runtime.assumedKeys,
      cacheState,
      nextCacheEntries
    );

    const localeData = await this.collectLocaleData();
    const patternAssumedKeys = this.collectPatternAssumedKeys(localeData);
    for (const key of patternAssumedKeys) {
      runtime.assumedKeys.add(key);
      keySet.add(key);
    }

    const {
      scopedReferences,
      scopedReferencesByKey,
      scopedKeySet,
      scopedDynamicKeyWarnings,
    } = this.scopeAnalysisToTargets({
      targetFilter,
      references,
      referencesByKey,
      keySet,
      dynamicKeyWarnings,
      assumedKeys: runtime.displayAssumedKeys,
    });

    const projectedLocaleData = this.cloneLocaleData(localeData);
    const localeKeySets = this.buildLocaleKeySets(localeData);

    const { missingKeys, missingKeysToApply } = this.processMissingKeys(
      scopedKeySet,
      scopedReferencesByKey,
      localeKeySets,
      projectedLocaleData,
      runtime.selectedMissingKeys
    );

    const { unusedKeys, unusedKeysToApply } = this.processUnusedKeys(
      keySet,
      localeKeySets,
      projectedLocaleData,
      runtime.selectedUnusedKeys,
      !targetFilter
    );

    const placeholderIssues = runtime.validateInterpolations
      ? this.collectPlaceholderIssues(localeData, scopedReferencesByKey)
      : [];
    const emptyValueViolations = this.collectEmptyValueViolations(localeData);

    const suspiciousKeys: SuspiciousKeyWarning[] = [];
    for (const key of scopedKeySet) {
      const analysis = this.analyzeSuspiciousKey(key);
      if (analysis.suspicious) {
        const refs = scopedReferencesByKey.get(key) ?? [];
        for (const ref of refs) {
          suspiciousKeys.push({
            key,
            filePath: ref.filePath,
            position: ref.position,
            reason: analysis.reason ?? 'unknown',
          });
        }
      }
    }

    let localeStats: LocaleFileStats[] = [];
    if (write) {
      await this.applyMissingKeys(missingKeysToApply);
      await this.applyUnusedKeys(unusedKeysToApply);
      localeStats = await this.localeStore.flush();
    }

    const localePreview = buildLocalePreview(projectedLocaleData, localeData);
    const diffs = runtime.generateDiffs
      ? buildLocaleDiffs(
          localeData,
          projectedLocaleData,
          (locale) => this.localeStore.getFilePath(locale),
          this.workspaceRoot
        )
      : [];
    await this.saveReferenceCache(nextCacheEntries);

    const actionableItems = this.buildActionableItems({
      missingKeys,
      unusedKeys,
      placeholderIssues,
      emptyValueViolations,
      dynamicKeyWarnings: scopedDynamicKeyWarnings,
      suspiciousKeys,
      validation: {
        interpolations: runtime.validateInterpolations,
        emptyValuePolicy: runtime.emptyValuePolicy,
      },
  assumedKeys: Array.from(runtime.displayAssumedKeys).sort(),
      suspiciousKeyPolicy: this.suspiciousKeyPolicy,
    });

    return {
      filesScanned: filePaths.length,
      references: scopedReferences,
      missingKeys,
      unusedKeys,
      localeStats,
      localePreview,
      diffs,
      placeholderIssues,
      emptyValueViolations,
      dynamicKeyWarnings: scopedDynamicKeyWarnings,
      suspiciousKeys,
      validation: {
        interpolations: runtime.validateInterpolations,
        emptyValuePolicy: runtime.emptyValuePolicy,
      },
  assumedKeys: Array.from(runtime.displayAssumedKeys).sort(),
      write,
      actionableItems,
    };
  }

  private analyzeSuspiciousKey(key: string): { suspicious: boolean; reason?: SuspiciousKeyReason } {
    // Keys containing spaces are clearly raw UI text
    if (key.includes(' ')) {
      return { suspicious: true, reason: 'contains-spaces' };
    }

    // Single-word keys without a namespace (e.g., `Found`, `tags`) are likely raw labels
    if (!key.includes('.') && /^[A-Za-z]+$/.test(key)) {
      return { suspicious: true, reason: 'single-word-no-namespace' };
    }

    // Keys with sentence-like punctuation (colons, question marks, exclamation) at the end
    if (/[:?!]$/.test(key)) {
      return { suspicious: true, reason: 'trailing-punctuation' };
    }

    // Keys that look like Title Case sentences (3+ consecutive capitalized words)
    // e.g., "When To Use Categorized View" or "WhenToUseCategorizedView"
    const withoutNamespace = key.includes('.') ? key.split('.').pop()! : key;
    if (/([A-Z][a-z]+){3,}/.test(withoutNamespace) && !/[-_]/.test(withoutNamespace)) {
      // Check if it's just camelCase with 3+ words (acceptable) vs PascalCase sentence
      // PascalCase sentences typically have all words capitalized
      const words = withoutNamespace.split(/(?=[A-Z])/);
      if (words.length >= 4 && words.every(w => w.length > 1)) {
        return { suspicious: true, reason: 'pascal-case-sentence' };
      }
    }

    // Keys containing articles/prepositions suggesting sentence structure
    // Only flag if also mixed with capitalized words
    const sentenceIndicators = /\b(The|A|An|To|Of|For|In|On|At|By|With|From|As|Is|Are|Was|Were|Be|Been|Being|Have|Has|Had|Do|Does|Did|Will|Would|Could|Should|May|Might|Must|Shall|Can)\b/;
    if (sentenceIndicators.test(withoutNamespace)) {
      return { suspicious: true, reason: 'sentence-article' };
    }

    return { suspicious: false };
  }

  private isSuspiciousKey(key: string): boolean {
    return this.analyzeSuspiciousKey(key).suspicious;
  }

  private scopeAnalysisToTargets(input: {
    targetFilter: TargetReferenceFilter | undefined;
    references: TranslationReference[];
    referencesByKey: Map<string, TranslationReference[]>;
    keySet: Set<string>;
    dynamicKeyWarnings: DynamicKeyWarning[];
    assumedKeys: Set<string>;
  }) {
    const { targetFilter, references, referencesByKey, keySet, dynamicKeyWarnings, assumedKeys } = input;
    const targetReferenceSet = targetFilter?.relative;

    if (!targetReferenceSet) {
      return {
        scopedReferences: references,
        scopedReferencesByKey: referencesByKey,
        scopedKeySet: keySet,
        scopedDynamicKeyWarnings: dynamicKeyWarnings,
      };
    }

    const scopedReferences = references.filter((reference) =>
      targetReferenceSet.has(reference.filePath)
    );

    const scopedReferencesByKey = this.filterReferencesByKey(referencesByKey, targetReferenceSet);

    const scopedDynamicKeyWarnings = dynamicKeyWarnings.filter((warning) =>
      targetReferenceSet.has(warning.filePath)
    );

    const scopedKeySet = this.buildFilteredKeySet(scopedReferences, assumedKeys);

    return {
      scopedReferences,
      scopedReferencesByKey,
      scopedKeySet,
      scopedDynamicKeyWarnings,
    };
  }

  private processMissingKeys(
    keySet: Set<string>,
    referencesByKey: Map<string, TranslationReference[]>,
    localeKeySets: Map<string, Set<string>>,
    projectedLocaleData: Map<string, Record<string, string>>,
    selectedMissingKeys?: Set<string>
  ) {
    const sourceLocaleKeys = localeKeySets.get(this.sourceLocale) ?? new Set<string>();
    const missingKeys = Array.from(keySet)
      .filter((key) => !sourceLocaleKeys.has(key))
      .map((key) => ({
        key,
        references: referencesByKey.get(key) ?? [],
        suspicious: this.isSuspiciousKey(key),
      }));

    const autoApplyCandidates = missingKeys.filter((record) =>
      this.shouldAutoApplyMissingKey(record, selectedMissingKeys)
    );
    const missingKeysToApply = this.filterSelection(autoApplyCandidates, selectedMissingKeys);
    for (const record of missingKeysToApply) {
      const defaultValue = this.buildDefaultSourceValue(record.key);
      this.applyProjectedValue(projectedLocaleData, this.sourceLocale, record.key, defaultValue);
      if (this.config.seedTargetLocales) {
        for (const locale of this.targetLocales) {
          this.applyProjectedValue(projectedLocaleData, locale, record.key, '');
        }
      }
    }
    return { missingKeys, missingKeysToApply };
  }

  private processUnusedKeys(
    keySet: Set<string>,
    localeKeySets: Map<string, Set<string>>,
    projectedLocaleData: Map<string, Record<string, string>>,
    selectedUnusedKeys?: Set<string>,
    enabled: boolean = true
  ) {
    let unusedKeys: UnusedKeyRecord[] = [];
    if (enabled) {
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

      unusedKeys = Array.from(unusedKeyMap.entries()).map(([key, locales]) => ({
        key,
        locales: Array.from(locales).sort(),
      }));
    }

    const unusedKeysToApply = selectedUnusedKeys
      ? this.filterSelection(unusedKeys, selectedUnusedKeys)
      : this.config.sync?.retainLocales
      ? []
      : unusedKeys;

    for (const record of unusedKeysToApply) {
      record.locales.forEach((locale) => {
        this.applyProjectedRemoval(projectedLocaleData, locale, record.key);
      });
    }

    return { unusedKeys, unusedKeysToApply };
  }

  private buildActionableItems(input: {
    missingKeys: MissingKeyRecord[];
    unusedKeys: UnusedKeyRecord[];
    placeholderIssues: PlaceholderIssue[];
    emptyValueViolations: EmptyValueViolation[];
    dynamicKeyWarnings: DynamicKeyWarning[];
    suspiciousKeys: SuspiciousKeyWarning[];
    validation: SyncValidationState;
    assumedKeys: string[];
    suspiciousKeyPolicy: SuspiciousKeyPolicy;
  }): ActionableItem[] {
    const items: ActionableItem[] = [];

    const suspiciousSeverity = input.suspiciousKeyPolicy === 'error' ? 'error' : 'warn';
    const skipWrite = input.suspiciousKeyPolicy !== 'allow';
    input.suspiciousKeys.forEach((warning) => {
      items.push({
        kind: 'suspicious-key',
        severity: suspiciousSeverity,
        key: warning.key,
        filePath: warning.filePath,
        message: `Suspicious key format detected: "${warning.key}" (contains spaces)${
          skipWrite ? ' — auto-insert skipped until the key is renamed.' : ''
        }`,
        details: {
          reason: warning.reason,
          policy: input.suspiciousKeyPolicy,
        },
      });
    });

    input.missingKeys.forEach((record) => {
      const reference = record.references[0];
      items.push({
        kind: 'missing-key',
        severity: 'error',
        key: record.key,
        filePath: reference?.filePath,
        message: `Key "${record.key}" referenced ${record.references.length} time${record.references.length === 1 ? '' : 's'} but missing from source locale`,
        details: {
          referenceCount: record.references.length,
        },
      });
    });

    input.unusedKeys.forEach((record) => {
      items.push({
        kind: 'unused-key',
        severity: 'warn',
        key: record.key,
        message: `Key "${record.key}" is present in locales (${record.locales.join(', ')}) but not referenced in code`,
        details: {
          locales: record.locales,
        },
      });
    });

    input.placeholderIssues.forEach((issue) => {
      items.push({
        kind: 'placeholder-mismatch',
        severity: 'error',
        key: issue.key,
        locale: issue.locale,
        message: `Placeholder mismatch for "${issue.key}" in ${issue.locale}`,
        details: {
          missing: issue.missing,
          extra: issue.extra,
        },
      });
    });

    if (input.validation.emptyValuePolicy !== 'ignore') {
      input.emptyValueViolations.forEach((violation) => {
        items.push({
          kind: 'empty-value',
          severity: input.validation.emptyValuePolicy === 'fail' ? 'error' : 'warn',
          key: violation.key,
          locale: violation.locale,
          message: `Empty locale value detected for "${violation.key}" in ${violation.locale} (${violation.reason})`,
        });
      });
    }

    input.dynamicKeyWarnings.forEach((warning) => {
      items.push({
        kind: 'dynamic-key-warning',
        severity: 'warn',
        key: warning.expression,
        filePath: warning.filePath,
        message: `Dynamic translation key detected in ${warning.filePath}:${warning.position.line}`,
        details: {
          reason: warning.reason,
        },
      });
    });

    if (input.assumedKeys.length) {
      items.push({
        kind: 'assumed-keys',
        severity: 'info',
        message: `Assuming runtime-only keys: ${input.assumedKeys.join(', ')}`,
        details: {
          keys: input.assumedKeys,
        },
      });
    }

    return items;
  }

  private async resolveTargetReferenceFilter(targets?: string[]): Promise<TargetReferenceFilter | undefined> {
    if (!targets?.length) {
      return undefined;
    }

    const normalizedTargets = targets
      .map((entry) => entry?.trim())
      .filter((entry): entry is string => Boolean(entry));

    if (!normalizedTargets.length) {
      return undefined;
    }

    const resolvedPatterns = normalizedTargets.map((pattern) =>
      path.isAbsolute(pattern) ? pattern : path.join(this.workspaceRoot, pattern)
    );

    const files = (await fg(resolvedPatterns, {
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: true,
    })) as string[];

    if (!files.length) {
      return undefined;
    }

    const absolute = new Set<string>();
    const relative = new Set<string>();

    for (const filePath of files) {
      const absolutePath = path.resolve(filePath);
      absolute.add(absolutePath);
      relative.add(this.getRelativePath(absolutePath));
    }

    return { absolute, relative };
  }

  private async resolveSourceFilePaths(): Promise<string[]> {
    const patterns = this.resolveGlobPatterns(this.getGlobPatterns());
    const files = (await fg(patterns, {
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: true,
    })) as string[];
    return files.sort((a, b) => a.localeCompare(b));
  }

  private async collectReferences(
    filePaths: string[],
    assumedKeys: Set<string>,
    cache: ReferenceCacheFile | undefined,
    nextCacheEntries: Record<string, ReferenceCacheEntry>
  ) {
    const references: TranslationReference[] = [];
    const referencesByKey = new Map<string, TranslationReference[]>();
    const keySet = new Set<string>();
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];
    const canUseCache = Boolean(cache);

    for (const absolutePath of filePaths) {
      const relativePath = this.getRelativePath(absolutePath);
      const fingerprint = await this.getFileFingerprint(absolutePath);

      let fileReferences: TranslationReference[];
      let fileWarnings: DynamicKeyWarning[];

      const cachedEntry = canUseCache
        ? this.getCachedEntry(cache!, relativePath, fingerprint)
        : undefined;

      if (cachedEntry) {
        fileReferences = cachedEntry.references;
        fileWarnings = cachedEntry.dynamicKeyWarnings;
        nextCacheEntries[relativePath] = cachedEntry;
      } else {
        const sourceFile = this.project.addSourceFileAtPath(absolutePath);
        const extracted = this.extractReferencesFromFile(sourceFile);
        fileReferences = extracted.references;
        fileWarnings = extracted.dynamicKeyWarnings;
        nextCacheEntries[relativePath] = {
          fingerprint,
          references: fileReferences,
          dynamicKeyWarnings: fileWarnings,
        };
      }

      for (const reference of fileReferences) {
        references.push(reference);
        keySet.add(reference.key);
        if (!referencesByKey.has(reference.key)) {
          referencesByKey.set(reference.key, []);
        }
        referencesByKey.get(reference.key)!.push(reference);
      }

      dynamicKeyWarnings.push(...fileWarnings);
    }

    for (const key of assumedKeys) {
      keySet.add(key);
      if (!referencesByKey.has(key)) {
        referencesByKey.set(key, []);
      }
    }

    return { references, referencesByKey, keySet, dynamicKeyWarnings };
  }

  private extractReferencesFromFile(file: SourceFile) {
    const references: TranslationReference[] = [];
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];

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
    });

    return { references, dynamicKeyWarnings };
  }

  private async getFileFingerprint(filePath: string): Promise<FileFingerprint> {
    const stats = await fs.stat(filePath);
    return {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  }

  private getCachedEntry(
    cache: ReferenceCacheFile,
    relativePath: string,
    fingerprint: FileFingerprint
  ): ReferenceCacheEntry | undefined {
    const entry = cache.files[relativePath];
    if (!entry) {
      return undefined;
    }
    if (
      entry.fingerprint.mtimeMs !== fingerprint.mtimeMs ||
      entry.fingerprint.size !== fingerprint.size
    ) {
      return undefined;
    }
    return entry;
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

  private async loadReferenceCache(invalidate?: boolean): Promise<ReferenceCacheFile | undefined> {
    if (invalidate) {
      await this.clearReferenceCache();
      return undefined;
    }

    try {
      const raw = await fs.readFile(this.referenceCachePath, 'utf8');
      const parsed = JSON.parse(raw) as ReferenceCacheFile;
      if (parsed.version !== REFERENCE_CACHE_VERSION) {
        return undefined;
      }
      if (parsed.translationIdentifier !== this.translationIdentifier) {
        return undefined;
      }
      if (!parsed.files || typeof parsed.files !== 'object') {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async saveReferenceCache(entries: Record<string, ReferenceCacheEntry>): Promise<void> {
    const payload: ReferenceCacheFile = {
      version: REFERENCE_CACHE_VERSION,
      translationIdentifier: this.translationIdentifier,
      files: entries,
    };

    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.referenceCachePath, JSON.stringify(payload), 'utf8');
  }

  private async clearReferenceCache(): Promise<void> {
    await fs.rm(this.referenceCachePath, { force: true }).catch(() => {});
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
      const defaultValue = this.buildDefaultSourceValue(record.key);
      await this.localeStore.upsert(this.sourceLocale, record.key, defaultValue);
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
    const generateDiffs = runOptions.diff ?? false;

    const assumedKeys = new Set<string>();
    const displayAssumedKeys = new Set<string>();
    const candidates = [...this.defaultAssumedKeys, ...(runOptions.assumedKeys ?? [])];
    for (const key of candidates) {
      const normalized = key.trim();
      if (normalized.length) {
        assumedKeys.add(normalized);
        displayAssumedKeys.add(normalized);
      }
    }

    const selectedMissingKeys = this.buildSelectionSet(runOptions.selection?.missing);
    const selectedUnusedKeys = this.buildSelectionSet(runOptions.selection?.unused);

    return {
      write,
      validateInterpolations,
      emptyValuePolicy,
      assumedKeys,
      displayAssumedKeys,
      selectedMissingKeys,
      selectedUnusedKeys,
      generateDiffs,
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

  private filterReferencesByKey(
    referencesByKey: Map<string, TranslationReference[]>,
    targetFiles: Set<string>
  ): Map<string, TranslationReference[]> {
    const filtered = new Map<string, TranslationReference[]>();
    for (const [key, references] of referencesByKey.entries()) {
      const scoped = references.filter((reference) => targetFiles.has(reference.filePath));
      if (scoped.length) {
        filtered.set(key, scoped);
      }
    }
    return filtered;
  }

  private buildFilteredKeySet(
    references: TranslationReference[],
    assumedKeys: Set<string>
  ): Set<string> {
    const scoped = new Set<string>();
    references.forEach((reference) => scoped.add(reference.key));
    assumedKeys.forEach((key) => scoped.add(key));
    return scoped;
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

  private cloneLocaleData(localeData: Map<string, Record<string, string>>): Map<string, Record<string, string>> {
    const projected = new Map<string, Record<string, string>>();
    for (const [locale, data] of localeData.entries()) {
      projected.set(locale, { ...data });
    }
    return projected;
  }

  private ensureProjectedLocale(
    projected: Map<string, Record<string, string>>,
    locale: string
  ): Record<string, string> {
    if (!projected.has(locale)) {
      projected.set(locale, {});
    }
    return projected.get(locale)!;
  }

  private applyProjectedValue(
    projected: Map<string, Record<string, string>>,
    locale: string,
    key: string,
    value: string
  ) {
    const data = this.ensureProjectedLocale(projected, locale);
    data[key] = value;
  }

  private applyProjectedRemoval(projected: Map<string, Record<string, string>>, locale: string, key: string) {
    const data = this.ensureProjectedLocale(projected, locale);
    delete data[key];
  }

  private buildDefaultSourceValue(key: string): string {
    return generateValueFromKey(key) || key;
  }

  private collectPatternAssumedKeys(localeData: Map<string, Record<string, string>>): Set<string> {
    const assumed = new Set<string>();
    if (!this.dynamicKeyGlobMatchers.length) {
      return assumed;
    }

    for (const data of localeData.values()) {
      for (const key of Object.keys(data)) {
        if (this.matchesDynamicKeyGlobs(key)) {
          assumed.add(key);
        }
      }
    }

    return assumed;
  }

  private matchesDynamicKeyGlobs(key: string): boolean {
    return this.dynamicKeyGlobMatchers.some((matcher) => matcher.test(key));
  }

  private shouldAutoApplyMissingKey(record: MissingKeyRecord, selectedMissingKeys?: Set<string>): boolean {
    if (!record.suspicious) {
      return true;
    }

    if (this.suspiciousKeyPolicy === 'allow') {
      return true;
    }

    return selectedMissingKeys?.has(record.key) ?? false;
  }

  private compileGlob(pattern: string): RegExp {
    let regex = '';
    for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern[i];
      if (char === '*') {
        if (pattern[i + 1] === '*') {
          regex += '.*';
          i += 1;
        } else {
          regex += '[^.]*';
        }
        continue;
      }

      if (char === '?') {
        regex += '.';
        continue;
      }

      regex += this.escapeRegexChar(char);
    }

    return new RegExp(`^${regex}$`);
  }

  private escapeRegexChar(char: string): string {
    return char.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&');
  }
}
