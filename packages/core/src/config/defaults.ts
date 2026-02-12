/**
 * Default configuration values for i18nsmith
 */

import type { PlaceholderFormat } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// File Pattern Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_INCLUDE = [
  'src/**/*.{ts,tsx,js,jsx,vue}',
  'app/**/*.{ts,tsx,js,jsx,vue}',
  'pages/**/*.{ts,tsx,js,jsx,vue}',
  'components/**/*.{ts,tsx,js,jsx,vue}',
];

export const DEFAULT_EXCLUDE = ['node_modules/**', '.next/**', 'dist/**'];

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PLACEHOLDER_FORMATS: PlaceholderFormat[] = [
  'doubleCurly',
  'percentCurly',
  'percentSymbol',
];

// ─────────────────────────────────────────────────────────────────────────────
// Empty Value Detection Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_EMPTY_VALUE_MARKERS = ['todo', 'tbd', 'fixme', 'pending', '???'];

// ─────────────────────────────────────────────────────────────────────────────
// Other Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_SOURCE_LANGUAGE = 'en';
export const DEFAULT_LOCALES_DIR = 'locales';
export const DEFAULT_MIN_TEXT_LENGTH = 1;
export const DEFAULT_LOCALE_FORMAT = 'auto';
export const DEFAULT_LOCALE_DELIMITER = '.';
export const DEFAULT_LOCALE_SORT_KEYS = 'alphabetical';
export const DEFAULT_KEY_NAMESPACE = 'common';
export const DEFAULT_SHORT_HASH_LEN = 6;
export const DEFAULT_TRANSLATION_IDENTIFIER = 't';
export const DEFAULT_ADAPTER_MODULE = 'react-i18next';
export const DEFAULT_ADAPTER_HOOK = 'useTranslation';

// ─────────────────────────────────────────────────────────────────────────────
// Extraction Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_EXTRACTION_PRESET = 'standard';

export const STRICT_DENY_PATTERNS = [
  // Single-token Tailwind utility classes
  '^(flex|grid|block|inline|hidden|p|m|w|h|gap|space|text|bg|border|rounded|shadow|ring|outline|font|leading|tracking|opacity|z|top|right|bottom|left|inset|overflow|cursor|pointer|select|resize|sr|object|break|whitespace|truncate|animate|transition|duration|ease|delay|scale|rotate|translate|skew|origin|col|row|order|justify|items|content|self|place|float|clear)[-]?(xs|sm|md|lg|xl|2xl)?\\d*[a-z0-9./\\[\\]-]*$',
  // HTML input types
  '^(text|submit|checkbox|hidden|number|radio|range|button|password|email|tel|date|time|file|search|url|color|reset|image)$',
  // CSS property values
  '^(bold|normal|italic|center|left|right|justify|top|bottom|baseline|middle|flex|grid|block|inline|none|hidden|visible|absolute|relative|fixed|sticky|transparent|inherit|initial|unset|auto|wrap|nowrap|uppercase|lowercase|capitalize|underline|overline|pointer|default|cover|contain|scroll|smooth|start|end|stretch)$',
  // Locale codes
  '^[a-z]{2,3}$',
  // SVG attributes
  '^(evenodd|nonzero|M|L|H|V|Z|C|S|Q|T|A)$',
  // DOM event names
  '^on[a-zA-Z]+$',
  // SCREAMING_CASE constants (case-sensitive regex)
  /^[A-Z][A-Z0-9_]{2,}$/,
  // Short SVG paths
  '^M\\s*\\d+.*$',
  // CSS transitions
  '^\\w+\\s+\\d+(\\.\\d+)?s?$',
];

export const STANDARD_DENY_PATTERNS = [
  // Basic HTML types and common CSS values
  '^(text|submit|checkbox|hidden|number|radio|range|button|bold|normal|center|left|right|flex|block|none|hidden|auto)$',
  // Locale codes
  '^[a-z]{2,3}$',
  // SCREAMING_CASE constants (case-sensitive regex)
  /^[A-Z][A-Z0-9_]{2,}$/,
];
export const DEFAULT_CONFIG_FILENAME = 'i18n.config.json';
