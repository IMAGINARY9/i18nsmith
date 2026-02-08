import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import { I18nConfig } from './config.js';
import { DEFAULT_ADAPTER_MODULE } from './config/defaults.js';
import { ActionableItem } from './actionable.js';

const DEFAULT_INCLUDE = ['src/**/*.{ts,tsx,js,jsx,vue}'];
const DEFAULT_RUNTIME_DEPENDENCIES = [
  'react-i18next',
  'i18next',
  'next-i18next',
  'next-intl',
  '@lingui/core',
  '@lingui/react',
  'vue-i18n',
  '@nuxtjs/i18n',
  'svelte-i18n',
];

const DEFAULT_PROVIDER_GLOBS = [
  'app/**/providers.{ts,tsx,js,jsx}',
  'src/app/**/providers.{ts,tsx,js,jsx}',
  'src/providers/**/*.{ts,tsx,js,jsx}',
  '**/i18n-provider.{ts,tsx,js,jsx}',
];

const DEFAULT_ADAPTER_HINTS: AdapterDetection[] = [
  { path: 'src/components/i18n-provider.tsx', type: 'react-i18next' },
  { path: 'src/lib/i18n.ts', type: 'react-i18next' },
  { path: 'src/contexts/translation-context.tsx', type: 'custom' },
];

const DEFAULT_MAX_SOURCE_FILES = 200;

export interface RuntimePackageInfo {
  name: string;
  version?: string;
  source: 'dependencies' | 'devDependencies';
}

export interface AdapterDetection {
  path: string;
  type: 'react-i18next' | 'custom';
}

export interface LocaleFileInsight {
  locale: string;
  path: string;
  keyCount: number;
  bytes: number;
  missing?: boolean;
  parseError?: string;
}

export interface ProviderInsight {
  path: string;
  relativePath: string;
  hasI18nProvider: boolean;
  usesTranslationHook: boolean;
  frameworkHint: 'next' | 'react' | 'unknown';
}

export interface TranslationUsageInsight {
  hookName: string;
  translationIdentifier: string;
  filesExamined: number;
  hookOccurrences: number;
  identifierOccurrences: number;
  hookExampleFiles: string[];
  identifierExampleFiles: string[];
}

export interface DiagnoseConflict {
  kind: string;
  message: string;
  files?: string[];
  details?: Record<string, unknown>;
}

export interface DiagnosisReport {
  localesDir: string;
  localeFiles: LocaleFileInsight[];
  detectedLocales: string[];
  runtimePackages: RuntimePackageInfo[];
  providerFiles: ProviderInsight[];
  adapterFiles: AdapterDetection[];
  translationUsage: TranslationUsageInsight;
  actionableItems: ActionableItem[];
  conflicts: DiagnoseConflict[];
  recommendations: string[];
}

export interface DiagnoseOptions {
  workspaceRoot?: string;
}

export async function diagnoseWorkspace(config: I18nConfig, options: DiagnoseOptions = {}): Promise<DiagnosisReport> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const localesDir = path.resolve(workspaceRoot, config.localesDir ?? 'locales');

  const localeFiles = await detectLocaleFiles(localesDir, config);
  const detectedLocales = localeFiles.filter((entry) => !entry.missing && !entry.parseError).map((entry) => entry.locale);
  const runtimePackages = await detectRuntimePackages(workspaceRoot, config);
  const providerFiles = await detectProviderFiles(workspaceRoot, config);
  const adapterFiles = await detectAdapterFiles(workspaceRoot, config);
  const translationUsage = await detectTranslationUsage(workspaceRoot, config);
  const matchedSourceFiles = await countMatchedSourceFiles(workspaceRoot, config);

  const { actionableItems, conflicts, recommendations } = buildActionableInsights({
    localeFiles,
    config,
    runtimePackages,
    providerFiles,
    translationUsage,
    adapterFiles,
    matchedSourceFiles,
  });

  return {
    localesDir,
    localeFiles,
    detectedLocales: Array.from(new Set(detectedLocales)).sort(),
    runtimePackages,
    providerFiles,
    adapterFiles,
    translationUsage,
    actionableItems,
    conflicts,
    recommendations,
  };
}

interface InsightBuilderInput {
  localeFiles: LocaleFileInsight[];
  config: I18nConfig;
  runtimePackages: RuntimePackageInfo[];
  providerFiles: ProviderInsight[];
  translationUsage: TranslationUsageInsight;
  adapterFiles: AdapterDetection[];
  matchedSourceFiles: number;
}

function buildActionableInsights(input: InsightBuilderInput) {
  const actionableItems: ActionableItem[] = [];
  const conflicts: DiagnoseConflict[] = [];
  const recommendations: string[] = [];

  const sourceLocale = input.localeFiles.find((entry) => entry.locale === input.config.sourceLanguage && !entry.missing);
  if (!sourceLocale) {
    const message = `Source locale "${input.config.sourceLanguage}" is missing in ${input.config.localesDir}.`;
    conflicts.push({ kind: 'missing-source-locale', message, files: [path.join(input.config.localesDir, `${input.config.sourceLanguage}.json`)] });
    actionableItems.push({ kind: 'diagnostics-missing-source-locale', severity: 'error', message });
  }

  const missingTargets = input.config.targetLanguages.filter(
    (locale) => !input.localeFiles.some((entry) => entry.locale === locale && !entry.missing)
  );
  if (missingTargets.length) {
    actionableItems.push({
      kind: 'diagnostics-missing-target-locales',
      severity: 'warn',
      message: `Missing locale files for target languages: ${missingTargets.join(', ')}.`,
      details: { missingLocales: missingTargets },
    });
    recommendations.push(`Run "i18nsmith sync" to seed missing locales (${missingTargets.join(', ')}).`);
  }

  // Check if user has configured a custom translation adapter
  // Note: config normalizer defaults translationAdapter.module to 'react-i18next'
  // So we check if user actually configured a non-default value
  const adapterModule = input.config.translationAdapter?.module;
  const isDefaultAdapter = !adapterModule || adapterModule === DEFAULT_ADAPTER_MODULE;
  const hasCustomAdapter = !isDefaultAdapter;
  const hasExistingAdapter = input.adapterFiles.length > 0;
  const hasWorkingSetup = hasCustomAdapter || hasExistingAdapter;

  // Only warn about missing runtime if there's no custom adapter configured
  if (!input.runtimePackages.length && !hasWorkingSetup) {
    actionableItems.push({
      kind: 'diagnostics-runtime-missing',
      severity: 'warn',
      message: 'No common i18n runtime packages detected in package.json.',
    });
    recommendations.push('Install a runtime like "react-i18next" or configure translationAdapter.module.');
  }

  // Only warn about missing provider if there's no custom adapter/working setup
  const providerWithI18n = input.providerFiles.find((provider) => provider.hasI18nProvider);
  if (!providerWithI18n && !hasWorkingSetup) {
    actionableItems.push({
      kind: 'diagnostics-provider-missing',
      severity: 'info',
      message: 'No providers wrapping <I18nProvider> detected. You may need to run "i18nsmith scaffold-adapter".',
    });
  }

  if (input.translationUsage.identifierOccurrences === 0 && input.translationUsage.hookOccurrences === 0) {
    actionableItems.push({
      kind: 'diagnostics-no-translation-usage',
      severity: 'info',
      message: 'No translation hooks or `t()` calls found in scanned source files.',
    });
  }

  for (const locale of input.localeFiles) {
    if (locale.parseError) {
      const message = `Locale file ${locale.path} contains invalid JSON (${locale.parseError}).`;
      conflicts.push({ kind: 'invalid-locale-json', message, files: [locale.path] });
      actionableItems.push({
        kind: 'diagnostics-invalid-locale-json',
        severity: 'error',
        message,
        filePath: locale.path,
      });
    }
  }

  if (input.adapterFiles.length) {
    actionableItems.push({
      kind: 'diagnostics-adapter-detected',
      severity: 'info',
      message: `Existing adapter/runtime files detected (${input.adapterFiles.map((adapter) => adapter.path).join(', ')}).`,
    });
    recommendations.push('Use "i18nsmith init --merge" to reuse existing adapters and locales.');
  }

  // Frameworks that expose translation functions as globals (e.g. $t in Vue
  // templates, $t in Nuxt, $_ in Svelte) don't require an explicit hook import.
  const GLOBAL_T_ADAPTER_MODULES = ['vue-i18n', '@nuxtjs/i18n', 'svelte-i18n'];
  const usesGlobalTranslation = GLOBAL_T_ADAPTER_MODULES.includes(adapterModule ?? '');

  if (
    input.translationUsage.identifierOccurrences > 0 &&
    input.translationUsage.hookOccurrences === 0 &&
    !usesGlobalTranslation
  ) {
    actionableItems.push({
      kind: 'diagnostics-translation-identifier-only',
      severity: 'info',
      message: `Detected ${input.translationUsage.identifierOccurrences} calls to ${input.translationUsage.translationIdentifier} but no hook usage.`,
    });
  }

  if (input.matchedSourceFiles === 0) {
    const includePatterns = input.config.include?.join(', ') ?? 'src/**/*.{ts,tsx,js,jsx}';
    actionableItems.push({
      kind: 'diagnostics-zero-source-files',
      severity: 'error',
      message: `Include patterns matched 0 source files. Current patterns: ${includePatterns}`,
      details: { include: input.config.include },
    });
    recommendations.push(
      'Try broader patterns like "src/**/*.{ts,tsx,js,jsx}, app/**/*.{ts,tsx,js,jsx}" or use --include to override.'
    );
  }

  return { actionableItems, conflicts, recommendations };
}

async function detectLocaleFiles(localesDir: string, config: I18nConfig): Promise<LocaleFileInsight[]> {
  const entries: LocaleFileInsight[] = [];

  const files = await fg('**/*.json', {
    cwd: localesDir,
    onlyFiles: true,
    unique: true,
    suppressErrors: true,
    absolute: true,
  }).catch(() => [] as string[]);

  for (const absolutePath of files) {
    const locale = path.basename(absolutePath, path.extname(absolutePath));
    try {
      const [raw, stats] = await Promise.all([fs.readFile(absolutePath, 'utf8'), fs.stat(absolutePath)]);
      const parsed = JSON.parse(raw);
      entries.push({
        locale,
        path: absolutePath,
        keyCount: countLocaleKeys(parsed),
        bytes: stats.size,
      });
    } catch (error) {
      entries.push({
        locale,
        path: absolutePath,
        keyCount: 0,
        bytes: 0,
        parseError: (error as Error).message,
      });
    }
  }

  const expectedLocales = [config.sourceLanguage, ...(config.targetLanguages ?? [])];
  for (const locale of expectedLocales) {
    // Check for exact match or case-insensitive match to avoid false positives on case-insensitive FS
    const exists = entries.some((entry) => entry.locale === locale || entry.locale.toLowerCase() === locale.toLowerCase());

    if (!exists) {
      entries.push({
        locale,
        path: path.join(localesDir, `${locale}.json`),
        keyCount: 0,
        bytes: 0,
        missing: true,
      });
    }
  }

  return entries.sort((a, b) => a.locale.localeCompare(b.locale));
}

async function detectRuntimePackages(workspaceRoot: string, config: I18nConfig): Promise<RuntimePackageInfo[]> {
  const pkgPath = path.join(workspaceRoot, 'package.json');
  const candidates = Array.from(
    new Set([...DEFAULT_RUNTIME_DEPENDENCIES, ...(config.diagnostics?.runtimePackages ?? [])])
  );
  try {
    const raw = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = pkg.dependencies ?? {};
    const devDeps = pkg.devDependencies ?? {};
    const detections: RuntimePackageInfo[] = [];

    for (const dep of candidates) {
      if (deps[dep]) {
        detections.push({ name: dep, version: deps[dep], source: 'dependencies' });
      } else if (devDeps[dep]) {
        detections.push({ name: dep, version: devDeps[dep], source: 'devDependencies' });
      }
    }

    return detections;
  } catch {
    return [];
  }
}

async function detectProviderFiles(workspaceRoot: string, config: I18nConfig): Promise<ProviderInsight[]> {
  const globs = Array.from(
    new Set([...DEFAULT_PROVIDER_GLOBS, ...(config.diagnostics?.providerGlobs ?? [])])
  );
  const matches = await fg(globs, {
    cwd: workspaceRoot,
    absolute: true,
    suppressErrors: true,
    unique: true,
    ignore: ['**/node_modules/**'],
  }).catch(() => [] as string[]);

  const providers: ProviderInsight[] = [];
  for (const absolutePath of matches.slice(0, 50)) {
    try {
      const contents = await fs.readFile(absolutePath, 'utf8');
      const relativePath = path.relative(workspaceRoot, absolutePath);
      providers.push({
        path: absolutePath,
        relativePath,
        hasI18nProvider: /<I18nProvider/i.test(contents) || contents.includes('I18nProvider'),
        usesTranslationHook: contents.includes('useTranslation'),
        frameworkHint: relativePath.includes('app/') ? 'next' : 'unknown',
      });
    } catch {
      // ignore read errors
    }
  }

  return providers;
}

async function detectAdapterFiles(workspaceRoot: string, config: I18nConfig): Promise<AdapterDetection[]> {
  const detections: AdapterDetection[] = [];
  const hints = [...DEFAULT_ADAPTER_HINTS, ...(config.diagnostics?.adapterHints ?? [])];
  await Promise.all(
    hints.map(async (hint) => {
      const absolute = path.resolve(workspaceRoot, hint.path);
      try {
        await fs.access(absolute);
        detections.push({ ...hint });
      } catch {
        // ignore
      }
    })
  );
  return detections;
}

async function detectTranslationUsage(workspaceRoot: string, config: I18nConfig): Promise<TranslationUsageInsight> {
  const includeGlobs = Array.from(
    new Set([...config.include, ...(config.diagnostics?.include ?? [])])
  );
  const includePatterns = (includeGlobs.length ? includeGlobs : DEFAULT_INCLUDE).map((pattern) =>
    path.resolve(workspaceRoot, pattern)
  );
  const excludePatterns = Array.from(new Set([...(config.exclude ?? []), ...(config.diagnostics?.exclude ?? [])]));
  const files = await fg(includePatterns, {
    ignore: excludePatterns,
    absolute: true,
    suppressErrors: true,
    onlyFiles: true,
  }).catch(() => [] as string[]);

  const maxFiles = config.diagnostics?.maxSourceFiles ?? DEFAULT_MAX_SOURCE_FILES;
  const sampled = files.slice(0, maxFiles);
  const hookName = config.translationAdapter?.hookName ?? 'useTranslation';
  const identifier = config.sync?.translationIdentifier ?? 't';
  const hookPattern = `\\b${escapeRegex(hookName)}\\b`;
  const identifierPattern = `\\b${escapeRegex(identifier)}\\s*\\(`;

  let hookOccurrences = 0;
  let identifierOccurrences = 0;
  const hookExampleFiles: string[] = [];
  const identifierExampleFiles: string[] = [];

  for (const filePath of sampled) {
    try {
      const contents = await fs.readFile(filePath, 'utf8');
      const hookMatches = contents.match(new RegExp(hookPattern, 'g'));
      const identifierMatches = contents.match(new RegExp(identifierPattern, 'g'));
      hookOccurrences += hookMatches?.length ?? 0;
      identifierOccurrences += identifierMatches?.length ?? 0;
      if (hookExampleFiles.length < 5 && hookMatches?.length) {
        hookExampleFiles.push(path.relative(workspaceRoot, filePath));
      }
      if (identifierExampleFiles.length < 5 && identifierMatches?.length) {
        identifierExampleFiles.push(path.relative(workspaceRoot, filePath));
      }
    } catch {
      // ignore
    }
  }

  return {
    hookName,
    translationIdentifier: identifier,
    filesExamined: sampled.length,
    hookOccurrences,
    identifierOccurrences,
    hookExampleFiles,
    identifierExampleFiles,
  };
}

function countLocaleKeys(value: unknown): number {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return 1;
  }
  if (Array.isArray(value)) {
    return value.reduce((acc, item) => acc + countLocaleKeys(item), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce((acc, item) => acc + countLocaleKeys(item), 0);
  }
  return 0;
}

async function countMatchedSourceFiles(workspaceRoot: string, config: I18nConfig): Promise<number> {
  const includePatterns = config.include?.length
    ? config.include
    : DEFAULT_INCLUDE;
  const ignorePatterns = config.exclude?.length
    ? config.exclude
    : ['node_modules/**', '.next/**', 'dist/**'];

  const files = await fg(includePatterns, {
    cwd: workspaceRoot,
    ignore: ignorePatterns,
    onlyFiles: true,
    unique: true,
    suppressErrors: true,
  }).catch(() => [] as string[]);

  return files.length;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
