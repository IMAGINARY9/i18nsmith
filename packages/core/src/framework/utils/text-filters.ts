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
const URL_PATTERN = /^(https?:\/\/|mailto:|tel:)/i;
const BOOLEAN_LITERAL_PATTERN = /^(true|false|null|undefined)$/i;
const CODE_FRAGMENT_PATTERN = /(&&|\|\||===|!==|=>|\breturn\b|\bconst\b|\blet\b|\bvar\b|\bif\b|\belse\b)/;
const CSS_CLASS_PATTERN = /^(?:[\w:./\-\[\]]+\s+)+[\w:./\-\[\]]+$/i;
const CSS_CLASS_SIGNAL = /[-:\[\]/\d]/;

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

  // Skip obvious URLs and scheme-like values
  if (URL_PATTERN.test(text.trim())) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  // Skip boolean-ish literals
  if (BOOLEAN_LITERAL_PATTERN.test(text.trim())) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  // Skip code fragments / expressions
  if (CODE_FRAGMENT_PATTERN.test(text)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  // Skip Tailwind/CSS-like class strings
  if (CSS_CLASS_PATTERN.test(text.trim()) && CSS_CLASS_SIGNAL.test(text)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
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
  LETTER_REGEX_GLOBAL.lastIndex = 0;
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
 * Decode HTML entities in a string.
 * Handles both named entities (&amp;, &lt;, etc.) and numeric entities (&#10;, &#xA;, etc.)
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return text;
  
  // Handle numeric character references (decimal and hexadecimal)
  let decoded = text
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  // Handle common named entities
  const entityMap: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&hellip;': '…',
    '&mdash;': '—',
    '&ndash;': '–',
    '&lsquo;': "'",
    '&rsquo;': "'",
    '&ldquo;': '"',
    '&rdquo;': '"',
  };
  
  for (const [entity, char] of Object.entries(entityMap)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }
  
  return decoded;
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