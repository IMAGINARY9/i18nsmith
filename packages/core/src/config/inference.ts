import fs from 'fs/promises';
import path from 'path';
import type { I18nConfig } from './types.js';
import { DEFAULT_SOURCE_LANGUAGE } from './defaults.js';

const LOCALE_DIR_CANDIDATES = [
  'locales',
  'src/locales',
  'app/locales',
  'apps/web/locales',
  'public/locales',
  'packages/web/locales',
  'packages/app/locales',
  'i18n/locales',
  'translations',
];

const LOCALE_FILE_EXTENSIONS = new Set(['.json', '.jsonc', '.yaml', '.yml']);
const LOCALE_NAME_REGEX = /^[a-z]{2,}(?:[-_][a-z0-9]+)*$/i;

async function pathExists(candidate: string): Promise<boolean> {
  try {
    const stats = await fs.stat(candidate);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function detectLocalesDir(projectRoot: string): Promise<string | undefined> {
  for (const candidate of LOCALE_DIR_CANDIDATES) {
    const absolute = path.resolve(projectRoot, candidate);
    if (await pathExists(absolute)) {
      return candidate;
    }
  }
  return undefined;
}

function parseLocaleName(filename: string): string | undefined {
  const base = path.parse(filename).name;
  if (LOCALE_NAME_REGEX.test(base)) {
    return base.replace(/_/g, '-');
  }
  return undefined;
}

async function collectLocales(localesDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(localesDir, { withFileTypes: true });
    const locales = new Set<string>();

    for (const entry of entries) {
      if (entry.isDirectory() && LOCALE_NAME_REGEX.test(entry.name)) {
        locales.add(entry.name.replace(/_/g, '-'));
      } else if (entry.isFile() && LOCALE_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const parsed = parseLocaleName(entry.name);
        if (parsed) {
          locales.add(parsed);
        }
      }
    }

    return Array.from(locales).sort();
  } catch {
    return [];
  }
}

export interface ConfigInferenceContext {
  projectRoot: string;
}

export async function inferConfig(
  rawConfig: Partial<I18nConfig>,
  context: ConfigInferenceContext
): Promise<Partial<I18nConfig>> {
  const inferred: Partial<I18nConfig> = { ...rawConfig };

  if (!inferred.localesDir || inferred.localesDir.trim().length === 0) {
    const detectedDir = await detectLocalesDir(context.projectRoot);
    if (detectedDir) {
      inferred.localesDir = detectedDir;
    }
  }

  const candidateLocalesDir = inferred.localesDir
    ? path.resolve(context.projectRoot, inferred.localesDir)
    : undefined;

  if (!candidateLocalesDir) {
    return inferred;
  }

  const discoveredLocales = await collectLocales(candidateLocalesDir);
  if (!discoveredLocales.length) {
    return inferred;
  }

  if (!inferred.sourceLanguage || inferred.sourceLanguage.trim().length === 0) {
    inferred.sourceLanguage = discoveredLocales.includes('en')
      ? 'en'
      : discoveredLocales[0] ?? DEFAULT_SOURCE_LANGUAGE;
  }

  const currentTargets = Array.isArray(inferred.targetLanguages) ? inferred.targetLanguages : [];
  if (!currentTargets.length) {
    const sourceLanguage = inferred.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
    const targets = discoveredLocales.filter((locale) => locale !== sourceLanguage);
    if (targets.length) {
      inferred.targetLanguages = targets;
    }
  }

  return inferred;
}
