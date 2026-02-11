import type { I18nConfig } from './config.js';

export interface DynamicKeyCoverage {
  pattern: string;
  expandedKeys: string[];
  missingByLocale: Record<string, string[]>;
}

export function expandDynamicKeys(config: I18nConfig): Set<string> {
  const mapping = config.dynamicKeys?.expand ?? {};
  const expanded = new Set<string>();

  for (const [pattern, values] of Object.entries(mapping)) {
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    const wildcardCount = (pattern.match(/\*/g) ?? []).length;
    if (wildcardCount === 0) {
      expanded.add(pattern);
      continue;
    }

    if (wildcardCount === 1) {
      for (const value of values) {
        expanded.add(pattern.replace('*', value));
      }
      continue;
    }

    for (const value of values) {
      let next = pattern;
      for (let i = 0; i < wildcardCount; i++) {
        next = next.replace('*', value);
      }
      expanded.add(next);
    }
  }

  return expanded;
}

export function buildDynamicKeyCoverage(
  config: I18nConfig,
  localeData: Map<string, Record<string, string>>,
  sourceLocale: string,
  targetLocales: string[]
): DynamicKeyCoverage[] {
  const mapping = config.dynamicKeys?.expand ?? {};
  const coverage: DynamicKeyCoverage[] = [];
  const locales = [sourceLocale, ...targetLocales];

  for (const [pattern, values] of Object.entries(mapping)) {
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }

    const expandedKeys = Array.from(expandDynamicKeys({ ...config, dynamicKeys: { expand: { [pattern]: values } } }));
    const missingByLocale: Record<string, string[]> = {};

    for (const locale of locales) {
      const localeKeys = localeData.get(locale) ?? {};
      const missing = expandedKeys.filter((key) => !(key in localeKeys));
      if (missing.length) {
        missingByLocale[locale] = missing;
      }
    }

    coverage.push({
      pattern,
      expandedKeys,
      missingByLocale,
    });
  }

  return coverage;
}
