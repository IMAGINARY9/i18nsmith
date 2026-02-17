/**
 * Non-Translatable Pattern Detector
 * 
 * Enhanced detection of patterns that should NOT be extracted for translation.
 * Includes configurable patterns and support for custom pattern definitions.
 */

/**
 * Pattern category for classification
 */
export enum PatternCategory {
  /** Data structures like JSON, XML */
  DataStructure = 'data-structure',
  /** Code patterns like SQL, regex */
  Code = 'code',
  /** Technical strings like format specifiers */
  Technical = 'technical',
  /** Data values like phone numbers, emails */
  DataValue = 'data-value',
  /** Already internationalized strings */
  AlreadyI18n = 'already-i18n',
  /** UI elements that shouldn't be translated */
  UIElement = 'ui-element',
  /** User input or dynamic content */
  UserContent = 'user-content',
}

/**
 * Result of pattern detection
 */
export interface PatternDetectionResult {
  /** Whether the pattern was detected */
  isNonTranslatable: boolean;
  /** Category of the detected pattern */
  category?: PatternCategory;
  /** Specific pattern name that matched */
  patternName?: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Reason for the detection */
  reason?: string;
}

/**
 * Pattern definition for detection
 */
export interface PatternDefinition {
  /** Unique name for the pattern */
  name: string;
  /** Category of the pattern */
  category: PatternCategory;
  /** Regular expression or function to detect the pattern */
  matcher: RegExp | ((text: string) => boolean);
  /** Confidence score when matched (0-1) */
  confidence: number;
  /** Whether this pattern can be overridden by configuration */
  configurable?: boolean;
  /** Description of what this pattern detects */
  description?: string;
}

/**
 * Configuration for pattern detection
 */
export interface PatternDetectorConfig {
  /** Patterns to enable (by name) */
  enabledPatterns?: string[];
  /** Patterns to disable (by name) */
  disabledPatterns?: string[];
  /** Custom patterns to add */
  customPatterns?: PatternDefinition[];
  /** Categories to skip entirely */
  skipCategories?: PatternCategory[];
  /** Minimum confidence threshold */
  minConfidence?: number;
}

// =============================================================================
// Built-in Pattern Definitions
// =============================================================================

const JSON_OBJECT_PATTERN: PatternDefinition = {
  name: 'json-object',
  category: PatternCategory.DataStructure,
  matcher: /^\s*\{[\s\S]*"[\w-]+"[\s\S]*:[\s\S]*\}\s*$/,
  confidence: 0.95,
  description: 'JSON object literals',
};

const JSON_ARRAY_PATTERN: PatternDefinition = {
  name: 'json-array',
  category: PatternCategory.DataStructure,
  matcher: /^\s*\[[\s\S]*\]\s*$/,
  confidence: 0.8, // Lower confidence as arrays could be legitimate text
  description: 'JSON array literals',
};

const XML_HTML_PATTERN: PatternDefinition = {
  name: 'xml-html',
  category: PatternCategory.DataStructure,
  matcher: /^\s*<[a-zA-Z][\s\S]*>[\s\S]*<\/[a-zA-Z][\s\S]*>\s*$/,
  confidence: 0.9,
  description: 'XML/HTML fragments',
};

const SQL_PATTERN: PatternDefinition = {
  name: 'sql',
  category: PatternCategory.Code,
  matcher: /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ORDER\s+BY|GROUP\s+BY|CREATE|DROP|ALTER|TRUNCATE)\b/i,
  confidence: 0.95,
  description: 'SQL query patterns',
};

const REGEX_PATTERN: PatternDefinition = {
  name: 'regex',
  category: PatternCategory.Code,
  matcher: /^\/[^/]+\/[gimsuvy]*$/,
  confidence: 0.9,
  description: 'Regular expression literals',
};

const CSS_SELECTOR_PATTERN: PatternDefinition = {
  name: 'css-selector',
  category: PatternCategory.Code,
  matcher: /^[#.]?[a-zA-Z_-][\w-]*(\s*[>+~]\s*[#.]?[a-zA-Z_-][\w-]*)*$/,
  confidence: 0.7, // Lower confidence as some words could match
  description: 'CSS selector patterns',
};

const XPATH_PATTERN: PatternDefinition = {
  name: 'xpath',
  category: PatternCategory.Code,
  matcher: /^\/\/[a-zA-Z][\w]*(\[.*\])?/,
  confidence: 0.9,
  description: 'XPath expressions',
};

const FORMAT_SPECIFIER_PATTERN: PatternDefinition = {
  name: 'format-specifier',
  category: PatternCategory.Technical,
  matcher: /^[%$]?[sdifbuoxXeEgGp](\s+[%$]?[sdifbuoxXeEgGp])*$/,
  confidence: 0.95,
  description: 'Printf-style format specifiers',
};

const LOG_FORMAT_PATTERN: PatternDefinition = {
  name: 'log-format',
  category: PatternCategory.Technical,
  matcher: /^\s*\[[A-Z]+\]\s*$/,
  confidence: 0.85,
  description: 'Log level indicators like [INFO], [ERROR]',
};

const VERSION_PATTERN: PatternDefinition = {
  name: 'version',
  category: PatternCategory.Technical,
  matcher: /^v?\d+\.\d+(\.\d+)?(-[a-zA-Z0-9]+)?$/,
  confidence: 0.9,
  description: 'Version strings like 1.0.0, v2.3.4-beta',
};

const DATE_FORMAT_PATTERN: PatternDefinition = {
  name: 'date-format',
  category: PatternCategory.Technical,
  matcher: /^[YMDHhms]{1,4}[-/:.][YMDHhms]{1,4}([-/:.][YMDHhms]{1,4})*$/i,
  confidence: 0.85,
  description: 'Date format patterns like YYYY-MM-DD',
};

const PHONE_PATTERN: PatternDefinition = {
  name: 'phone',
  category: PatternCategory.DataValue,
  // Matches: +1 555 123 4567, 555-123-4567, (555) 123-4567, +1-555-123-4567
  matcher: /^[+]?\d{0,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}$/,
  confidence: 0.85,
  description: 'Phone number patterns',
};

const EMAIL_PATTERN: PatternDefinition = {
  name: 'email',
  category: PatternCategory.DataValue,
  matcher: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  confidence: 0.95,
  description: 'Email address patterns',
};

const URL_PATTERN: PatternDefinition = {
  name: 'url',
  category: PatternCategory.DataValue,
  matcher: /^(https?:\/\/|ftp:\/\/|mailto:|tel:|data:)/i,
  confidence: 0.9,
  description: 'URL patterns',
};

const IP_ADDRESS_PATTERN: PatternDefinition = {
  name: 'ip-address',
  category: PatternCategory.DataValue,
  matcher: /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/,
  confidence: 0.95,
  description: 'IP address patterns',
};

const UUID_PATTERN: PatternDefinition = {
  name: 'uuid',
  category: PatternCategory.DataValue,
  matcher: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  confidence: 0.99,
  description: 'UUID patterns',
};

const HEX_COLOR_PATTERN: PatternDefinition = {
  name: 'hex-color',
  category: PatternCategory.DataValue,
  matcher: /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i,
  confidence: 0.95,
  description: 'Hex color codes',
};

const FILE_PATH_PATTERN: PatternDefinition = {
  name: 'file-path',
  category: PatternCategory.DataValue,
  matcher: (text) => {
    // Check for common path patterns
    const pathPatterns = [
      /^[./][\w./\\-]+\.[a-zA-Z]{2,4}$/, // Relative paths with extension
      /^[A-Z]:\\/, // Windows absolute paths
      /^\/[a-zA-Z]/, // Unix absolute paths
      /^\.\.\//, // Parent directory references
    ];
    return pathPatterns.some(p => p.test(text));
  },
  confidence: 0.85,
  description: 'File system paths',
};

const I18N_CALL_PATTERN: PatternDefinition = {
  name: 'i18n-call',
  category: PatternCategory.AlreadyI18n,
  matcher: /^(t|i18n|translate|\$t|useTranslation|useI18n)\s*\(/,
  confidence: 0.99,
  description: 'Existing i18n function calls',
};

const TRANSLATION_KEY_PATTERN: PatternDefinition = {
  name: 'translation-key',
  category: PatternCategory.AlreadyI18n,
  matcher: /^[a-z][a-z0-9]*([._][a-z][a-z0-9]*)+$/i,
  confidence: 0.7, // Lower confidence as this overlaps with valid text
  description: 'Translation key patterns like common.buttons.submit',
};

const EMOJI_ONLY_PATTERN: PatternDefinition = {
  name: 'emoji-only',
  category: PatternCategory.UIElement,
  matcher: /^[\p{Emoji}\s]+$/u,
  confidence: 0.9,
  description: 'Emoji-only strings',
};

const SYMBOL_ONLY_PATTERN: PatternDefinition = {
  name: 'symbol-only',
  category: PatternCategory.UIElement,
  matcher: /^[^\p{L}\p{N}\s]+$/u,
  confidence: 0.9,
  description: 'Symbol-only strings (no letters or numbers)',
};

const HTML_ENTITY_PATTERN: PatternDefinition = {
  name: 'html-entity',
  category: PatternCategory.UIElement,
  matcher: /^&[a-z][a-z0-9]*;$/i,
  confidence: 0.95,
  description: 'HTML entities like &nbsp;, &copy;',
};

const PLACEHOLDER_PATTERN: PatternDefinition = {
  name: 'placeholder',
  category: PatternCategory.UserContent,
  matcher: /^\{\{[\w.]+\}\}$|^\{[\w.]+\}$|^%[a-z]$/i,
  confidence: 0.9,
  description: 'Placeholder patterns like {{name}}, {value}',
};

// All built-in patterns
const BUILT_IN_PATTERNS: PatternDefinition[] = [
  // Data structures
  JSON_OBJECT_PATTERN,
  JSON_ARRAY_PATTERN,
  XML_HTML_PATTERN,
  // Code
  SQL_PATTERN,
  REGEX_PATTERN,
  CSS_SELECTOR_PATTERN,
  XPATH_PATTERN,
  // Technical
  FORMAT_SPECIFIER_PATTERN,
  LOG_FORMAT_PATTERN,
  VERSION_PATTERN,
  DATE_FORMAT_PATTERN,
  // Data values
  PHONE_PATTERN,
  EMAIL_PATTERN,
  URL_PATTERN,
  IP_ADDRESS_PATTERN,
  UUID_PATTERN,
  HEX_COLOR_PATTERN,
  FILE_PATH_PATTERN,
  // Already i18n
  I18N_CALL_PATTERN,
  TRANSLATION_KEY_PATTERN,
  // UI elements
  EMOJI_ONLY_PATTERN,
  SYMBOL_ONLY_PATTERN,
  HTML_ENTITY_PATTERN,
  // User content
  PLACEHOLDER_PATTERN,
];

/**
 * Non-translatable pattern detector
 */
export class PatternDetector {
  private patterns: PatternDefinition[];
  private config: PatternDetectorConfig;

  constructor(config: PatternDetectorConfig = {}) {
    this.config = config;
    this.patterns = this.buildPatternList();
  }

  /**
   * Build the final pattern list based on configuration
   */
  private buildPatternList(): PatternDefinition[] {
    let patterns = [...BUILT_IN_PATTERNS];

    // Add custom patterns
    if (this.config.customPatterns) {
      patterns = [...patterns, ...this.config.customPatterns];
    }

    // Filter by enabled/disabled patterns
    if (this.config.enabledPatterns && this.config.enabledPatterns.length > 0) {
      patterns = patterns.filter(p => this.config.enabledPatterns!.includes(p.name));
    }

    if (this.config.disabledPatterns) {
      patterns = patterns.filter(p => !this.config.disabledPatterns!.includes(p.name));
    }

    // Filter by categories
    if (this.config.skipCategories) {
      patterns = patterns.filter(p => !this.config.skipCategories!.includes(p.category));
    }

    return patterns;
  }

  /**
   * Detect if text matches any non-translatable pattern
   */
  detect(text: string): PatternDetectionResult {
    if (!text || text.trim().length === 0) {
      return { isNonTranslatable: false, confidence: 0 };
    }

    const trimmed = text.trim();
    const minConfidence = this.config.minConfidence ?? 0;

    for (const pattern of this.patterns) {
      const matches = typeof pattern.matcher === 'function'
        ? pattern.matcher(trimmed)
        : pattern.matcher.test(trimmed);

      if (matches && pattern.confidence >= minConfidence) {
        return {
          isNonTranslatable: true,
          category: pattern.category,
          patternName: pattern.name,
          confidence: pattern.confidence,
          reason: pattern.description,
        };
      }
    }

    return { isNonTranslatable: false, confidence: 0 };
  }

  /**
   * Detect all matching patterns for text
   */
  detectAll(text: string): PatternDetectionResult[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const trimmed = text.trim();
    const minConfidence = this.config.minConfidence ?? 0;
    const results: PatternDetectionResult[] = [];

    for (const pattern of this.patterns) {
      const matches = typeof pattern.matcher === 'function'
        ? pattern.matcher(trimmed)
        : pattern.matcher.test(trimmed);

      if (matches && pattern.confidence >= minConfidence) {
        results.push({
          isNonTranslatable: true,
          category: pattern.category,
          patternName: pattern.name,
          confidence: pattern.confidence,
          reason: pattern.description,
        });
      }
    }

    // Sort by confidence descending
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get all available pattern names
   */
  getPatternNames(): string[] {
    return this.patterns.map(p => p.name);
  }

  /**
   * Get patterns by category
   */
  getPatternsByCategory(category: PatternCategory): PatternDefinition[] {
    return this.patterns.filter(p => p.category === category);
  }
}

/**
 * Quick detection function using default configuration
 */
export function isNonTranslatable(text: string): boolean {
  const detector = new PatternDetector();
  return detector.detect(text).isNonTranslatable;
}

/**
 * Get detection details using default configuration
 */
export function detectNonTranslatablePattern(text: string): PatternDetectionResult {
  const detector = new PatternDetector();
  return detector.detect(text);
}

/**
 * Export all built-in pattern names for configuration
 */
export const PATTERN_NAMES = BUILT_IN_PATTERNS.map(p => p.name);

/**
 * Export categories for configuration
 */
export { PatternCategory as PATTERN_CATEGORIES };
