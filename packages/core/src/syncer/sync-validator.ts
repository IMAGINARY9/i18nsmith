import type { TranslationReference } from '../reference-extractor.js';
import { extractPlaceholders, type PlaceholderPatternInstance } from '../placeholders.js';

/**
 * Represents a placeholder mismatch between source and target locale
 */
export interface PlaceholderIssue {
  key: string;
  locale: string;
  missing: string[];
  extra: string[];
  references: TranslationReference[];
  sourceValue: string;
  targetValue: string;
}

/**
 * Reason why a value is considered empty
 */
export type EmptyValueViolationReason = 'null' | 'empty' | 'whitespace' | 'placeholder';

/**
 * Represents an empty or missing value in a locale file
 */
export interface EmptyValueViolation {
  key: string;
  locale: string;
  value: string | null;
  reason: EmptyValueViolationReason;
  /** Optional static fallback literal captured from code (e.g. `t('k') || 'Label'`). */
  fallbackLiteral?: string;
}

/**
 * Collects placeholder interpolation issues between source and target locales.
 * Detects missing or extra placeholders in translations.
 */
export function collectPlaceholderIssues(
  localeData: Map<string, Record<string, string>>,
  referencesByKey: Map<string, TranslationReference[]>,
  sourceLocale: string,
  targetLocales: string[],
  placeholderPatterns: PlaceholderPatternInstance[]
): PlaceholderIssue[] {
  const issues: PlaceholderIssue[] = [];
  const sourceData = localeData.get(sourceLocale) ?? {};

  for (const [key, sourceValue] of Object.entries(sourceData)) {
    const sourcePlaceholders = extractPlaceholdersFromValue(sourceValue, placeholderPatterns);
    const sourceSet = sourcePlaceholders;

    for (const locale of targetLocales) {
      const targetValue = localeData.get(locale)?.[key];
      if (typeof targetValue === 'undefined') {
        continue;
      }

      const targetSet = extractPlaceholdersFromValue(targetValue, placeholderPatterns);
      const missing = Array.from(sourceSet).filter((token) => !targetSet.has(token));
      const extra = Array.from(targetSet).filter((token) => !sourceSet.has(token));

      if (!missing.length && !extra.length) {
        continue;
      }

      issues.push({
        key,
        locale,
        missing,
        extra,
        references: referencesByKey.get(key) ?? [],
        sourceValue,
        targetValue,
      });
    }
  }

  return issues;
}

/**
 * Collects empty value violations across target locales.
 * Detects null, empty, whitespace-only, or placeholder-only values.
 */
export function collectEmptyValueViolations(
  localeData: Map<string, Record<string, string>>,
  referencesByKey: Map<string, TranslationReference[]>,
  targetLocales: string[],
  emptyValueMarkers: Set<string>
): EmptyValueViolation[] {
  const violations: EmptyValueViolation[] = [];

  for (const locale of targetLocales) {
    const data = localeData.get(locale);
    if (!data) {
      continue;
    }

    for (const [key, value] of Object.entries(data)) {
      const reason = getEmptyValueReason(value, emptyValueMarkers);
      if (!reason) {
        continue;
      }

      const refs = referencesByKey.get(key) ?? [];
      const fallbackLiteral = refs.find((ref) => typeof ref.fallbackLiteral === 'string')?.fallbackLiteral;

      violations.push({
        key,
        locale,
        value: typeof value === 'string' ? value : null,
        reason,
        fallbackLiteral: typeof fallbackLiteral === 'string' && fallbackLiteral.trim().length ? fallbackLiteral : undefined,
      });
    }
  }

  return violations;
}

/**
 * Determines if a value is empty and why
 */
function getEmptyValueReason(value: unknown, emptyValueMarkers: Set<string>): EmptyValueViolationReason | null {
  if (value === null || typeof value === 'undefined') {
    return 'null';
  }

  if (typeof value !== 'string') {
    return null;
  }

  if (value.length === 0) {
    return 'empty';
  }

  const trimmed = value.trim();
  if (!trimmed.length) {
    return 'whitespace';
  }

  if (emptyValueMarkers.has(trimmed.toLowerCase())) {
    return 'placeholder';
  }

  return null;
}

/**
 * Extracts placeholders from a translation value
 */
function extractPlaceholdersFromValue(value: unknown, placeholderPatterns: PlaceholderPatternInstance[]): Set<string> {
  if (typeof value !== 'string') {
    return new Set();
  }
  return new Set(extractPlaceholders(value, placeholderPatterns));
}
