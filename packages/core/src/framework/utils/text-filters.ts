/**
 * Shared Text Filtering Utilities for Framework Adapters
 *
 * Contains common heuristics and utilities used by all framework adapters
 * for determining which text content should be extracted for translation.
 */

const LETTER_REGEX_GLOBAL = /\p{L}/gu;
const HTML_ENTITY_PATTERN = /^&[a-z][a-z0-9-]*;$/i;
const REPEATED_SYMBOL_PATTERN = /^([^\p{L}\d\s])\1{1,}$/u;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Result of text filtering analysis
 */
export interface TextFilterResult {
  /** Whether the text should be extracted */
  shouldExtract: boolean;
  /** Reason why text was skipped, if applicable */
  skipReason?: string;
}

/**
 * Configuration for text filtering
 */
export interface TextFilterConfig {
  /** Patterns that must match for text to be extracted (if empty, all text allowed) */
  allowPatterns: RegExp[];
  /** Patterns that prevent text from being extracted */
  denyPatterns: RegExp[];
  /** Whether to skip hex color values */
  skipHexColors?: boolean;
}

/**
 * Determine if text content should be extracted for translation.
 *
 * This function encapsulates the common heuristics used across all framework adapters
 * for deciding whether a piece of text is worth translating.
 */
export function shouldExtractText(text: string, config: TextFilterConfig): TextFilterResult {
  if (!text || text.length === 0) {
    return { shouldExtract: false, skipReason: 'empty' };
  }

  // Skip if matches deny patterns
  if (config.denyPatterns.some(pattern => pattern.test(text))) {
    return { shouldExtract: false, skipReason: 'deny-pattern' };
  }

  // Allow if matches allow patterns (if any are specified)
  if (config.allowPatterns.length > 0 && !config.allowPatterns.some(pattern => pattern.test(text))) {
    return { shouldExtract: false, skipReason: 'allow-pattern-mismatch' };
  }

  // Skip single characters
  if (text.length === 1) {
    return { shouldExtract: false, skipReason: 'single-character' };
  }

  // Skip HTML entities
  if (HTML_ENTITY_PATTERN.test(text)) {
    return { shouldExtract: false, skipReason: 'html-entity' };
  }

  // Skip repeated symbols
  if (REPEATED_SYMBOL_PATTERN.test(text)) {
    return { shouldExtract: false, skipReason: 'repeated-symbols' };
  }

  // Skip hex colors (optional, some frameworks may want to translate color names)
  if (config.skipHexColors && HEX_COLOR_PATTERN.test(text)) {
    return { shouldExtract: false, skipReason: 'hex-color' };
  }

  // Must contain at least one letter
  if (!LETTER_REGEX_GLOBAL.test(text)) {
    return { shouldExtract: false, skipReason: 'no-letters' };
  }

  return { shouldExtract: true };
}

/**
 * Generate a translation key from text content.
 *
 * This is a simple key generation algorithm that can be shared across adapters.
 * More sophisticated implementations could use machine learning or custom rules.
 */
export function generateKey(text: string, style: 'snake' | 'camel' | 'kebab' = 'snake', maxLength: number = 50): string {
  if (!text) return '';

  let key: string;

  switch (style) {
    case 'snake':
      key = text.toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      break;

    case 'camel':
      key = text.toLowerCase()
        .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase())
        .replace(/^./, char => char.toLowerCase());
      break;

    case 'kebab':
      key = text.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      break;

    default:
      key = text.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  }

  return key.substring(0, maxLength);
}

/**
 * Generate a hash for text content.
 *
 * Used for detecting duplicate strings and change detection.
 * Returns a base36-encoded hash.
 */
export function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Compile string patterns into RegExp objects.
 *
 * Handles both string literals and RegExp objects in configuration.
 */
export function compilePatterns(patterns?: (string | RegExp)[]): RegExp[] {
  if (!patterns || patterns.length === 0) return [];

  return patterns.map(pattern => {
    if (pattern instanceof RegExp) {
      return pattern;
    }
    // For string patterns, create case-insensitive regex
    return new RegExp(pattern, 'i');
  });
}

/**
 * Check if a string is a hex color value.
 */
export function isHexColor(text: string): boolean {
  return HEX_COLOR_PATTERN.test(text);
}

/**
 * Check if a string is an HTML entity.
 */
export function isHtmlEntity(text: string): boolean {
  return HTML_ENTITY_PATTERN.test(text);
}

/**
 * Check if a string consists of repeated symbols.
 */
export function isRepeatedSymbol(text: string): boolean {
  return REPEATED_SYMBOL_PATTERN.test(text);
}

/**
 * Escape special regex characters in a string for use in RegExp constructor.
 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}