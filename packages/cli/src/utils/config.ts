import fs from 'fs/promises';
import path from 'path';
import { I18nConfig } from '@i18nsmith/core';

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

  return {
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
  };
}
