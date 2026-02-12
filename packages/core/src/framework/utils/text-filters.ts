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
const CSS_CLASS_PATTERN = /^(?:[\w:./\-\[\]()'#%,]+\s+)+[\w:./\-\[\]()'#%,]+$/i;
const CSS_CLASS_SIGNAL = /[-:\[\]/\d]/;
const SVG_PATH_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz\d\s.,\-]+$/;
const ICON_IDENTIFIER_PATTERN = /^[a-z][\w-]*:[a-z][\w-]*$/i;
const CSS_CUSTOM_PROP_PATTERN = /^--[\w-]+$/;
const CSS_UNIT_PATTERN = /^\d+(\.\d+)?(px|em|rem|vh|vw|%|s|ms|fr)$/i;
const CSS_SHORTHAND_PATTERN = /^[\d.]+(px|em|rem|%)(\s+[\d.]+(px|em|rem|%))*$/i;
const RELATIVE_PATH_PATTERN = /^\/[\w\-./]+(\?[\w=&]*)?$/;
const CONSTANT_PATTERN = /^(?=.*_)[A-Z0-9_]+$/;
const DEBUG_MESSAGE_PATTERN = /^(?:[\u2700-\u27BF]|\p{Emoji_Presentation})/u;
const EVENT_NAME_PATTERN = /^on[A-Z]\w+$/;
const INPUT_TYPE_PATTERN = /^(text|email|password|number|tel|url|date|time|hidden|submit|button|checkbox|radio|file|range|color|search)$/i;
const CAMEL_CASE_PATTERN = /^[a-z]+[A-Z][a-zA-Z]*$/;
const DOT_PATH_PATTERN = /^[\w-]+(\.[\w-]+){2,}$/;
const FONT_FAMILY_PATTERN = /^[\w\s,\-]+,\s*(sans-serif|serif|monospace|cursive|fantasy|system-ui)$/i;
const HTTP_METHOD_PATTERN = /^(GET|POST|PUT|DELETE|PATCH|_blank|_self|_parent|_top|noopener|noreferrer)$/i;
const CSS_KEYWORD_PATTERN = /^(auto|inherit|initial|unset|none|block|flex|grid|inline|bold|normal|center|left|right|baseline)$/i;

// New deny patterns for false-positive filtering
const HTML_TYPE_KEYWORDS = new Set([
  'text', 'submit', 'checkbox', 'hidden', 'number', 'radio',
  'range', 'button', 'password', 'email', 'tel', 'date', 'time',
  'file', 'search', 'url', 'color', 'reset', 'image',
]);

const CSS_VALUE_KEYWORDS = new Set([
  'bold', 'normal', 'italic', 'center', 'left', 'right', 'justify',
  'top', 'bottom', 'baseline', 'middle', 'flex', 'grid', 'block',
  'inline', 'none', 'hidden', 'visible', 'absolute', 'relative',
  'fixed', 'sticky', 'transparent', 'inherit', 'initial', 'unset',
  'auto', 'wrap', 'nowrap', 'uppercase', 'lowercase', 'capitalize',
  'underline', 'overline', 'pointer', 'default', 'cover', 'contain',
  'scroll', 'smooth', 'start', 'end', 'stretch',
]);

const LOCALE_CODE_PATTERN = /^[a-z]{2,3}$/; // ISO 639-1/2/3 language codes
const REL_ATTRIBUTE_PATTERN = /^(noopener|noreferrer|nofollow|noopener\s+noreferrer)$/i;
const DOM_EVENT_PATTERN = /^on\w+$/i;
const SVG_ATTRIBUTE_PATTERN = /^(evenodd|nonzero)$/i;
const ALL_CAPS_CONSTANT_PATTERN = /^[A-Z][A-Z0-9]{2,}$/; // Pure ALL-CAPS words ≥3 chars
const CSS_TRANSITION_PATTERN = /^\w+\s+[\d.]+s?\s*(ease|linear|ease-in|ease-out)?$/i;
const TAILWIND_SIGNAL_PATTERNS = [
  /\b(flex|grid|block|inline|hidden|absolute|relative|fixed|sticky)\b/i,
  /\b(bg|text|border|rounded|shadow|ring|outline|p|m|w|h|gap|space)-/i,
  /\b(hover|focus|active|disabled|dark|sm|md|lg|xl|2xl):/i,
  /\bvar\(--/i,
];

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
  /** Optional context for smarter filtering */
  context?: {
    attribute?: string;
  };
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

  const trimmedText = text.trim();
  const attributeContext = config.context?.attribute?.toLowerCase();

  // Skip if matches deny patterns
  if (config.denyPatterns.some(pattern => pattern.test(trimmedText))) {
    return { shouldExtract: false, skipReason: 'deny-pattern' };
  }

  // Allow if matches allow patterns (if any are specified)
  if (config.allowPatterns.length > 0 && !config.allowPatterns.some(pattern => pattern.test(trimmedText))) {
    return { shouldExtract: false, skipReason: 'allow-pattern-mismatch' };
  }

  // Skip single characters
  if (text.length === 1) {
    return { shouldExtract: false, skipReason: 'single-character' };
  }

  // Skip HTML entities
  if (HTML_ENTITY_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'html-entity' };
  }

  // Skip obvious URLs and scheme-like values
  if (URL_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (RELATIVE_PATH_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  // Skip boolean-ish literals
  if (BOOLEAN_LITERAL_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  // Skip code fragments / expressions
  if (CODE_FRAGMENT_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  // Skip Tailwind/CSS-like class strings
  if (isLikelyCssClassList(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (CSS_CUSTOM_PROP_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (SVG_PATH_PATTERN.test(trimmedText) && trimmedText.length > 8) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (CSS_UNIT_PATTERN.test(trimmedText) || CSS_SHORTHAND_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (ICON_IDENTIFIER_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (CONSTANT_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (DEBUG_MESSAGE_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (EVENT_NAME_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (CAMEL_CASE_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (DOT_PATH_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (FONT_FAMILY_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  if (HTTP_METHOD_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'non_sentence' };
  }

  // Skip repeated symbols
  if (REPEATED_SYMBOL_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'repeated-symbols' };
  }

  // Skip hex colors (optional, some frameworks may want to translate color names)
  if (config.skipHexColors && HEX_COLOR_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'hex-color' };
  }

  // Skip HTML input type keywords (context-free check)
  if (HTML_TYPE_KEYWORDS.has(trimmedText.toLowerCase())) {
    return { shouldExtract: false, skipReason: 'html-type-keyword' };
  }

  // Skip CSS single-word value keywords
  if (CSS_VALUE_KEYWORDS.has(trimmedText.toLowerCase())) {
    return { shouldExtract: false, skipReason: 'css-value-keyword' };
  }

  // Skip locale codes (2-3 letter language codes)
  if (LOCALE_CODE_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'locale-code' };
  }

  // Skip rel attribute values
  if (REL_ATTRIBUTE_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'rel-attribute' };
  }

  // Skip DOM event handler names
  if (DOM_EVENT_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'dom-event' };
  }

  // Skip SVG fill-rule values
  if (SVG_ATTRIBUTE_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'svg-attribute' };
  }

  // Skip ALL-CAPS constant-like words (≥3 chars, no spaces)
  if (ALL_CAPS_CONSTANT_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'all-caps-constant' };
  }

  // Skip CSS transition shorthand strings
  if (CSS_TRANSITION_PATTERN.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'css-transition' };
  }

  // Skip single-token Tailwind utility classes (context-free)
  if (isLikelySingleTokenTailwindClass(trimmedText)) {
    return { shouldExtract: false, skipReason: 'single-token-tailwind' };
  }

  // Must contain at least one letter
  LETTER_REGEX_GLOBAL.lastIndex = 0;
  if (!LETTER_REGEX_GLOBAL.test(trimmedText)) {
    return { shouldExtract: false, skipReason: 'no-letters' };
  }

  if (attributeContext) {
    if (attributeContext === 'class' || attributeContext === 'classname') {
      return { shouldExtract: false, skipReason: 'non_sentence' };
    }

    if (attributeContext === 'style' || attributeContext === 'd' || attributeContext === 'viewbox') {
      return { shouldExtract: false, skipReason: 'non_sentence' };
    }

    if (CSS_KEYWORD_PATTERN.test(trimmedText)) {
      return { shouldExtract: false, skipReason: 'non_sentence' };
    }

    if ((attributeContext === 'type' || attributeContext === 'inputmode') && INPUT_TYPE_PATTERN.test(trimmedText)) {
      return { shouldExtract: false, skipReason: 'non_sentence' };
    }

    if ((attributeContext === 'icon' || attributeContext === 'iconname' || attributeContext === 'icon-name')
      && ICON_IDENTIFIER_PATTERN.test(trimmedText)) {
      return { shouldExtract: false, skipReason: 'non_sentence' };
    }

    if ((attributeContext === 'href' || attributeContext === 'to' || attributeContext === 'action' || attributeContext === 'src')
      && RELATIVE_PATH_PATTERN.test(trimmedText)) {
      return { shouldExtract: false, skipReason: 'non_sentence' };
    }

    if (attributeContext === 'd' && SVG_PATH_PATTERN.test(trimmedText) && trimmedText.length > 8) {
      return { shouldExtract: false, skipReason: 'non_sentence' };
    }
  }

  return { shouldExtract: true };
}

function isLikelyCssClassList(text: string): boolean {
  const tokenCount = text.split(/\s+/).filter(Boolean).length;
  const tailwindSignalCount = TAILWIND_SIGNAL_PATTERNS.filter(pattern => pattern.test(text)).length;

  // Check for Tailwind arbitrary value syntax [value]
  const hasArbitraryValue = /\[[\d.]+\]/.test(text);

  if (CSS_CLASS_PATTERN.test(text) && CSS_CLASS_SIGNAL.test(text)) {
    if (tokenCount >= 3) {
      return true;
    }
    // Lower threshold: if ≥50% of tokens match Tailwind signals OR has arbitrary values
    if (tokenCount >= 2) {
      const signalRatio = tailwindSignalCount / tokenCount;
      return signalRatio >= 0.5 || hasArbitraryValue;
    }
    return tailwindSignalCount >= 1 || hasArbitraryValue;
  }

  if (tokenCount < 2) {
    return false;
  }

  // Lower threshold for multi-token detection
  return tailwindSignalCount >= 1 || hasArbitraryValue;
}

/**
 * Check if text is likely a single-token Tailwind utility class.
 * Catches classes like "flex-1", "p-6", "text-white" that bypass the multi-token check.
 */
function isLikelySingleTokenTailwindClass(text: string): boolean {
  // Must be a single token (no spaces)
  if (text.includes(' ')) {
    return false;
  }

  // Must match the general Tailwind utility pattern
  const TAILWIND_SINGLE_TOKEN_PATTERN = /^(flex|grid|block|inline|hidden|p|m|w|h|gap|space|text|bg|border|rounded|shadow|ring|outline|p|m|w|h|gap|space|text|bg|border|rounded|shadow|ring|outline|font|leading|tracking|opacity|z|top|right|bottom|left|inset|overflow|cursor|pointer|select|resize|sr|object|break|whitespace|truncate|animate|transition|duration|ease|delay|scale|rotate|translate|skew|origin|col|row|order|justify|items|content|self|place|float|clear)[-]?\d*[a-z0-9./\[\]-]*$/i;

  if (!TAILWIND_SINGLE_TOKEN_PATTERN.test(text)) {
    return false;
  }

  // Additional heuristics: must contain at least one digit or specific Tailwind signals
  const hasDigit = /\d/.test(text);
  const hasArbitraryValue = /\[[\d.]+\]/.test(text);
  const hasTailwindPrefix = /^(flex|grid|block|inline|hidden|p|m|w|h|gap|space|text|bg|border|rounded|shadow|ring|outline|font|leading|tracking|opacity|z|top|right|bottom|left|inset|overflow|cursor|pointer|select|resize|sr|object|break|whitespace|truncate|animate|transition|duration|ease|delay|scale|rotate|translate|skew|origin|col|row|order|justify|items|content|self|place|float|clear)/.test(text);

  return hasDigit || hasArbitraryValue || hasTailwindPrefix;
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