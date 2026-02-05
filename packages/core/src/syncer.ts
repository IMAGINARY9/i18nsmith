import path from 'path';
import fs from 'fs/promises';
import { CallExpression, Node, Project, SourceFile } from 'ts-morph';
import fg from 'fast-glob';
import {
  EmptyValuePolicy,
  I18nConfig,
  DEFAULT_PLACEHOLDER_FORMATS,
  DEFAULT_EMPTY_VALUE_MARKERS,
  SuspiciousKeyPolicy,
} from './config.js';
import { createBackup, BackupResult } from './backup.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';
import { buildPlaceholderPatterns, PlaceholderPatternInstance } from './placeholders.js';
import { createDefaultProject } from './project-factory.js';
import { ActionableItem } from './actionable.js';
import { buildLocaleDiffs, buildLocalePreview, LocaleDiffEntry, LocaleDiffPreview, SourceFileDiffEntry } from './diff-utils.js';
import { KeyValidator, SuspiciousKeyReason } from './key-validator.js';
import {
  ReferenceExtractor,
  type TranslationReference,
  type DynamicKeyReason,
  type DynamicKeyWarning,
  type ReferenceCacheFile,
} from './reference-extractor.js';
import {
  type ReferenceCacheEntry,
  loadReferenceCache,
  saveReferenceCache,
  computeFileFingerprint,
  getCachedEntry,
} from './syncer/reference-cache.js';
import {
  type PlaceholderIssue,
  type EmptyValueViolation,
  collectPlaceholderIssues,
  collectEmptyValueViolations,
} from './syncer/sync-validator.js';
import {
  type SyncValidationState,
  buildActionableItems,
} from './syncer/sync-reporter.js';
import {
  cloneLocaleData,
  applyProjectedValue,
  applyProjectedRemoval,
  buildLocaleKeySets,
  filterSelection,
  buildSelectionSet,
  buildDefaultSourceValue,
} from './syncer/sync-utils.js';
import {
  compileGlob,
  matchesAnyGlob,
  collectPatternMatchedKeys,
} from './syncer/pattern-matcher.js';

export { SuspiciousKeyReason } from './key-validator.js';

// Re-export from reference-extractor
export type { TranslationReference, DynamicKeyReason, DynamicKeyWarning } from './reference-extractor.js';
// Re-export from reference-cache
export type { FileFingerprint, ReferenceCacheEntry } from './syncer/reference-cache.js';
// Re-export from sync-validator
export type { PlaceholderIssue, EmptyValueViolation, EmptyValueViolationReason } from './syncer/sync-validator.js';

export interface MissingKeyRecord {
  key: string;
  references: TranslationReference[];
  suspicious?: boolean;
  // Whether a static fallback literal was found in code (e.g. `t('k') || 'label'`).
  fallbackLiteral?: string;
  // Value recovered/used when seeding missing keys during a write run.
  recoveredValue?: string;
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
  localeDiffs?: LocaleDiffEntry[];
  renameDiffs?: SourceFileDiffEntry[];
  placeholderIssues: PlaceholderIssue[];
  emptyValueViolations: EmptyValueViolation[];
  dynamicKeyWarnings: DynamicKeyWarning[];
  suspiciousKeys: SuspiciousKeyWarning[];
  validation: SyncValidationState;
  assumedKeys: string[];
  write: boolean;
  actionableItems: ActionableItem[];
  backup?: BackupResult;
}

export interface SyncSelection {
  missing?: string[];
  unused?: string[];
}

// Re-export from sync-reporter
export type { SyncValidationState } from './syncer/sync-reporter.js';

export interface SuspiciousKeyWarning {
  key: string;
  filePath: string;
  position: {
    line: number;
    column: number;
  };
  reason: SuspiciousKeyReason | string;
  // Optional: if the suspicious key is used with a static fallback in code,
  // capture it so previews/UX can explain what value would be used after renaming.
  fallbackLiteral?: string;
}

interface TargetReferenceFilter {
  absolute: Set<string>;
  relative: Set<string>;
}

export interface SyncerOptions {
  workspaceRoot?: string;
  project?: Project;
  localeStore?: LocaleStore;
  translationIdentifier?: string;
}

export interface SyncRunOptions {
  write?: boolean;
  prune?: boolean;
  backup?: boolean;
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
  prune: boolean;
  backup: boolean;
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
  private readonly keyValidator: KeyValidator;
  private readonly extractor: ReferenceExtractor;

  constructor(private readonly config: I18nConfig, options: SyncerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
      this.project = options.project ?? createDefaultProject();
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
    const localeStoreOptions = {
      format: config.locales?.format ?? 'auto',
      delimiter: config.locales?.delimiter ?? '.',
      sortKeys: config.locales?.sortKeys ?? 'alphabetical',
    };
    this.localeStore = options.localeStore ?? new LocaleStore(localesDir, localeStoreOptions);
    const syncOptions = this.config.sync ?? {};
    const placeholderFormats = syncOptions.placeholderFormats?.length
      ? syncOptions.placeholderFormats
      : DEFAULT_PLACEHOLDER_FORMATS;
    this.placeholderPatterns = buildPlaceholderPatterns(placeholderFormats);
    this.translationIdentifier = options.translationIdentifier ?? syncOptions.translationIdentifier ?? 't';
    this.extractor = new ReferenceExtractor(config, {
      workspaceRoot: this.workspaceRoot,
      project: this.project,
      translationIdentifier: this.translationIdentifier,
    });
    this.sourceLocale = config.sourceLanguage ?? 'en';
    this.targetLocales = (config.targetLanguages ?? []).filter(Boolean);
    this.defaultValidateInterpolations = syncOptions.validateInterpolations ?? false;
    this.defaultEmptyValuePolicy = syncOptions.emptyValuePolicy ?? 'warn';
    const emptyMarkers = syncOptions.emptyValueMarkers?.length
      ? syncOptions.emptyValueMarkers
      : DEFAULT_EMPTY_VALUE_MARKERS;
    this.emptyValueMarkers = new Set(emptyMarkers.map((marker) => marker.toLowerCase()));
    this.suspiciousKeyPolicy = syncOptions.suspiciousKeyPolicy ?? 'skip';
    this.keyValidator = new KeyValidator(this.suspiciousKeyPolicy);
    this.defaultAssumedKeys = syncOptions.dynamicKeyAssumptions ?? [];
    const globPatterns = syncOptions.dynamicKeyGlobs ?? [];
    this.dynamicKeyGlobMatchers = globPatterns
      .map((pattern) => pattern.trim())
      .filter(Boolean)
      .map((pattern) => compileGlob(pattern));
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
    const cacheState = await loadReferenceCache(
      this.referenceCachePath,
      this.translationIdentifier,
      runOptions.invalidateCache
    );
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

    const projectedLocaleData = cloneLocaleData(localeData);
    const localeKeySets = buildLocaleKeySets(localeData);

    const { missingKeys, missingKeysToApply } = await this.processMissingKeys(
      scopedKeySet,
      scopedReferencesByKey,
      localeKeySets,
      projectedLocaleData,
      runtime.selectedMissingKeys,
      localeData,
      runtime.write
    );

    const { unusedKeys, unusedKeysToApply } = this.processUnusedKeys(
      keySet,
      localeKeySets,
      projectedLocaleData,
      runtime.selectedUnusedKeys,
      !targetFilter,
      runtime.prune
    );

    const placeholderIssues = runtime.validateInterpolations
      ? collectPlaceholderIssues(localeData, scopedReferencesByKey, this.sourceLocale, this.targetLocales, this.placeholderPatterns)
      : [];
    const emptyValueViolations = collectEmptyValueViolations(
      localeData,
      referencesByKey,
      this.targetLocales,
      this.emptyValueMarkers
    );

    // Collect suspicious keys from code references
    const suspiciousKeys: SuspiciousKeyWarning[] = [];
    for (const key of scopedKeySet) {
      const analysis = this.analyzeSuspiciousKey(key);
      if (analysis.suspicious) {
        const refs = scopedReferencesByKey.get(key) ?? [];
        let fallbackLiteral = refs.find((ref) => typeof ref.fallbackLiteral === 'string')?.fallbackLiteral;
        // If fallbackLiteral is missing (e.g. due to a stale cache entry), do a cheap
        // text scan as best-effort recovery so previews can still be informative.
        if (!fallbackLiteral && refs.length > 0) {
          try {
            const refPath = path.join(this.workspaceRoot, refs[0].filePath);
            const txt = await fs.readFile(refPath, 'utf8');
            const escapedKey = escapeRegExp(key);
            const re = new RegExp(
              String.raw`t\(\s*['\"]${escapedKey}['\"]\s*\)\s*(?:\|\||\?\?)\s*['\"]([^'\"]+)['\"]`
            );
            const m = txt.match(re);
            if (m && m[1]) {
              fallbackLiteral = m[1];
            }
          } catch {
            // ignore
          }
        }
        for (const ref of refs) {
          suspiciousKeys.push({
            key,
            filePath: ref.filePath,
            position: ref.position,
            reason: analysis.reason ?? 'unknown',
            fallbackLiteral: fallbackLiteral && fallbackLiteral.trim().length ? fallbackLiteral : undefined,
          });
        }
      }
    }

    // Post-sync audit: Check locale file for key-equals-value patterns
    const sourceData = localeData.get(this.sourceLocale) ?? {};
    for (const [key, value] of Object.entries(sourceData)) {
      const analysis = this.keyValidator.analyzeWithValue(key, value);
      if (analysis.suspicious && analysis.reason === 'key-equals-value') {
        // Only add if not already reported from code references
        const alreadyReported = suspiciousKeys.some(
          (w) => w.key === key && w.reason === 'key-equals-value'
        );
        if (!alreadyReported) {
          // Try to find source file reference for better context
          const refs = scopedReferencesByKey.get(key) ?? [];
          if (refs.length > 0) {
            // Use the first source file reference for key generation context
            suspiciousKeys.push({
              key,
              filePath: refs[0].filePath,
              position: refs[0].position,
              reason: 'key-equals-value',
            });
          } else {
            // No source reference found, use locale file (fallback)
            suspiciousKeys.push({
              key,
              filePath: this.localeStore.getFilePath(this.sourceLocale),
              position: { line: 0, column: 0 },
              reason: 'key-equals-value',
            });
          }
        }
      }
    }

    let localeStats: LocaleFileStats[] = [];
    let backupResult: BackupResult | undefined;

    if (write) {
      // Create backup before any destructive write operations
      if (runtime.backup) {
        const localesDir = path.resolve(this.workspaceRoot, this.config.localesDir ?? 'locales');
        const result = await createBackup(
          localesDir,
          this.workspaceRoot,
          {},
          runtime.prune ? 'sync --write --prune' : 'sync --write'
        );
        if (result) {
          backupResult = result;
        }
      }

      await this.applyMissingKeys(missingKeysToApply);
      await this.applyUnusedKeys(unusedKeysToApply);
      // Seed keys from source to target locales if configured
      if (this.config.seedTargetLocales) {
        await this.seedSourceToTargets(localeData);
      }
      
      // Ensure all target locale files exist (create empty files if missing)
      await this.localeStore.ensureFilesExist(this.targetLocales);
      
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
    const localeDiffs = diffs; // Alias for consistency with KeyRenamer
    await saveReferenceCache(
      this.referenceCachePath,
      this.cacheDir,
      this.translationIdentifier,
      nextCacheEntries
    );

    const actionableItems = buildActionableItems({
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
      localeDiffs,
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
      backup: backupResult,
    };
  }

  private analyzeSuspiciousKey(key: string): { suspicious: boolean; reason?: SuspiciousKeyReason } {
    return this.keyValidator.analyze(key);
  }

  private isSuspiciousKey(key: string): boolean {
    return this.keyValidator.analyze(key).suspicious;
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

  private async processMissingKeys(
    keySet: Set<string>,
    referencesByKey: Map<string, TranslationReference[]>,
    localeKeySets: Map<string, Set<string>>,
    projectedLocaleData: Map<string, Record<string, string>>,
    selectedMissingKeys?: Set<string>,
    localeData?: Map<string, Record<string, string>>,
    allowWrites: boolean = false
  ) {
  const sourceLocaleKeys = localeKeySets.get(this.sourceLocale) ?? new Set<string>();
  const shouldTreatEmptyAsMissing = this.defaultEmptyValuePolicy !== 'ignore';
    const missingKeys: MissingKeyRecord[] = [];

    const sourceProjected = projectedLocaleData.get(this.sourceLocale) ?? {};
    const missingKeyCandidates = Array.from(keySet).filter((k) => {
      if (!sourceLocaleKeys.has(k)) {
        return true;
      }
      if (!shouldTreatEmptyAsMissing) {
        return false;
      }
      const existingValue = sourceProjected[k];
      return typeof existingValue === 'string' && existingValue.trim().length === 0;
    });

    for (const key of missingKeyCandidates) {
      const refs = referencesByKey.get(key) ?? [];
      let fallbackLiteral = refs.find((ref) => typeof ref.fallbackLiteral === 'string')?.fallbackLiteral;
      // Heuristic fallback: if the reference cache didn't include a fallbackLiteral
      // (e.g., stale cache), try a cheap text-based scan of the source file to find
      // a literal fallback pattern like `t('key') || 'label'`.
      if (!fallbackLiteral && refs.length > 0) {
        try {
          const refPath = path.join(this.workspaceRoot, refs[0].filePath);
          const txt = await fs.readFile(refPath, 'utf8');
          const escapedKey = escapeRegExp(key);
          const re = new RegExp(
            String.raw`t\(\s*['\"]${escapedKey}['\"]\s*\)\s*(?:\|\||\?\?)\s*['\"]([^'\"]+)['\"]`
          );
          const m = txt.match(re);
          if (m && m[1]) {
            fallbackLiteral = m[1];
          }
        } catch (e) {
          // ignore read errors; fallback remains undefined
        }
      }
      missingKeys.push({
        key,
        references: refs,
        suspicious: this.isSuspiciousKey(key),
        fallbackLiteral: typeof fallbackLiteral === 'string' && fallbackLiteral.trim().length ? fallbackLiteral : undefined,
      } as MissingKeyRecord);
    }

    const autoApplyCandidates = missingKeys.filter((record) =>
      this.shouldAutoApplyMissingKey(record, selectedMissingKeys)
    );
    const missingKeysToApply = filterSelection(autoApplyCandidates, selectedMissingKeys);

    // Ensure fallback literals are ready for display even when we are not writing.
    // This improves preview/report quality and allows UIs to explain *why* a value
    // would be chosen without actually mutating locale files.
    for (const record of missingKeys) {
      if (!record.fallbackLiteral) {
        const refs = referencesByKey.get(record.key) ?? [];
        const fallbackLiteral = refs.find((ref) => typeof ref.fallbackLiteral === 'string')?.fallbackLiteral;
        if (fallbackLiteral && fallbackLiteral.trim().length) {
          record.fallbackLiteral = fallbackLiteral;
        }
      }
    }

    // Pre-calculate unused keys for value recovery if localeData is available
    const unusedKeysForRecovery: string[] = [];
    if (localeData) {
      const sourceKeys = localeKeySets.get(this.sourceLocale);
      if (sourceKeys) {
        for (const key of sourceKeys) {
          if (!keySet.has(key)) {
            unusedKeysForRecovery.push(key);
          }
        }
        // Sort by length descending to match longest possible key first
        unusedKeysForRecovery.sort((a, b) => b.length - a.length);
      }
    }

    // NOTE: placeholder validation (--validate-interpolations) should not implicitly
    // write missing-key defaults. Missing keys are only applied when the user
    // explicitly requested sync writes (or selected missing keys via interactive/selection).
    // We still *report* missingKeys/missingKeysToApply, but don't mutate projected locale
    // data unless the run is allowed to write.
  const allowMissingKeyWrites = allowWrites;

    if (allowMissingKeyWrites) {
      for (const record of missingKeysToApply) {
        let defaultValue = buildDefaultSourceValue(record.key);

        // Prefer a literal UI fallback from code when present.
        // Example: `t('form.email') || 'Email'` → seed source value as 'Email'.
        if (record.fallbackLiteral && record.fallbackLiteral.trim().length) {
          defaultValue = record.fallbackLiteral;
          record.recoveredValue = record.fallbackLiteral;
        }

        // Try to recover value from unused keys
        if (!record.fallbackLiteral && localeData && unusedKeysForRecovery.length > 0) {
          const recovered = this.recoverValueFromUnused(record.key, unusedKeysForRecovery, localeData);
          if (recovered) {
            defaultValue = recovered;
            record.recoveredValue = recovered;
          }
        }

        applyProjectedValue(projectedLocaleData, this.sourceLocale, record.key, defaultValue);
        if (this.config.seedTargetLocales) {
          const seedValue = this.config.sync?.seedValue ?? '';
          for (const locale of this.targetLocales) {
            applyProjectedValue(projectedLocaleData, locale, record.key, seedValue);
          }
        }
      }
    }
    return { missingKeys, missingKeysToApply };
  }

  private recoverValueFromUnused(
    missingKey: string,
    unusedKeys: string[],
    localeData: Map<string, Record<string, string>>
  ): string | undefined {
    for (const unusedKey of unusedKeys) {
      if (this.isKeyComponent(missingKey, unusedKey)) {
        const value = localeData.get(this.sourceLocale)?.[unusedKey];
        if (value) return value;
      }
    }
    return undefined;
  }

  private isKeyComponent(fullKey: string, component: string): boolean {
    if (fullKey === component) return false;
    if (!fullKey.includes(component)) return false;

    const idx = fullKey.indexOf(component);
    if (idx === -1) return false;

    const charBefore = idx > 0 ? fullKey[idx - 1] : '.';
    const charAfter = idx + component.length < fullKey.length ? fullKey[idx + component.length] : '.';

    return charBefore === '.' && charAfter === '.';
  }

  private processUnusedKeys(
    keySet: Set<string>,
    localeKeySets: Map<string, Set<string>>,
    projectedLocaleData: Map<string, Record<string, string>>,
    selectedUnusedKeys?: Set<string>,
    enabled: boolean = true,
    prune: boolean = false
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

    // Only apply removal if prune is explicitly enabled
    // selectedUnusedKeys is from interactive mode where user explicitly selected keys
    const unusedKeysToApply = selectedUnusedKeys
      ? filterSelection(unusedKeys, selectedUnusedKeys)
      : prune
      ? unusedKeys
      : [];

    for (const record of unusedKeysToApply) {
      record.locales.forEach((locale) => {
        applyProjectedRemoval(projectedLocaleData, locale, record.key);
      });
    }

    return { unusedKeys, unusedKeysToApply };
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
      const fingerprint = await computeFileFingerprint(absolutePath);

      let fileReferences: TranslationReference[];
      let fileWarnings: DynamicKeyWarning[];

      const cachedEntry = canUseCache
        ? getCachedEntry(cache!, relativePath, fingerprint)
        : undefined;

      if (cachedEntry) {
        fileReferences = cachedEntry.references;
        fileWarnings = cachedEntry.dynamicKeyWarnings;
        nextCacheEntries[relativePath] = cachedEntry;
      } else {
        let extracted: { references: TranslationReference[]; dynamicKeyWarnings: DynamicKeyWarning[] };
        
        if (absolutePath.endsWith('.vue')) {
          extracted = await this.extractor.extractFromVueFile(absolutePath);
        } else {
          const sourceFile = this.project.addSourceFileAtPath(absolutePath);
          extracted = this.extractor.extractFromFile(sourceFile);
        }
        
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

  private async applyMissingKeys(missingKeys: MissingKeyRecord[]) {
    for (const record of missingKeys) {
      const defaultValue = record.recoveredValue ?? buildDefaultSourceValue(record.key);
      await this.localeStore.upsert(this.sourceLocale, record.key, defaultValue);
      if (this.config.seedTargetLocales) {
        const seedValue = this.config.sync?.seedValue ?? '';
        for (const locale of this.targetLocales) {
          await this.localeStore.upsert(locale, record.key, seedValue);
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

  /**
   * Seeds keys from source locale to target locales if they are missing.
   * This ensures target locales have the same structure as the source.
   */
  private async seedSourceToTargets(localeData: Map<string, Record<string, string>>) {
    const seedValue = this.config.sync?.seedValue ?? '';
    const sourceData = localeData.get(this.sourceLocale) ?? {};
    const sourceKeys = Object.keys(sourceData);

    for (const locale of this.targetLocales) {
      const targetData = localeData.get(locale) ?? {};
      for (const key of sourceKeys) {
        if (!(key in targetData)) {
          await this.localeStore.upsert(locale, key, seedValue);
        }
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

    const selectedMissingKeys = buildSelectionSet(runOptions.selection?.missing);
    const selectedUnusedKeys = buildSelectionSet(runOptions.selection?.unused);

    // prune defaults to false for safety - unused keys are only removed with explicit --prune flag
    const prune = runOptions.prune ?? false;

    // backup defaults to true when writing destructive changes (write+prune)
    const backup = runOptions.backup ?? (write && prune);

    return {
      write,
      prune,
      backup,
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

  private collectPatternAssumedKeys(localeData: Map<string, Record<string, string>>): Set<string> {
    return collectPatternMatchedKeys(localeData, this.dynamicKeyGlobMatchers);
  }

  private matchesDynamicKeyGlobs(key: string): boolean {
    return matchesAnyGlob(key, this.dynamicKeyGlobMatchers);
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
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
