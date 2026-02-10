/**
 * Configuration normalization utilities
 * 
 * These functions take raw/unknown input and return properly typed values,
 * applying defaults where necessary.
 */

import type {
  I18nConfig,
  LocaleFormat,
  LocaleSortOrder,
  SuspiciousKeyPolicy,
  PlaceholderFormat,
  EmptyValuePolicy,
  TranslationConfig,
  DiagnosticsConfig,
  DiagnosticsAdapterHintConfig,
  RawLocalesConfig,
} from './types.js';
import {
  DEFAULT_INCLUDE,
  DEFAULT_EXCLUDE,
  DEFAULT_PLACEHOLDER_FORMATS,
  DEFAULT_EMPTY_VALUE_MARKERS,
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_LOCALES_DIR,
  DEFAULT_MIN_TEXT_LENGTH,
  DEFAULT_LOCALE_FORMAT,
  DEFAULT_LOCALE_DELIMITER,
  DEFAULT_LOCALE_SORT_KEYS,
  DEFAULT_KEY_NAMESPACE,
  DEFAULT_SHORT_HASH_LEN,
  DEFAULT_TRANSLATION_IDENTIFIER,
  DEFAULT_ADAPTER_MODULE,
  DEFAULT_ADAPTER_HOOK,
} from './defaults.js';

// ─────────────────────────────────────────────────────────────────────────────
// Type Guards
// ─────────────────────────────────────────────────────────────────────────────

export const isLocaleFormat = (value: string): value is LocaleFormat =>
  value === 'flat' || value === 'nested' || value === 'auto';

export const isLocaleSortOrder = (value: unknown): value is LocaleSortOrder =>
  value === 'alphabetical' || value === 'preserve' || value === 'insertion';

export const isSuspiciousKeyPolicy = (value: unknown): value is SuspiciousKeyPolicy =>
  value === 'allow' || value === 'skip' || value === 'error';

export const isPlaceholderFormat = (value: string): value is PlaceholderFormat =>
  (DEFAULT_PLACEHOLDER_FORMATS as readonly string[]).includes(value);

// ─────────────────────────────────────────────────────────────────────────────
// Array Utilities
// ─────────────────────────────────────────────────────────────────────────────

export function ensureStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean);
  }

  return [];
}

export function ensureArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value) && value.length) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  return fallback;
}

export function ensureOptionalArray(value: unknown): string[] | undefined {
  const normalized = ensureStringArray(value);
  return normalized.length ? normalized : undefined;
}

export function ensureUniqueStrings(value: unknown): string[] | undefined {
  const normalized = ensureOptionalArray(value);
  return normalized ? Array.from(new Set(normalized)) : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitive Normalizers
// ─────────────────────────────────────────────────────────────────────────────

export function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

export function normalizeLocaleFormat(value: unknown): LocaleFormat {
  if (typeof value !== 'string') {
    return DEFAULT_LOCALE_FORMAT as LocaleFormat;
  }
  const normalized = value.trim().toLowerCase();
  return isLocaleFormat(normalized) ? normalized : (DEFAULT_LOCALE_FORMAT as LocaleFormat);
}

export function normalizeLocaleDelimiter(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length) {
      return trimmed;
    }
  }
  return DEFAULT_LOCALE_DELIMITER;
}

export function normalizePlaceholderFormats(value: unknown): PlaceholderFormat[] {
  const raw = ensureStringArray(value);
  const filtered = raw.filter(isPlaceholderFormat);
  return filtered.length ? filtered : DEFAULT_PLACEHOLDER_FORMATS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Complex Config Normalizers
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeTranslationConfig(input: unknown): TranslationConfig | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const providerRaw =
    typeof raw.provider === 'string' && raw.provider.trim().length > 0
      ? raw.provider.trim()
      : typeof raw.service === 'string' && raw.service.trim().length > 0
      ? raw.service.trim()
      : undefined;
  const provider = providerRaw ?? 'manual';

  const translationConfig: TranslationConfig = {
    provider,
  };

  const secretEnvVar =
    typeof raw.secretEnvVar === 'string' && raw.secretEnvVar.trim().length > 0
      ? raw.secretEnvVar.trim()
      : undefined;
  if (secretEnvVar) {
    translationConfig.secretEnvVar = secretEnvVar;
  }

  const legacyApiKey =
    typeof raw.apiKey === 'string' && raw.apiKey.trim().length > 0 ? raw.apiKey.trim() : undefined;
  if (legacyApiKey) {
    translationConfig.apiKey = legacyApiKey;
  }

  const moduleSpecifier =
    typeof raw.module === 'string' && raw.module.trim().length > 0 ? raw.module.trim() : undefined;
  if (moduleSpecifier) {
    translationConfig.module = moduleSpecifier;
  }

  const concurrency = normalizePositiveInteger(raw.concurrency);
  if (concurrency) {
    translationConfig.concurrency = concurrency;
  }

  const batchSize = normalizePositiveInteger(raw.batchSize);
  if (batchSize) {
    translationConfig.batchSize = batchSize;
  }

  const locales = ensureUniqueStrings(raw.locales);
  if (locales?.length) {
    translationConfig.locales = locales;
  }

  return translationConfig;
}

export function normalizeDiagnosticsConfig(input: unknown): DiagnosticsConfig | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const raw = input as Record<string, unknown>;
  const runtimePackages = ensureUniqueStrings(raw.runtimePackages);
  const providerGlobs = ensureUniqueStrings(raw.providerGlobs);
  const include = ensureUniqueStrings(raw.include);
  const exclude = ensureUniqueStrings(raw.exclude);
  const adapterHints = Array.isArray(raw.adapterHints)
    ? raw.adapterHints
        .map((entry) => normalizeAdapterHint(entry))
        .filter((entry): entry is DiagnosticsAdapterHintConfig => Boolean(entry))
    : undefined;
  const maxSourceFiles =
    typeof raw.maxSourceFiles === 'number' && Number.isFinite(raw.maxSourceFiles) && raw.maxSourceFiles > 0
      ? Math.floor(raw.maxSourceFiles)
      : undefined;

  const diagnostics: DiagnosticsConfig = {};
  if (runtimePackages) diagnostics.runtimePackages = runtimePackages;
  if (providerGlobs) diagnostics.providerGlobs = providerGlobs;
  if (include) diagnostics.include = include;
  if (exclude) diagnostics.exclude = exclude;
  if (adapterHints && adapterHints.length) diagnostics.adapterHints = adapterHints;
  if (maxSourceFiles) diagnostics.maxSourceFiles = maxSourceFiles;

  return Object.keys(diagnostics).length ? diagnostics : undefined;
}

export function normalizeAdapterHint(entry: unknown): DiagnosticsAdapterHintConfig | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const raw = entry as Record<string, unknown>;
  const pathValue = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (!pathValue) {
    return undefined;
  }
  const typeValue = raw.type === 'react-i18next' || raw.type === 'custom' ? raw.type : undefined;
  return {
    path: pathValue,
    type: typeValue ?? 'custom',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Config Normalizer
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeConfig(parsed: Partial<I18nConfig>): I18nConfig {
  const translationConfig = normalizeTranslationConfig(parsed.translation);

  const adapter =
    typeof parsed.translationAdapter === 'object' && parsed.translationAdapter
      ? parsed.translationAdapter
      : undefined;

  const adapterModule =
    typeof adapter?.module === 'string' && adapter.module.trim().length > 0
      ? adapter.module.trim()
      : DEFAULT_ADAPTER_MODULE;
  const adapterHook =
    typeof adapter?.hookName === 'string' && adapter.hookName.trim().length > 0
      ? adapter.hookName.trim()
      : DEFAULT_ADAPTER_HOOK;

  const keyGen = parsed.keyGeneration || {};
  const syncConfig = parsed.sync || {};
  const localesConfig =
    typeof parsed.locales === 'object' && parsed.locales !== null
      ? (parsed.locales as RawLocalesConfig)
      : undefined;
  const translationIdentifier =
    typeof syncConfig.translationIdentifier === 'string' && syncConfig.translationIdentifier.trim().length > 0
      ? syncConfig.translationIdentifier.trim()
      : DEFAULT_TRANSLATION_IDENTIFIER;
  const validateInterpolations = typeof syncConfig.validateInterpolations === 'boolean'
    ? syncConfig.validateInterpolations
    : false;
  const placeholderFormats = normalizePlaceholderFormats(syncConfig.placeholderFormats);
  const emptyValuePolicy: EmptyValuePolicy = syncConfig.emptyValuePolicy === 'fail'
    ? 'fail'
    : syncConfig.emptyValuePolicy === 'ignore'
    ? 'ignore'
    : 'warn';
  const emptyValueMarkersRaw = ensureStringArray(syncConfig.emptyValueMarkers);
  const emptyValueMarkers = emptyValueMarkersRaw.length ? emptyValueMarkersRaw : DEFAULT_EMPTY_VALUE_MARKERS;
  const dynamicKeyAssumptions = ensureStringArray(syncConfig.dynamicKeyAssumptions);
  const dynamicKeyGlobs = ensureStringArray(syncConfig.dynamicKeyGlobs);
  const suspiciousKeyPolicy = isSuspiciousKeyPolicy(syncConfig.suspiciousKeyPolicy)
    ? syncConfig.suspiciousKeyPolicy
    : 'skip';

  const keyNamespace = typeof keyGen.namespace === 'string' && keyGen.namespace.trim().length > 0
    ? keyGen.namespace.trim()
    : DEFAULT_KEY_NAMESPACE;
  const shortHashLen = typeof keyGen.shortHashLen === 'number' && keyGen.shortHashLen > 0
    ? keyGen.shortHashLen
    : DEFAULT_SHORT_HASH_LEN;
  const localeFormat = normalizeLocaleFormat(localesConfig?.format);
  const localeDelimiter = normalizeLocaleDelimiter(localesConfig?.delimiter);
  const localeSortKeys = isLocaleSortOrder(localesConfig?.sortKeys)
    ? localesConfig!.sortKeys!
    : (DEFAULT_LOCALE_SORT_KEYS as LocaleSortOrder);

  const diagnosticsConfig = normalizeDiagnosticsConfig(parsed.diagnostics);
  const extractionConfig = parsed.extraction ?? {};
  const translatableAttributes = ensureUniqueStrings(extractionConfig.translatableAttributes);
  const nonTranslatableAttributes = ensureUniqueStrings(extractionConfig.nonTranslatableAttributes);
  const attributeSuffixes = ensureUniqueStrings(extractionConfig.attributeSuffixes);
  const mergeStrategy =
    typeof parsed.mergeStrategy === 'string' && ['keep-source', 'overwrite', 'interactive'].includes(parsed.mergeStrategy)
      ? (parsed.mergeStrategy as 'keep-source' | 'overwrite' | 'interactive')
      : undefined;

  const normalized: I18nConfig = {
    version: (parsed.version ?? 1) as 1,
    sourceLanguage: parsed.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE,
    targetLanguages: ensureStringArray(parsed.targetLanguages) ?? [],
    localesDir: parsed.localesDir ?? DEFAULT_LOCALES_DIR,
    include: ensureArray(parsed.include, DEFAULT_INCLUDE),
    exclude: ensureArray(parsed.exclude, DEFAULT_EXCLUDE),
    minTextLength: typeof parsed.minTextLength === 'number' && parsed.minTextLength >= 0
      ? parsed.minTextLength
      : DEFAULT_MIN_TEXT_LENGTH,
    extraction: {
      minLetterCount: typeof extractionConfig.minLetterCount === 'number' && extractionConfig.minLetterCount >= 0
        ? extractionConfig.minLetterCount
        : undefined,
      minLetterRatio: typeof extractionConfig.minLetterRatio === 'number' && extractionConfig.minLetterRatio >= 0
        ? extractionConfig.minLetterRatio
        : undefined,
      preserveNewlines: typeof extractionConfig.preserveNewlines === 'boolean'
        ? extractionConfig.preserveNewlines
        : undefined,
      decodeHtmlEntities: typeof extractionConfig.decodeHtmlEntities === 'boolean'
        ? extractionConfig.decodeHtmlEntities
        : undefined,
      allowPatterns: ensureOptionalArray(extractionConfig.allowPatterns),
      denyPatterns: ensureOptionalArray(extractionConfig.denyPatterns),
      translatableAttributes,
      nonTranslatableAttributes,
      attributeSuffixes,
      dedupeCandidates: typeof extractionConfig.dedupeCandidates === 'boolean'
        ? extractionConfig.dedupeCandidates
        : true,
    },
    translation: translationConfig,
    translationAdapter: {
      module: adapterModule,
      hookName: adapterHook,
    },
    locales: {
      format: localeFormat,
      delimiter: localeDelimiter,
      sortKeys: localeSortKeys,
    },
    keyGeneration: {
      namespace: keyNamespace,
      shortHashLen,
    },
    seedTargetLocales: typeof parsed.seedTargetLocales === 'boolean' ? parsed.seedTargetLocales : false,
    mergeStrategy,
    sync: {
      translationIdentifier,
      validateInterpolations,
      placeholderFormats,
      emptyValuePolicy,
      emptyValueMarkers,
      dynamicKeyAssumptions,
      dynamicKeyGlobs,
      retainLocales: typeof syncConfig.retainLocales === 'boolean' ? syncConfig.retainLocales : true,
      suspiciousKeyPolicy,
      seedValue: typeof syncConfig.seedValue === 'string' ? syncConfig.seedValue : '',
    },
    diagnostics: diagnosticsConfig,
    frameworks: ensureOptionalArray(parsed.frameworks),
  };

  return normalized;
}
