/**
 * Utility functions for locale data manipulation during sync operations
 */

import { generateValueFromKey } from '../value-generator.js';

/**
 * Creates a deep clone of locale data map
 */
export function cloneLocaleData(
  localeData: Map<string, Record<string, string>>
): Map<string, Record<string, string>> {
  const projected = new Map<string, Record<string, string>>();
  for (const [locale, data] of localeData.entries()) {
    projected.set(locale, { ...data });
  }
  return projected;
}

/**
 * Ensures a locale exists in the projected data map
 */
export function ensureProjectedLocale(
  projected: Map<string, Record<string, string>>,
  locale: string
): Record<string, string> {
  if (!projected.has(locale)) {
    projected.set(locale, {});
  }
  return projected.get(locale)!;
}

/**
 * Applies a value to the projected locale data
 */
export function applyProjectedValue(
  projected: Map<string, Record<string, string>>,
  locale: string,
  key: string,
  value: string
): void {
  const data = ensureProjectedLocale(projected, locale);
  data[key] = value;
}

/**
 * Removes a key from the projected locale data
 */
export function applyProjectedRemoval(
  projected: Map<string, Record<string, string>>,
  locale: string,
  key: string
): void {
  const data = ensureProjectedLocale(projected, locale);
  delete data[key];
}

/**
 * Builds a set of keys from locale data for quick lookups
 */
export function buildLocaleKeySets(
  localeData: Map<string, Record<string, string>>
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [locale, data] of localeData.entries()) {
    map.set(locale, new Set(Object.keys(data)));
  }
  return map;
}

/**
 * Filters items by a selection set
 */
export function filterSelection<T extends { key: string }>(
  items: T[],
  selection?: Set<string>
): T[] {
  if (!selection) {
    return items;
  }
  return items.filter((item) => selection.has(item.key));
}

/**
 * Builds a Set from an optional array of keys
 */
export function buildSelectionSet(keys?: string[]): Set<string> | undefined {
  if (!keys?.length) {
    return undefined;
  }
  return new Set(keys.map((k) => k.trim()).filter(Boolean));
}

/**
 * Builds a default source value for a key (usually humanized key name)
 */
export function buildDefaultSourceValue(key: string): string {
  return generateValueFromKey(key) || key;
}