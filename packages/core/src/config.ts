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

export interface I18nConfig {
  /**
   * Source language of the application (default: 'en')
   */
  sourceLanguage: string;
  /**
   * Target languages to translate to
   */
  targetLanguages: string[];
  /**
   * Path to the locale files directory
   */
  localesDir: string;
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
   * Translation service configuration
   */
  translation?: {
    service: 'google' | 'deepl' | 'manual';
    apiKey?: string;
  };
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
}
