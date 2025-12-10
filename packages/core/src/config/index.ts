/**
 * Configuration module for i18nsmith
 *
 * This module handles loading, parsing, and normalizing configuration files.
 */

// Re-export all types
export type {
  LocaleFormat,
  SuspiciousKeyPolicy,
  LocaleSortOrder,
  PlaceholderFormat,
  EmptyValuePolicy,
  TranslationAdapterConfig,
  TranslationConfig,
  KeyGenerationConfig,
  SyncConfig,
  DiagnosticsConfig,
  DiagnosticsAdapterHintConfig,
  LocalesConfig,
  I18nConfig,
  LoadConfigResult,
} from './types.js';

// Re-export defaults
export {
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
  DEFAULT_CONFIG_FILENAME,
} from './defaults.js';

// Re-export normalizer utilities (for testing and advanced use)
export {
  isLocaleFormat,
  isLocaleSortOrder,
  isSuspiciousKeyPolicy,
  isPlaceholderFormat,
  ensureStringArray,
  ensureArray,
  ensureOptionalArray,
  ensureUniqueStrings,
  normalizePositiveInteger,
  normalizeLocaleFormat,
  normalizeLocaleDelimiter,
  normalizePlaceholderFormats,
  normalizeTranslationConfig,
  normalizeDiagnosticsConfig,
  normalizeAdapterHint,
  normalizeConfig,
} from './normalizer.js';

// Re-export loader functions
export {
  loadConfig,
  loadConfigWithMeta,
} from './loader.js';

export { inferConfig } from './inference.js';
