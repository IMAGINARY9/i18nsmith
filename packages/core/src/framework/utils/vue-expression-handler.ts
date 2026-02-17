/**
 * Vue-specific Interpolation Utilities
 * 
 * Provides utilities for handling Vue template interpolations and expressions.
 * Brings parity with React adapter's expression handling.
 */

import {
  ExpressionType,
} from './expression-analyzer.js';
import {
  InterpolationFormat,
} from './template-literal-handler.js';
import {
  AdjacentStrategy,
} from './adjacent-text-handler.js';
import {
  PatternDetector,
} from './pattern-detector.js';

/**
 * Result of analyzing a Vue template expression
 */
export interface VueExpressionAnalysis {
  /** Type of expression */
  type: ExpressionType;
  /** Whether this can be extracted */
  canExtract: boolean;
  /** Extracted text parts */
  textParts: string[];
  /** Dynamic expressions that become interpolation parameters */
  dynamicExpressions: string[];
  /** The merged text for locale files (with placeholders) */
  mergedText?: string;
  /** Interpolation parameters for the t() call */
  interpolationParams?: Record<string, string>;
  /** Reason if not extractable */
  skipReason?: string;
}

/**
 * Options for Vue expression analysis
 */
export interface VueAnalysisOptions {
  /** Interpolation format to use (defaults to Vue's {name} format) */
  interpolationFormat?: InterpolationFormat;
  /** Whether to analyze adjacent text nodes */
  analyzeAdjacent?: boolean;
  /** Pattern detector configuration */
  patternDetector?: PatternDetector;
}

/**
 * Represents a Vue template child node
 */
export interface VueTemplateChild {
  type: 'VText' | 'VExpressionContainer' | 'VElement';
  /** The raw text (for VText nodes) */
  text?: string;
  /** The expression content (for VExpressionContainer) */
  expression?: string;
  /** Range in source [start, end] */
  range: [number, number];
}

/**
 * Analyze a Vue template expression (from {{ expression }})
 * 
 * Supports:
 * - Simple strings: {{ 'Hello' }}
 * - Template literals: {{ `Hello ${name}` }}
 * - Concatenation: {{ 'Hello ' + name }}
 * - Conditional: {{ isAdmin ? 'Admin' : 'User' }}
 */
export function analyzeVueExpression(
  expression: string,
  options: VueAnalysisOptions = {}
): VueExpressionAnalysis {
  const { interpolationFormat = InterpolationFormat.Vue } = options;
  const patternDetector = options.patternDetector ?? new PatternDetector();

  // String concatenation: 'Hello ' + name + '!' 
  // Check for + outside of quotes by seeing if there's a + that's not part of a simple literal
  if (hasConcatenation(expression)) {
    const result = analyzeStringConcatenation(expression, interpolationFormat);
    return result;
  }

  // Simple string literal: 'text' or "text"
  const stringLiteralMatch = expression.match(/^(['"])(.+?)\1$/);
  if (stringLiteralMatch) {
    const text = stringLiteralMatch[2];
    
    // Check if the content itself is non-translatable
    const textPatternResult = patternDetector.detect(text);
    if (textPatternResult.isNonTranslatable) {
      return {
        type: ExpressionType.NonTranslatable,
        canExtract: false,
        textParts: [],
        dynamicExpressions: [],
        skipReason: textPatternResult.reason,
      };
    }

    return {
      type: ExpressionType.SimpleString,
      canExtract: true,
      textParts: [text],
      dynamicExpressions: [],
      mergedText: text,
      interpolationParams: {},
    };
  }

  // Template literal: `text ${expr}`
  const templateLiteralMatch = expression.match(/^`([\s\S]*)`$/);
  if (templateLiteralMatch) {
    const templateContent = templateLiteralMatch[1];
    const result = analyzeTemplateLiteral(templateContent, interpolationFormat);
    
    if (!result.canExtract) {
      return {
        type: result.type,
        canExtract: false,
        textParts: [],
        dynamicExpressions: result.dynamicExpressions,
        skipReason: result.skipReason,
      };
    }

    return {
      type: result.dynamicExpressions.length > 0
        ? ExpressionType.TemplateWithExpressions
        : ExpressionType.SimpleTemplateLiteral,
      canExtract: true,
      textParts: result.textParts,
      dynamicExpressions: result.dynamicExpressions,
      mergedText: result.mergedText,
      interpolationParams: result.interpolationParams,
    };
  }

  // Conditional expression: condition ? 'a' : 'b'
  const conditionalMatch = expression.match(/^(.+?)\s*\?\s*(['"`])(.+?)\2\s*:\s*(['"`])(.+?)\4$/);
  if (conditionalMatch) {
    const [, condition, , trueValue, , falseValue] = conditionalMatch;
    return {
      type: ExpressionType.ConditionalStrings,
      canExtract: true,
      textParts: [trueValue, falseValue],
      dynamicExpressions: [condition.trim()],
      // For conditionals, we might want to extract both strings separately
      // or use ICU select format
      skipReason: 'Conditional expressions require manual handling',
    };
  }

  // Logical expression with fallback: expr || 'fallback'
  const logicalMatch = expression.match(/^(.+?)\s*(?:\|\||&&|\?\?)\s*(['"`])(.+?)\2$/);
  if (logicalMatch) {
    const [, leftExpr, , fallbackValue] = logicalMatch;
    return {
      type: ExpressionType.LogicalWithFallback,
      canExtract: false, // Fallback strings shouldn't be extracted
      textParts: [fallbackValue],
      dynamicExpressions: [leftExpr.trim()],
      skipReason: 'Logical fallback values are typically default values, not user-facing text',
    };
  }

  // Pure dynamic expression (variable, function call, etc.)
  return {
    type: ExpressionType.PureDynamic,
    canExtract: false,
    textParts: [],
    dynamicExpressions: [expression],
    skipReason: 'Pure dynamic expression without static text',
  };
}

/**
 * Analyze a template literal content
 */
function analyzeTemplateLiteral(
  content: string,
  format: InterpolationFormat
): VueExpressionAnalysis {
  const textParts: string[] = [];
  const dynamicExpressions: string[] = [];
  const interpolationParams: Record<string, string> = {};

  // Split on ${...} expressions
  const parts = content.split(/\$\{([^}]+)\}/);
  
  let mergedText = '';
  let paramIndex = 0;

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Static text part
      const text = parts[i];
      if (text) {
        textParts.push(text);
        mergedText += text;
      }
    } else {
      // Dynamic expression part
      const expr = parts[i].trim();
      dynamicExpressions.push(expr);
      
      // Generate parameter name
      const paramName = getParamName(expr, paramIndex++);
      interpolationParams[paramName] = expr;
      
      // Add placeholder based on format
      mergedText += formatPlaceholder(paramName, format);
    }
  }

  // Check if we have any meaningful static text
  const hasStaticText = textParts.some(t => t.trim().length > 0);
  if (!hasStaticText) {
    return {
      type: ExpressionType.PureDynamic,
      canExtract: false,
      textParts: [],
      dynamicExpressions,
      skipReason: 'Template literal contains only dynamic expressions',
    };
  }

  return {
    type: ExpressionType.TemplateWithExpressions,
    canExtract: true,
    textParts,
    dynamicExpressions,
    mergedText,
    interpolationParams,
  };
}

/**
 * Check if expression contains concatenation with + outside quotes
 */
function hasConcatenation(expression: string): boolean {
  if (!expression.includes('+')) return false;
  
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let braceDepth = 0;

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    const prevChar = expression[i - 1];

    // Track quote state
    if (char === "'" && !inDoubleQuote && !inBacktick && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && !inBacktick && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote && prevChar !== '\\') {
      inBacktick = !inBacktick;
    }

    // Track brace depth (for template literal expressions)
    if (char === '{' && inBacktick) {
      braceDepth++;
    } else if (char === '}' && inBacktick) {
      braceDepth--;
    }

    // Found + outside quotes and braces = it's a concatenation
    if (char === '+' && !inSingleQuote && !inDoubleQuote && !inBacktick && braceDepth === 0) {
      return true;
    }
  }

  return false;
}

/**
 * Analyze string concatenation expression
 */
function analyzeStringConcatenation(
  expression: string,
  format: InterpolationFormat
): VueExpressionAnalysis {
  const textParts: string[] = [];
  const dynamicExpressions: string[] = [];
  const interpolationParams: Record<string, string> = {};

  // Split by + but be careful about + inside quotes
  const parts = splitConcatenation(expression);
  
  let mergedText = '';
  let paramIndex = 0;
  let hasStaticPart = false;

  for (const part of parts) {
    const trimmed = part.trim();
    
    // String literal: 'text' or "text"
    const stringMatch = trimmed.match(/^(['"])(.+?)\1$/);
    if (stringMatch) {
      const text = stringMatch[2];
      textParts.push(text);
      mergedText += text;
      hasStaticPart = true;
      continue;
    }

    // Template literal (backticks without ${})
    const templateMatch = trimmed.match(/^`([^`]*)`$/);
    if (templateMatch) {
      const text = templateMatch[1];
      textParts.push(text);
      mergedText += text;
      hasStaticPart = true;
      continue;
    }

    // Dynamic expression
    dynamicExpressions.push(trimmed);
    const paramName = getParamName(trimmed, paramIndex++);
    interpolationParams[paramName] = trimmed;
    mergedText += formatPlaceholder(paramName, format);
  }

  if (!hasStaticPart) {
    return {
      type: ExpressionType.PureDynamic,
      canExtract: false,
      textParts: [],
      dynamicExpressions,
      skipReason: 'Concatenation contains only dynamic parts',
    };
  }

  const type = dynamicExpressions.length > 0
    ? ExpressionType.MixedConcatenation
    : ExpressionType.StaticConcatenation;

  return {
    type,
    canExtract: true,
    textParts,
    dynamicExpressions,
    mergedText,
    interpolationParams,
  };
}

/**
 * Split concatenation expression by + outside of quotes
 */
function splitConcatenation(expression: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let braceDepth = 0;

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i];
    const prevChar = expression[i - 1];

    // Track quote state
    if (char === "'" && !inDoubleQuote && !inBacktick && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote && !inBacktick && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote && prevChar !== '\\') {
      inBacktick = !inBacktick;
    }

    // Track brace depth (for template literal expressions)
    if (char === '{' && inBacktick) {
      braceDepth++;
    } else if (char === '}' && inBacktick) {
      braceDepth--;
    }

    // Split on + outside quotes and braces
    if (char === '+' && !inSingleQuote && !inDoubleQuote && !inBacktick && braceDepth === 0) {
      if (current.trim()) {
        parts.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Generate a parameter name from an expression
 */
function getParamName(expression: string, index: number): string {
  // Simple variable: use the variable name
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(expression)) {
    return expression;
  }

  // Property access: use the last property name
  const propMatch = expression.match(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (propMatch) {
    return propMatch[1];
  }

  // Method call: use the method name
  const methodMatch = expression.match(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/);
  if (methodMatch) {
    return methodMatch[1];
  }

  // Fallback to indexed name
  return `param${index}`;
}

/**
 * Format a placeholder based on interpolation format
 */
function formatPlaceholder(name: string, format: InterpolationFormat): string {
  switch (format) {
    case InterpolationFormat.Vue:
    case InterpolationFormat.ICU:
      return `{${name}}`;
    case InterpolationFormat.I18next:
      return `{{${name}}}`;
    case InterpolationFormat.Printf:
      return '%s';
    default:
      return `{${name}}`;
  }
}

/**
 * Result of analyzing adjacent Vue template content
 */
export interface VueAdjacentAnalysis {
  /** Whether this can be merged into a single interpolated string */
  canInterpolate: boolean;
  /** Suggested strategy */
  strategy: AdjacentStrategy;
  /** Static text parts */
  textParts: string[];
  /** Dynamic expressions */
  expressions: string[];
  /** The merged template text for locale files */
  mergedText?: string;
  /** Interpolation parameters for the t() call */
  interpolationParams?: Record<string, string>;
  /** Reason if cannot interpolate */
  skipReason?: string;
}

/**
 * Analyze adjacent Vue template content (text nodes + expression containers)
 * 
 * Handles patterns like:
 *   <p>User name: {{ userName }}</p>
 *   <p>{{ count }} items remaining</p>
 */
export function analyzeVueAdjacentContent(
  children: VueTemplateChild[],
  options: VueAnalysisOptions = {}
): VueAdjacentAnalysis {
  const { interpolationFormat = InterpolationFormat.Vue } = options;
  
  const textParts: string[] = [];
  const expressions: string[] = [];
  const interpolationParams: Record<string, string> = {};
  let mergedText = '';
  let paramIndex = 0;
  let hasStaticText = false;

  for (const child of children) {
    if (child.type === 'VText' && child.text) {
      const trimmed = child.text.trim();
      if (trimmed) {
        textParts.push(trimmed);
        mergedText += child.text; // Preserve whitespace in merged text
        hasStaticText = true;
      } else if (child.text) {
        mergedText += child.text; // Preserve spacing
      }
    } else if (child.type === 'VExpressionContainer' && child.expression) {
      const expr = child.expression.trim();
      expressions.push(expr);
      
      const paramName = getParamName(expr, paramIndex++);
      interpolationParams[paramName] = expr;
      mergedText += formatPlaceholder(paramName, interpolationFormat);
    }
  }

  // Determine if we can interpolate
  if (!hasStaticText) {
    return {
      canInterpolate: false,
      strategy: AdjacentStrategy.Separate,
      textParts: [],
      expressions,
      skipReason: 'No static text to extract',
    };
  }

  // Check for very short fragments that aren't meaningful
  const totalStaticText = textParts.join('');
  if (totalStaticText.length < 2) {
    return {
      canInterpolate: false,
      strategy: AdjacentStrategy.Separate,
      textParts,
      expressions,
      skipReason: 'Static text too short',
    };
  }

  return {
    canInterpolate: true,
    strategy: expressions.length > 0 ? AdjacentStrategy.Interpolate : AdjacentStrategy.TextOnly,
    textParts,
    expressions,
    mergedText: mergedText.trim(),
    interpolationParams,
  };
}

/**
 * Generate Vue template replacement for an extracted string
 * 
 * Generates appropriate Vue i18n syntax:
 * - Simple: {{ $t('key') }}
 * - With params: {{ $t('key', { name: userName }) }}
 */
export function generateVueReplacement(
  key: string,
  params?: Record<string, string>,
  options: { useDoubleQuotes?: boolean } = {}
): string {
  const quote = options.useDoubleQuotes ? '"' : "'";
  
  if (!params || Object.keys(params).length === 0) {
    return `{{ $t(${quote}${key}${quote}) }}`;
  }

  const paramsStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  return `{{ $t(${quote}${key}${quote}, { ${paramsStr} }) }}`;
}

/**
 * Generate attribute replacement for Vue templates
 * 
 * For static attributes: :attr="$t('key')"
 * For dynamic attributes: :attr="$t('key', { param })"
 */
export function generateVueAttributeReplacement(
  key: string,
  params?: Record<string, string>,
  options: { useDoubleQuotes?: boolean } = {}
): string {
  const quote = options.useDoubleQuotes ? '"' : "'";
  
  if (!params || Object.keys(params).length === 0) {
    return `$t(${quote}${key}${quote})`;
  }

  const paramsStr = Object.entries(params)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  return `$t(${quote}${key}${quote}, { ${paramsStr} })`;
}
