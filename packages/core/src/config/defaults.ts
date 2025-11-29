/**
 * Default configuration values for i18nsmith
 */

import type { PlaceholderFormat } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// File Pattern Defaults
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_INCLUDE = [
  'src/**/*.{ts,tsx,js,jsx}',
  'app/**/*.{ts,tsx,js,jsx}',
  'pages/**/*.{ts,tsx,js,jsx}',
  'components/**/*.{ts,tsx,js,jsx}',
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
export const DEFAULT_CONFIG_FILENAME = 'i18n.config.json';
