import fs from 'fs/promises';
import path from 'path';


const DEFAULT_INCLUDE = [
  'src/**/*.{ts,tsx,js,jsx}',
  'app/**/*.{ts,tsx,js,jsx}',
  'pages/**/*.{ts,tsx,js,jsx}',
  'components/**/*.{ts,tsx,js,jsx}',
];
const DEFAULT_EXCLUDE = ['node_modules/**', '.next/**', 'dist/**'];
const DEFAULT_PLACEHOLDER_FORMATS: PlaceholderFormat[] = ['doubleCurly', 'percentCurly', 'percentSymbol'];
const DEFAULT_EMPTY_VALUE_MARKERS = ['todo', 'tbd', 'fixme', 'pending', '???'];

export type LocaleFormat = 'flat' | 'nested' | 'auto';
export type SuspiciousKeyPolicy = 'allow' | 'skip' | 'error';

const isLocaleFormat = (value: string): value is LocaleFormat =>
  value === 'flat' || value === 'nested' || value === 'auto';

const normalizeLocaleFormat = (value: unknown): LocaleFormat => {
  if (typeof value !== 'string') {
    return 'auto';
  }
  const normalized = value.trim().toLowerCase();
  return isLocaleFormat(normalized) ? (normalized as LocaleFormat) : 'auto';
};

const normalizeLocaleDelimiter = (value: unknown): string => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length) {
      return trimmed;
    }
  }
  return '.';
};

const isSuspiciousKeyPolicy = (value: unknown): value is SuspiciousKeyPolicy =>
  value === 'allow' || value === 'skip' || value === 'error';

type RawLocalesConfig = {
  format?: unknown;
  delimiter?: unknown;
};

const isPlaceholderFormat = (value: string): value is PlaceholderFormat =>
  (DEFAULT_PLACEHOLDER_FORMATS as string[]).includes(value);

const normalizePlaceholderFormats = (value: unknown): PlaceholderFormat[] => {
  const raw = ensureStringArray(value);
  const filtered = raw.filter(isPlaceholderFormat);
  return filtered.length ? filtered : DEFAULT_PLACEHOLDER_FORMATS;
};

const ensureArray = (value: unknown, fallback: string[]): string[] => {
  if (Array.isArray(value) && value.length) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }

  return fallback;
};

const ensureOptionalArray = (value: unknown): string[] | undefined => {
  const normalized = ensureStringArray(value);
  return normalized.length ? normalized : undefined;
};

const ensureUniqueStrings = (value: unknown): string[] | undefined => {
  const normalized = ensureOptionalArray(value);
  return normalized ? Array.from(new Set(normalized)) : undefined;
};

const normalizePositiveInteger = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
};

function normalizeTranslationConfig(input: unknown): TranslationConfig | undefined {
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

async function findUp(filename: string, cwd: string): Promise<string | null> {
  let currentDir = cwd;
  let parentDir = path.dirname(currentDir);
  const maxDepth = 10; // Prevent infinite loops
  let depth = 0;

  do {
    const filePath = path.join(currentDir, filename);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // continue
    }

    parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
    depth++;
  } while (currentDir !== parentDir && depth < maxDepth);

  return null;
}

export interface LoadConfigResult {
  config: I18nConfig;
  configPath: string;
  projectRoot: string;
}

/**
 * Load config file with upward directory traversal.
 * @param configPath - Path to config file (relative or absolute)
 * @param options - Load options
 * @returns Config object and metadata about where it was found
 */
export async function loadConfigWithMeta(
  configPath = 'i18n.config.json',
  options?: { cwd?: string }
): Promise<LoadConfigResult> {
  const cwd = options?.cwd ?? process.cwd();
  let resolvedPath: string;

  if (path.isAbsolute(configPath)) {
    resolvedPath = configPath;
  } else {
    // Try to resolve relative to CWD first
    const cwdPath = path.resolve(cwd, configPath);
    try {
      await fs.access(cwdPath);
      resolvedPath = cwdPath;
    } catch {
      // If not found in CWD, and it looks like a default/simple filename, try finding up the tree
      if (!configPath.includes(path.sep) || configPath === 'i18n.config.json') {
        const found = await findUp(configPath, cwd);
        resolvedPath = found ?? cwdPath;
      } else {
        resolvedPath = cwdPath;
      }
    }
  }

  const config = await loadConfigFromPath(resolvedPath);
  const projectRoot = path.dirname(resolvedPath);

  return {
    config,
    configPath: resolvedPath,
    projectRoot,
  };
}

function normalizeConfig(parsed: Partial<I18nConfig>): I18nConfig {
  const translationConfig = normalizeTranslationConfig(parsed.translation);

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
  const localesConfig =
    typeof parsed.locales === 'object' && parsed.locales !== null
      ? (parsed.locales as RawLocalesConfig)
      : undefined;
  const translationIdentifier =
    typeof syncConfig.translationIdentifier === 'string' && syncConfig.translationIdentifier.trim().length > 0
      ? syncConfig.translationIdentifier.trim()
      : 't';
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
    : 'common';
  const shortHashLen = typeof keyGen.shortHashLen === 'number' && keyGen.shortHashLen > 0
    ? keyGen.shortHashLen
    : 6;
  const localeFormat = normalizeLocaleFormat(localesConfig?.format);
  const localeDelimiter = normalizeLocaleDelimiter(localesConfig?.delimiter);

  const diagnosticsConfig = normalizeDiagnosticsConfig(parsed.diagnostics);

  const normalized: I18nConfig = {
    version: (parsed.version ?? 1) as 1,
    sourceLanguage: parsed.sourceLanguage ?? 'en',
    targetLanguages: ensureStringArray(parsed.targetLanguages) ?? [],
    localesDir: parsed.localesDir ?? 'locales',
    include: ensureArray(parsed.include, DEFAULT_INCLUDE),
    exclude: ensureArray(parsed.exclude, DEFAULT_EXCLUDE),
    minTextLength: typeof parsed.minTextLength === 'number' && parsed.minTextLength >= 0 ? parsed.minTextLength : 1,
    translation: translationConfig,
    translationAdapter: {
      module: adapterModule,
      hookName: adapterHook,
    },
    locales: {
      format: localeFormat,
      delimiter: localeDelimiter,
    },
    keyGeneration: {
      namespace: keyNamespace,
      shortHashLen,
    },
    seedTargetLocales: typeof parsed.seedTargetLocales === 'boolean' ? parsed.seedTargetLocales : false,
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
  };

  return normalized;
}

async function loadConfigFromPath(resolvedPath: string): Promise<I18nConfig> {
  let fileContents: string;

  try {
    fileContents = await fs.readFile(resolvedPath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found at ${resolvedPath}. Run "i18nsmith init" to create one.`);
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

  return normalizeConfig(parsed);
}

export async function loadConfig(configPath = 'i18n.config.json'): Promise<I18nConfig> {
  const result = await loadConfigWithMeta(configPath);
  return result.config;
}

function normalizeDiagnosticsConfig(input: unknown): DiagnosticsConfig | undefined {
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

function normalizeAdapterHint(entry: unknown): DiagnosticsAdapterHintConfig | undefined {
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

export interface TranslationConfig {
  provider: string;
  secretEnvVar?: string;
  apiKey?: string;
  module?: string;
  concurrency?: number;
  batchSize?: number;
  locales?: string[];
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

  sync?: SyncConfig;

  diagnostics?: DiagnosticsConfig;
}

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
}

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

export interface LocalesConfig {
  format?: LocaleFormat;
  delimiter?: string;
}

export type PlaceholderFormat = 'doubleCurly' | 'percentCurly' | 'percentSymbol';

export type EmptyValuePolicy = 'ignore' | 'warn' | 'fail';

export { DEFAULT_PLACEHOLDER_FORMATS, DEFAULT_EMPTY_VALUE_MARKERS };
