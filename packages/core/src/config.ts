import fs from 'fs/promises';
import path from 'path';


const DEFAULT_INCLUDE = ['src/**/*.{ts,tsx,js,jsx}'];
const DEFAULT_EXCLUDE = ['node_modules/**'];

const ensureArray = (value: unknown, fallback: string[]): string[] => {
  if (Array.isArray(value) && value.length) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  return fallback;
};

const ensureStringArray = (value: unknown): string[] => {
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
};

export async function loadConfig(configPath = 'i18n.config.json'): Promise<I18nConfig> {
  const resolvedPath = path.resolve(process.cwd(), configPath);
  let fileContents: string;

  try {
    fileContents = await fs.readFile(resolvedPath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found at ${resolvedPath}. Run \"i18nsmith init\" to create one.`);
    }
    throw new Error(`Unable to read config file at ${resolvedPath}: ${err.message}`);
  }

  let parsed: Partial<I18nConfig>;
  try {
    parsed = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(
      `Config file at ${resolvedPath} contains invalid JSON: ${(error as Error).message}`
    );
  }

  const adapter =
    typeof parsed.translationAdapter === 'object' && parsed.translationAdapter
      ? parsed.translationAdapter
      : undefined;

  const adapterModule =
    typeof adapter?.module === 'string' && adapter.module.trim().length > 0
      ? adapter.module.trim()
      : 'react-i18next';
  const adapterHook =
    typeof adapter?.hookName === 'string' && adapter.hookName.trim().length > 0
      ? adapter.hookName.trim()
      : 'useTranslation';

  const keyGen = parsed.keyGeneration || {};
  const syncConfig = parsed.sync || {};
  const translationIdentifier =
    typeof syncConfig.translationIdentifier === 'string' && syncConfig.translationIdentifier.trim().length > 0
      ? syncConfig.translationIdentifier.trim()
      : 't';

  const keyNamespace = typeof keyGen.namespace === 'string' && keyGen.namespace.trim().length > 0
    ? keyGen.namespace.trim()
    : 'common';
  const shortHashLen = typeof keyGen.shortHashLen === 'number' && keyGen.shortHashLen > 0
    ? keyGen.shortHashLen
    : 6;

  const normalized: I18nConfig = {
    // Default to schema version 1 if not explicitly set. Future versions can
    // branch on this value for migrations while staying backwards compatible.
    version: (parsed.version ?? 1) as 1,
    sourceLanguage: parsed.sourceLanguage ?? 'en',
    targetLanguages: ensureStringArray(parsed.targetLanguages) ?? [],
    localesDir: parsed.localesDir ?? 'locales',
    include: ensureArray(parsed.include, DEFAULT_INCLUDE),
    exclude: ensureArray(parsed.exclude, DEFAULT_EXCLUDE),
    minTextLength: typeof parsed.minTextLength === 'number' && parsed.minTextLength >= 0 ? parsed.minTextLength : 1,
    translation: parsed.translation,
    translationAdapter: {
      module: adapterModule,
      hookName: adapterHook,
    },
    keyGeneration: {
      namespace: keyNamespace,
      shortHashLen,
    },
    seedTargetLocales: typeof parsed.seedTargetLocales === 'boolean' ? parsed.seedTargetLocales : false,
    sync: {
      translationIdentifier,
    },
  };

  return normalized;
}

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
   * Configuration schema version.
   * Used to support future, backwards-compatible evolutions of the config file.
   * Defaults to 1 when omitted.
   */
  version?: 1;
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

  sync?: SyncConfig;
}

export interface SyncConfig {
  translationIdentifier?: string;
}
