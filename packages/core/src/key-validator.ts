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

export type KeyNamingConvention = 'kebab-case' | 'camelCase' | 'snake_case' | 'auto';

export interface KeyNormalizationOptions {
  /** Default namespace for orphan keys */
  defaultNamespace?: string;
  /** Naming convention for the key part */
  namingConvention?: KeyNamingConvention;
  /** Maximum number of words to include */
  maxWords?: number;
  /** Whether to preserve existing naming conventions */
  preserveExistingConvention?: boolean;
}

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
      if (keyEqualsValue) {
        if (!baseAnalysis.suspicious || baseAnalysis.reason === 'single-word-no-namespace') {
          return {
            suspicious: true,
            reason: 'key-equals-value',
            keyEqualsValue: true,
          };
        }
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
      case 'pascal-case-sentence':
      case 'sentence-article':
      case 'key-equals-value':
        return normalizeToKey(key);
      case 'single-word-no-namespace':
        return `common.${key.toLowerCase()}`;
      case 'trailing-punctuation':
        return key.replace(/[:?!]+$/, '');
      default:
        return undefined;
    }
  }

  /**
   * Generate a normalized key from suspicious input.
   * This is the public API for the auto-rename feature.
   */
  public generateNormalizedKey(
    key: string,
    options: KeyNormalizationOptions = {}
  ): string {
    return normalizeToKey(key, options);
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
    // Only flag raw keys without namespaces to avoid false positives
    // for structured keys like "common.generic.yes".
    if (key.includes('.')) {
      return false;
    }

    // Direct equality check (key literally used as value)
    if (key === value) {
      return true;
    }

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

/**
 * Detect the dominant naming convention from a corpus of existing keys.
 * Analyzes the key parts (after namespace) to determine the most common pattern.
 */
export function detectNamingConvention(keys: string[]): KeyNamingConvention {
  if (keys.length === 0) {
    return 'kebab-case'; // Default fallback
  }

  const conventionCounts = {
    'kebab-case': 0,
    'camelCase': 0,
    'snake_case': 0,
  };

  for (const key of keys) {
    // Extract the key part (after last dot)
    const keyPart = key.includes('.') ? key.split('.').pop()! : key;

    // Skip if empty or doesn't contain word boundaries
    if (!keyPart || !/[a-zA-Z]/.test(keyPart)) {
      continue;
    }

    // Check for each convention
    if (keyPart.includes('-')) {
      conventionCounts['kebab-case']++;
    } else if (keyPart.includes('_')) {
      conventionCounts['snake_case']++;
    } else if (/[a-z][A-Z]/.test(keyPart)) {
      conventionCounts['camelCase']++;
    } else {
      // Single word or no separators - could be any convention
      // Count as the most common existing convention, or default to kebab-case
      const maxCount = Math.max(...Object.values(conventionCounts));
      if (maxCount > 0) {
        const dominant = Object.entries(conventionCounts)
          .find(([, count]) => count === maxCount)?.[0] as keyof typeof conventionCounts;
        if (dominant) {
          conventionCounts[dominant]++;
        }
      } else {
        conventionCounts['kebab-case']++;
      }
    }
  }

  // Return the convention with the highest count
  const [dominant] = Object.entries(conventionCounts)
    .sort(([, a], [, b]) => b - a)[0];

  return dominant as KeyNamingConvention;
}

/**
 * Check if a key part follows a specific naming convention.
 */
export function followsConvention(keyPart: string, convention: KeyNamingConvention): boolean {
  switch (convention) {
    case 'kebab-case':
      return /^[a-z]+(-[a-z]+)*$/.test(keyPart);
    case 'snake_case':
      return /^[a-z]+(_[a-z]+)*$/.test(keyPart);
    case 'camelCase':
      return /^[a-z]+([A-Z][a-z]*)*$/.test(keyPart);
    default:
      return true; // For 'auto' or unknown, consider it valid
  }
}

/**
 * Normalize a raw text or suspicious key into a proper i18n key.
 * Extracted for standalone use (e.g., auto-rename feature).
 */
export function normalizeToKey(
  input: string,
  options: KeyNormalizationOptions = {}
): string {
  const {
    defaultNamespace = 'common',
    namingConvention = 'kebab-case',
    maxWords = 4,
    preserveExistingConvention = false,
  } = options;

  // Step 1: Check if input already has a namespace
  let namespace = defaultNamespace;
  let keyText = input;

  if (input.includes('.')) {
    const lastDotIndex = input.lastIndexOf('.');
    const potentialNamespace = input.substring(0, lastDotIndex);
    const potentialKey = input.substring(lastDotIndex + 1);

    // Validate namespace is clean (no spaces or punctuation)
    if (/^[a-zA-Z0-9._-]+$/.test(potentialNamespace) && potentialKey.length > 0) {
      namespace = potentialNamespace;
      keyText = potentialKey;
    }
  }

  // Step 2: Check if we should preserve existing convention
  if (preserveExistingConvention && keyText) {
    // Check if the key already follows a valid convention
    const conventions: KeyNamingConvention[] = ['kebab-case', 'camelCase', 'snake_case'];
    for (const convention of conventions) {
      if (followsConvention(keyText, convention)) {
        // Key already follows a convention, return as-is
        return `${namespace}.${keyText}`;
      }
    }
  }

  // Step 3: Extract raw words from the key part
  // Handle PascalCase, camelCase, spaces, punctuation
  const words = extractWords(keyText);

  if (words.length === 0) {
    return `${namespace}.unknown`;
  }

  // Step 4: Limit words to maxWords
  const limitedWords = words.slice(0, maxWords);

  // Step 5: Apply naming convention
  let keyPart: string;
  const effectiveConvention = namingConvention === 'auto' ? 'kebab-case' : namingConvention;
  switch (effectiveConvention) {
    case 'camelCase':
      keyPart = limitedWords
        .map((w, i) => (i === 0 ? w.toLowerCase() : capitalize(w)))
        .join('');
      break;
    case 'snake_case':
      keyPart = limitedWords.map((w) => w.toLowerCase()).join('_');
      break;
    case 'kebab-case':
    default:
      keyPart = limitedWords.map((w) => w.toLowerCase()).join('-');
      break;
  }

  return `${namespace}.${keyPart}`;
}

/**
 * Extract words from a string handling various formats:
 * - Spaces: "Hello World" -> ["hello", "world"]
 * - PascalCase: "HelloWorld" -> ["hello", "world"]
 * - camelCase: "helloWorld" -> ["hello", "world"]
 * - Mixed: "Hello World!" -> ["hello", "world"]
 */
function extractWords(input: string): string[] {
  // Remove punctuation and normalize
  const cleaned = input
    .replace(/[:?!,.;'"]+/g, ' ')
    .trim();

  // Split on spaces first
  const spaceSplit = cleaned.split(/\s+/).filter(Boolean);

  // For each space-separated token, split on case boundaries
  const words: string[] = [];
  for (const token of spaceSplit) {
    // Split PascalCase/camelCase
    const caseSplit = token
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean);

    words.push(...caseSplit);
  }

  return words
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0);
}

function capitalize(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
