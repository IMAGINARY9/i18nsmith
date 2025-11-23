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
   * Translation service configuration
   */
  translation?: {
    service: 'google' | 'deepl' | 'manual';
    apiKey?: string;
  };
}
