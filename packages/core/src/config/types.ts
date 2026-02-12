/**
 * Configuration type definitions for i18nsmith
 */

// ─────────────────────────────────────────────────────────────────────────────
// Core Types
// ─────────────────────────────────────────────────────────────────────────────

export type LocaleFormat = 'flat' | 'nested' | 'auto';
export type SuspiciousKeyPolicy = 'allow' | 'skip' | 'error';
export type LocaleSortOrder = 'alphabetical' | 'preserve' | 'insertion';
export type PlaceholderFormat = 'doubleCurly' | 'percentCurly' | 'percentSymbol';
export type EmptyValuePolicy = 'ignore' | 'warn' | 'fail';

// ─────────────────────────────────────────────────────────────────────────────
// Translation Adapter Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface TranslationAdapterConfig {
  /**
   * Module specifier to import the translation hook from (e.g. 'react-i18next' or '@/contexts/translation-context').
   */
  module: string;
  /**
   * Name of the hook/function to import.
   * Defaults to `useTranslation` when omitted.
   */
  hookName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Translation Provider Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface TranslationConfig {
  provider: string;
  secretEnvVar?: string;
  apiKey?: string;
  module?: string;
  concurrency?: number;
  batchSize?: number;
  locales?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Generation Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface KeyGenerationConfig {
  /**
   * Namespace prefix for generated keys (e.g. 'common').
   * Defaults to 'common'.
   */
  namespace?: string;
  /**
   * Length of the short hash suffix (e.g. 6).
   * Defaults to 6.
   */
  shortHashLen?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncConfig {
  translationIdentifier?: string;
  validateInterpolations?: boolean;
  placeholderFormats?: PlaceholderFormat[];
  emptyValuePolicy?: EmptyValuePolicy;
  emptyValueMarkers?: string[];
  dynamicKeyAssumptions?: string[];
  dynamicKeyGlobs?: string[];
  retainLocales?: boolean;
  suspiciousKeyPolicy?: SuspiciousKeyPolicy;
  /**
   * Value to use when seeding target locales with missing keys.
   * Defaults to "" (empty string). Set to "[TODO]" for visible markers.
   */
  seedValue?: string;
  /**
   * Whether to protect keys with empty values in target locales from being
   * treated as unused when they exist with values in the source locale.
   * Defaults to true.
   */
  emptyKeyProtection?: boolean;
}

export type MergeStrategy = 'keep-source' | 'overwrite' | 'interactive';

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface DiagnosticsConfig {
  runtimePackages?: string[];
  providerGlobs?: string[];
  adapterHints?: DiagnosticsAdapterHintConfig[];
  include?: string[];
  exclude?: string[];
  maxSourceFiles?: number;
}

export interface DiagnosticsAdapterHintConfig {
  path: string;
  type: 'react-i18next' | 'custom';
}

// ─────────────────────────────────────────────────────────────────────────────
// Locales Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalesConfig {
  format?: LocaleFormat;
  delimiter?: string;
  /**
   * Key sorting behavior when writing locale files.
   * - 'alphabetical': Sort keys alphabetically (default, deterministic output)
   * - 'preserve': Preserve existing key order, append new keys at end
   * - 'insertion': Order keys by insertion order (new keys appended)
   */
  sortKeys?: LocaleSortOrder;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Configuration Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface I18nConfig {
  /**
   * Configuration schema version.
   * Used to support future, backwards-compatible evolutions of the config file.
   * Defaults to 1 when omitted.
   */
  configVersion?: number;
  /**
   * @deprecated Use configVersion instead.
   */
  version?: number;
  /**
   * Source language of the application (default: 'en')
   */
  sourceLanguage: string;
  /**
   * Target languages to translate to
   */
  targetLanguages: string[];
  /**
   * @deprecated Use targetLanguages (alias from legacy config).
   */
  targetLocales?: string[];
  /**
   * Path to the locale files directory
   */
  localesDir: string;
  /**
   * Locale storage/persistence configuration
   */
  locales?: LocalesConfig;
  /**
   * Glob patterns to include for scanning
   */
  include: string[];
  /**
   * Glob patterns to exclude from scanning
   */
  exclude?: string[];
  /**
   * Minimum length for translatable text (default: 1)
   */
  minTextLength?: number;
  /**
   * Extraction-related configuration (heuristics for detecting translatable text)
   */
  extraction?: {
    /** Minimum number of unicode letters required to consider text translatable (default: 1) */
    minLetterCount?: number;
    /** Minimum ratio of letters to total characters to consider text translatable (default: 0.25) */
    minLetterRatio?: number;
    /** Preserve newline characters when normalizing text (default: false) */
    preserveNewlines?: boolean;
    /** Decode HTML entities like &amp;, &apos;, &#10; before processing (default: true) */
    decodeHtmlEntities?: boolean;
    /** Regex patterns that should always be treated as translatable (bypass heuristics) */
    allowPatterns?: string[];
    /** Regex patterns that should always be skipped (override heuristics) */
    denyPatterns?: string[];
    /** Additional attributes to treat as translatable in Vue templates */
    translatableAttributes?: string[];
    /** Attributes to exclude from translation in Vue templates */
    nonTranslatableAttributes?: string[];
    /** Attribute name suffixes that should be treated as translatable (default: label, text, title, message, description, hint, placeholder) */
    attributeSuffixes?: string[];
    /** Deduplicate identical candidates emitted multiple times (default: true) */
    dedupeCandidates?: boolean;
  };
  /**
   * Translation service configuration
   */
  translation?: TranslationConfig;
  /**
   * Configure how transformed components access the `t` helper.
   * Defaults to importing `useTranslation` from `react-i18next`.
   */
  translationAdapter?: TranslationAdapterConfig;
  /**
   * Key generation configuration
   */
  keyGeneration?: KeyGenerationConfig;
  /**
   * Whether to seed target locale files with empty values (default: false)
   */
  seedTargetLocales?: boolean;

  /**
   * Merge strategy to apply when syncing or initializing locales.
   * - 'keep-source': preserve existing values and append missing keys
   * - 'overwrite': replace target values with placeholders
   * - 'interactive': prompt before applying changes (CLI)
   */
  mergeStrategy?: MergeStrategy;

  sync?: SyncConfig;

  diagnostics?: DiagnosticsConfig;

  /**
   * Dynamic key expansion configuration for runtime-generated keys.
   */
  dynamicKeys?: {
    /**
     * Map glob-like patterns to enumerated values.
     * Example: { "workingHours.*": ["monday", "tuesday"] }
     */
    expand?: Record<string, string[]>;
  };

  /**
   * Explicit list of frameworks to enable for extraction.
   * When specified, only these frameworks will be used for scanning files.
   * When omitted, frameworks are auto-detected based on file extensions.
   * Available frameworks: 'react', 'vue', 'svelte', etc.
   */
  frameworks?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader Result Types
// ─────────────────────────────────────────────────────────────────────────────

export interface LoadConfigResult {
  config: I18nConfig;
  configPath: string;
  projectRoot: string;
  warnings?: DeprecatedConfigWarning[];
}

export interface DeprecatedConfigWarning {
  field: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal Types (for normalization)
// ─────────────────────────────────────────────────────────────────────────────

export type RawLocalesConfig = {
  format?: unknown;
  delimiter?: unknown;
  sortKeys?: unknown;
};
