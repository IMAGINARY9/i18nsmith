/**
 * Key Validator Module
 *
 * Provides validation and analysis of translation keys to detect
 * suspicious patterns that indicate raw UI text rather than proper keys.
 */

import { SuspiciousKeyPolicy } from './config.js';

export type SuspiciousKeyReason =
  | 'contains-spaces'
  | 'single-word-no-namespace'
  | 'trailing-punctuation'
  | 'pascal-case-sentence'
  | 'sentence-article'
  | 'key-equals-value';

export interface KeyAnalysisResult {
  suspicious: boolean;
  reason?: SuspiciousKeyReason;
}

export interface KeyValidationResult {
  valid: boolean;
  suspicious: boolean;
  reason?: SuspiciousKeyReason;
  suggestion?: string;
}

export interface KeyValueAnalysisResult extends KeyAnalysisResult {
  keyEqualsValue?: boolean;
}

/**
 * Human-readable descriptions for each suspicious key reason.
 */
export const SUSPICIOUS_KEY_REASON_DESCRIPTIONS: Record<SuspiciousKeyReason, string> = {
  'contains-spaces': 'Key contains spaces (raw UI text)',
  'single-word-no-namespace': 'Single word without namespace (likely raw label)',
  'trailing-punctuation': 'Key ends with punctuation (:?!)',
  'pascal-case-sentence': 'PascalCase sentence pattern (4+ words)',
  'sentence-article': 'Contains sentence articles/prepositions (The, To, A, etc.)',
  'key-equals-value': 'Key is identical to its value',
};

/**
 * Regex patterns for detecting sentence-like articles and prepositions.
 * Uses lookahead/lookbehind to handle PascalCase boundaries.
 */
const SENTENCE_INDICATORS_PATTERN = /(?:^|(?<=[a-z]))(The|To|Of|For|In|On|At|By|With|From|As|Is|Are|Was|Were|Be|Been|Being|Have|Has|Had|Do|Does|Did|Will|Would|Could|Should|May|Might|Must|Shall|Can)(?=[A-Z]|$)/;

/**
 * KeyValidator analyzes translation keys and detects suspicious patterns
 * that indicate raw UI text instead of properly structured keys.
 */
export class KeyValidator {
  constructor(private readonly policy: SuspiciousKeyPolicy = 'skip') {}

  /**
   * Analyze a key and determine if it's suspicious.
   */
  public analyze(key: string): KeyAnalysisResult {
    // Keys containing spaces are clearly raw UI text
    if (key.includes(' ')) {
      return { suspicious: true, reason: 'contains-spaces' };
    }

    // Single-word keys without a namespace (e.g., `Found`, `tags`) are likely raw labels
    if (!key.includes('.') && /^[A-Za-z]+$/.test(key)) {
      return { suspicious: true, reason: 'single-word-no-namespace' };
    }

    // Keys with sentence-like punctuation (colons, question marks, exclamation) at the end
    if (/[:?!]$/.test(key)) {
      return { suspicious: true, reason: 'trailing-punctuation' };
    }

    // Extract the last segment for namespace-based analysis
    const withoutNamespace = key.includes('.') ? key.split('.').pop()! : key;

    // Keys that look like Title Case sentences (3+ consecutive capitalized words)
    if (/([A-Z][a-z]+){3,}/.test(withoutNamespace) && !/[-_]/.test(withoutNamespace)) {
      const words = withoutNamespace.split(/(?=[A-Z])/);
      if (words.length >= 4 && words.every(w => w.length > 1)) {
        return { suspicious: true, reason: 'pascal-case-sentence' };
      }
    }

    // Keys containing articles/prepositions suggesting sentence structure
    if (SENTENCE_INDICATORS_PATTERN.test(withoutNamespace)) {
      return { suspicious: true, reason: 'sentence-article' };
    }

    return { suspicious: false };
  }

  /**
   * Analyze a key-value pair and detect if they're identical (anti-pattern).
   */
  public analyzeWithValue(key: string, value?: string): KeyValueAnalysisResult {
    const baseAnalysis = this.analyze(key);

    if (value !== undefined) {
      const keyEqualsValue = this.isKeyEqualsValue(key, value);
      if (keyEqualsValue && !baseAnalysis.suspicious) {
        return {
          suspicious: true,
          reason: 'key-equals-value',
          keyEqualsValue: true,
        };
      }
      return { ...baseAnalysis, keyEqualsValue };
    }

    return baseAnalysis;
  }

  /**
   * Validate a key and return full validation result with suggestions.
   */
  public validate(key: string, value?: string): KeyValidationResult {
    const analysis = value !== undefined
      ? this.analyzeWithValue(key, value)
      : this.analyze(key);

    if (!analysis.suspicious) {
      return { valid: true, suspicious: false };
    }

    return {
      valid: this.policy === 'allow',
      suspicious: true,
      reason: analysis.reason,
      suggestion: this.suggestFix(key, analysis.reason),
    };
  }

  /**
   * Check if the key should be skipped based on policy.
   */
  public shouldSkip(key: string): boolean {
    if (this.policy === 'allow') {
      return false;
    }
    return this.analyze(key).suspicious;
  }

  /**
   * Check if the key should cause an error based on policy.
   */
  public shouldError(key: string): boolean {
    if (this.policy !== 'error') {
      return false;
    }
    return this.analyze(key).suspicious;
  }

  /**
   * Suggest a fix for a suspicious key.
   */
  public suggestFix(key: string, reason?: SuspiciousKeyReason): string | undefined {
    if (!reason) {
      const analysis = this.analyze(key);
      reason = analysis.reason;
    }

    if (!reason) {
      return undefined;
    }

    switch (reason) {
      case 'contains-spaces':
        return this.suggestKeyFromText(key);
      case 'single-word-no-namespace':
        return `common.${key.toLowerCase()}`;
      case 'trailing-punctuation':
        return key.replace(/[:?!]+$/, '');
      case 'pascal-case-sentence':
      case 'sentence-article':
        return this.suggestKeyFromText(key);
      case 'key-equals-value':
        return this.suggestKeyFromText(key);
      default:
        return undefined;
    }
  }

  /**
   * Check if a key format is valid (basic structural validation).
   */
  public isValidKeyFormat(key: string): boolean {
    if (!key || typeof key !== 'string') {
      return false;
    }

    // Key should not be empty after trimming
    if (key.trim().length === 0) {
      return false;
    }

    // Key should only contain valid characters
    // Valid: alphanumeric, dots, underscores, hyphens
    return /^[a-zA-Z0-9._-]+$/.test(key);
  }

  /**
   * Check if key is identical or nearly identical to its value.
   */
  private isKeyEqualsValue(key: string, value: string): boolean {
    // Use only the last segment of the key for comparison
    const keySegment = key.includes('.') ? key.split('.').pop()! : key;
    const normalizedKey = this.normalizeForComparison(keySegment);
    const normalizedValue = this.normalizeForComparison(value);
    return normalizedKey === normalizedValue;
  }

  /**
   * Normalize a string for comparison (lowercase, remove punctuation, normalize spaces).
   */
  private normalizeForComparison(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate a suggested key from raw text.
   */
  private suggestKeyFromText(text: string): string {
    const slug = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .split('-')
      .slice(0, 4)
      .join('-');

    return `common.${slug}`;
  }
}

/**
 * Create a default KeyValidator instance.
 */
export function createKeyValidator(policy: SuspiciousKeyPolicy = 'skip'): KeyValidator {
  return new KeyValidator(policy);
}
