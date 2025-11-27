/**
 * LocaleValidator - Quality checks for locale files
 *
 * Provides detection of common locale file quality issues:
 * - Duplicate values across multiple keys (consolidation opportunities)
 * - Inconsistent key naming patterns
 * - Orphaned namespaces with very few keys
 */

export interface DuplicateValueWarning {
  value: string;
  keys: string[];
  locale: string;
}

export interface InconsistentKeyWarning {
  pattern: string;
  variants: string[];
  suggestion: string;
}

export interface OrphanedNamespaceWarning {
  namespace: string;
  keyCount: number;
  keys: string[];
}

export interface LocaleQualityReport {
  duplicateValues: DuplicateValueWarning[];
  inconsistentKeys: InconsistentKeyWarning[];
  orphanedNamespaces: OrphanedNamespaceWarning[];
}

export interface LocaleValidatorOptions {
  /** Delimiter used for key namespaces (default: '.') */
  delimiter?: string;
  /** Minimum value length to consider for duplicate detection (default: 3) */
  minDuplicateValueLength?: number;
  /** Maximum keys for a namespace to be considered "orphaned" (default: 2) */
  orphanedNamespaceThreshold?: number;
}

const DEFAULT_OPTIONS: Required<LocaleValidatorOptions> = {
  delimiter: '.',
  minDuplicateValueLength: 3,
  orphanedNamespaceThreshold: 2,
};

export class LocaleValidator {
  private readonly delimiter: string;
  private readonly minDuplicateValueLength: number;
  private readonly orphanedNamespaceThreshold: number;

  constructor(options: LocaleValidatorOptions = {}) {
    this.delimiter = options.delimiter ?? DEFAULT_OPTIONS.delimiter;
    this.minDuplicateValueLength = options.minDuplicateValueLength ?? DEFAULT_OPTIONS.minDuplicateValueLength;
    this.orphanedNamespaceThreshold = options.orphanedNamespaceThreshold ?? DEFAULT_OPTIONS.orphanedNamespaceThreshold;
  }

  /**
   * Detect keys that share the same value within a single locale.
   * These are consolidation opportunities - multiple keys pointing to the same text.
   */
  public detectDuplicateValues(locale: string, data: Record<string, string>): DuplicateValueWarning[] {
    const valueToKeys = new Map<string, string[]>();

    for (const [key, value] of Object.entries(data)) {
      // Skip short values (like "OK", "No", etc.) - these are often intentionally duplicated
      if (!value || value.length < this.minDuplicateValueLength) {
        continue;
      }

      // Normalize whitespace for comparison
      const normalizedValue = value.trim().toLowerCase();

      if (!valueToKeys.has(normalizedValue)) {
        valueToKeys.set(normalizedValue, []);
      }
      valueToKeys.get(normalizedValue)!.push(key);
    }

    const warnings: DuplicateValueWarning[] = [];

    for (const [, keys] of valueToKeys) {
      if (keys.length > 1) {
        // Get the original (non-normalized) value from the first key
        const originalValue = data[keys[0]];
        warnings.push({
          value: originalValue,
          keys: keys.sort(),
          locale,
        });
      }
    }

    return warnings.sort((a, b) => b.keys.length - a.keys.length);
  }

  /**
   * Detect inconsistent key naming patterns across locales.
   * E.g., "auth.login" vs "authentication.login" or "btn.save" vs "button.save"
   */
  public detectInconsistentKeys(allKeys: string[]): InconsistentKeyWarning[] {
    const warnings: InconsistentKeyWarning[] = [];

    // Common abbreviation patterns to check
    const abbreviationPatterns: Array<{ abbrev: string; full: string; pattern: RegExp }> = [
      { abbrev: 'btn', full: 'button', pattern: /^btn\./i },
      { abbrev: 'msg', full: 'message', pattern: /^msg\./i },
      { abbrev: 'err', full: 'error', pattern: /^err\./i },
      { abbrev: 'auth', full: 'authentication', pattern: /^auth\./i },
      { abbrev: 'nav', full: 'navigation', pattern: /^nav\./i },
      { abbrev: 'cfg', full: 'config', pattern: /^cfg\./i },
      { abbrev: 'usr', full: 'user', pattern: /^usr\./i },
      { abbrev: 'lbl', full: 'label', pattern: /^lbl\./i },
    ];

    for (const { abbrev, full, pattern } of abbreviationPatterns) {
      const fullPattern = new RegExp(`^${full}\\.`, 'i');
      const abbrevKeys = allKeys.filter(k => pattern.test(k));
      const fullKeys = allKeys.filter(k => fullPattern.test(k));

      if (abbrevKeys.length > 0 && fullKeys.length > 0) {
        warnings.push({
          pattern: `${abbrev}.* vs ${full}.*`,
          variants: [...abbrevKeys.slice(0, 3), ...fullKeys.slice(0, 3)],
          suggestion: `Standardize on "${abbrevKeys.length > fullKeys.length ? abbrev : full}" prefix`,
        });
      }
    }

    // Detect mixed casing patterns in namespaces
    const namespaces = this.extractNamespaces(allKeys);
    const caseVariants = this.detectCaseVariants(namespaces);

    for (const [normalized, variants] of caseVariants) {
      if (variants.length > 1) {
        warnings.push({
          pattern: `Case mismatch: ${variants.join(' vs ')}`,
          variants: allKeys.filter(k => variants.some(v => k.startsWith(v + this.delimiter))).slice(0, 5),
          suggestion: `Standardize casing for "${normalized}" namespace`,
        });
      }
    }

    return warnings;
  }

  /**
   * Detect namespaces with very few keys (consolidation candidates).
   */
  public detectOrphanedNamespaces(allKeys: string[]): OrphanedNamespaceWarning[] {
    const namespaceToKeys = new Map<string, string[]>();

    for (const key of allKeys) {
      const namespace = this.extractRootNamespace(key);
      if (!namespace) {
        continue; // Skip keys without namespace
      }

      if (!namespaceToKeys.has(namespace)) {
        namespaceToKeys.set(namespace, []);
      }
      namespaceToKeys.get(namespace)!.push(key);
    }

    const warnings: OrphanedNamespaceWarning[] = [];

    for (const [namespace, keys] of namespaceToKeys) {
      if (keys.length <= this.orphanedNamespaceThreshold) {
        warnings.push({
          namespace,
          keyCount: keys.length,
          keys: keys.sort(),
        });
      }
    }

    return warnings.sort((a, b) => a.keyCount - b.keyCount);
  }

  /**
   * Run all quality checks and return a comprehensive report.
   */
  public validateLocale(
    locale: string,
    data: Record<string, string>,
    allLocalesKeys?: string[]
  ): LocaleQualityReport {
    const keys = Object.keys(data);
    const keysToCheck = allLocalesKeys ?? keys;

    return {
      duplicateValues: this.detectDuplicateValues(locale, data),
      inconsistentKeys: this.detectInconsistentKeys(keysToCheck),
      orphanedNamespaces: this.detectOrphanedNamespaces(keysToCheck),
    };
  }

  /**
   * Validate consistency across multiple locales.
   * Detects keys that exist in some locales but not others.
   */
  public validateKeyConsistency(
    localesData: Map<string, Record<string, string>>
  ): Map<string, { missing: string[]; extra: string[] }> {
    // Get all unique keys across all locales
    const allKeys = new Set<string>();
    for (const data of localesData.values()) {
      for (const key of Object.keys(data)) {
        allKeys.add(key);
      }
    }

    const result = new Map<string, { missing: string[]; extra: string[] }>();

    for (const [locale, data] of localesData) {
      const localeKeys = new Set(Object.keys(data));
      const missing: string[] = [];
      const extra: string[] = [];

      for (const key of allKeys) {
        if (!localeKeys.has(key)) {
          missing.push(key);
        }
      }

      // Check for keys that only exist in this locale (might be orphaned)
      // This is informational - might be intentional locale-specific content
      // For now we don't flag this as "extra" to avoid false positives

      result.set(locale, { missing: missing.sort(), extra: extra.sort() });
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private extractRootNamespace(key: string): string | undefined {
    const parts = key.split(this.delimiter);
    return parts.length > 1 ? parts[0] : undefined;
  }

  private extractNamespaces(keys: string[]): Set<string> {
    const namespaces = new Set<string>();
    for (const key of keys) {
      const namespace = this.extractRootNamespace(key);
      if (namespace) {
        namespaces.add(namespace);
      }
    }
    return namespaces;
  }

  private detectCaseVariants(namespaces: Set<string>): Map<string, string[]> {
    const normalizedToVariants = new Map<string, string[]>();

    for (const ns of namespaces) {
      const normalized = ns.toLowerCase();
      if (!normalizedToVariants.has(normalized)) {
        normalizedToVariants.set(normalized, []);
      }
      const variants = normalizedToVariants.get(normalized)!;
      if (!variants.includes(ns)) {
        variants.push(ns);
      }
    }

    // Only keep entries with multiple variants
    for (const [key, variants] of normalizedToVariants) {
      if (variants.length <= 1) {
        normalizedToVariants.delete(key);
      }
    }

    return normalizedToVariants;
  }
}
