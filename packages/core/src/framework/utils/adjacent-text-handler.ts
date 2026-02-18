/**
 * Adjacent Text Handler
 * 
 * Handles patterns where static JSX text is adjacent to dynamic expressions.
 * Examples:
 * - <p>User name: {userName}</p>  → Label + variable
 * - <p>{count} items remaining</p> → Variable + label
 * - <p>Hello {name}, you have {count} messages</p> → Interleaved
 */

import { Node, JsxElement, JsxSelfClosingElement } from 'ts-morph';
import { generateKey as defaultKeyGen, stripAdjacentPunctuation } from './text-filters.js';

/**
 * Strategy for handling adjacent text and expressions
 */
export enum AdjacentStrategy {
  /** Keep text and expressions separate */
  Separate = 'separate',
  /** Merge into single interpolated string */
  Interpolate = 'interpolate',
  /** Only extract static text, leave expressions */
  TextOnly = 'text-only',
}

/**
 * A child element in the JSX element
 */
export interface JsxChild {
  /** Type of child */
  type: 'text' | 'expression' | 'element' | 'other';
  /** Original text content (for text nodes) */
  text?: string;
  /** Cleaned text (trimmed, normalized) */
  cleanedText?: string;
  /** Expression text (for expression nodes) */
  expression?: string;
  /** Whether this is a static expression (e.g., {'Hello'}) */
  isStaticExpression?: boolean;
  /** Start position in source */
  start: number;
  /** End position in source */
  end: number;
  /** The original node */
  node: Node;
}

/**
 * Analysis result for adjacent text patterns
 */
export interface AdjacentAnalysis {
  /** Whether this element has adjacent text/expression patterns */
  hasAdjacentPattern: boolean;
  /** Children of the JSX element */
  children: JsxChild[];
  /** Total static text content (concatenated) */
  staticText: string;
  /** Dynamic expressions found */
  expressions: Array<{ name: string; expression: string; position: number }>;
  /** Suggested strategy for handling */
  suggestedStrategy: AdjacentStrategy;
  /** Whether all content can be interpolated */
  canInterpolate: boolean;
  /** Reason if cannot interpolate */
  noInterpolateReason?: string;
  /** Combined template for interpolation */
  interpolationTemplate?: string;
  /** Locale value for the interpolation */
  localeValue?: string;
  /** Suggested key */
  suggestedKey?: string;
  /** Replacement code */
  replacement?: string;
}

/**
 * Options for adjacent text handling
 */
export interface AdjacentOptions {
  /** Preferred strategy */
  strategy?: AdjacentStrategy;
  /** Interpolation format */
  format?: 'i18next' | 'icu' | 'vue' | 'printf';
  /** Translation function name */
  translationFn?: string;
  /** Key generator function */
  keyGenerator?: (text: string) => string;
  /** Minimum text length to extract */
  minTextLength?: number;
  /** Whether to trim whitespace */
  trimWhitespace?: boolean;
}

// Patterns that indicate expression is not a simple variable
const COMPLEX_EXPRESSION_PATTERNS = [
  /\(.*\)/,           // Function calls
  /\?.*:/,            // Ternary
  /&&|\|\|/,          // Logical operators
  /\+|-|\*|\//,       // Arithmetic (but not +string concat)
  /\[.*\]/,           // Array access with complex expression
];

/**
 * Analyze JSX element children for adjacent text/expression patterns
 */
export function analyzeAdjacentContent(
  element: JsxElement | JsxSelfClosingElement,
  options: AdjacentOptions = {}
): AdjacentAnalysis {
  const {
    strategy = AdjacentStrategy.Interpolate,
    format = 'i18next',
    translationFn = 't',
    keyGenerator = defaultKeyGen,
    minTextLength = 2,
    trimWhitespace = true,
  } = options;

  const children = getJsxChildren(element);
  
  if (children.length === 0) {
    return createEmptyAnalysis();
  }

  // Analyze each child
  const analyzedChildren: JsxChild[] = children.map(child => analyzeChild(child, trimWhitespace));
  
  // Filter out empty/whitespace-only text nodes for pattern detection
  // But keep short text for template building
  const nonEmptyChildren = analyzedChildren.filter(child => {
    if (child.type === 'text') {
      return child.cleanedText && child.cleanedText.length > 0;
    }
    if (child.type === 'expression') {
      return true; // Keep all expressions
    }
    return child.type === 'element'; // Keep nested elements for detection
  });

  // For "meaningful" text detection (determines hasAdjacentPattern), use minTextLength
  const meaningfulChildren = nonEmptyChildren.filter(child => {
    if (child.type === 'text') {
      return child.cleanedText && child.cleanedText.length >= minTextLength;
    }
    // Include static expressions as they count as text
    if (child.type === 'expression' && child.isStaticExpression) {
      return child.cleanedText && child.cleanedText.length >= minTextLength;
    }
    return child.type === 'expression';
  });

  // Check for adjacent pattern (mix of text/static expressions and dynamic expressions)
  const hasText = meaningfulChildren.some(c => 
    c.type === 'text' || (c.type === 'expression' && c.isStaticExpression)
  );
  const hasExpressions = meaningfulChildren.some(c => c.type === 'expression' && !c.isStaticExpression);
  const hasAdjacentPattern = hasText && hasExpressions;

  // Extract static text from meaningful children (for key generation).
  // Note: generateKey() will automatically clean structural punctuation via toKeySafeText()
  const staticTextParts = meaningfulChildren
    .filter(c => c.type === 'text' || c.isStaticExpression)
    .map(c => c.cleanedText || c.text || '')
    .filter(t => t.length > 0);
  const staticText = staticTextParts.join(' ').trim();

  // Extract expressions from meaningful children
  const expressions = meaningfulChildren
    .filter(c => c.type === 'expression' && !c.isStaticExpression)
    .map((c, index) => ({
      name: extractVariableName(c.expression || '', index),
      expression: c.expression || '',
      position: c.start,
    }));

  // Determine if we can interpolate - check ALL non-empty children for nested elements
  const { canInterpolate, reason } = checkCanInterpolate(nonEmptyChildren, expressions);

  // Build interpolation template if possible - use ALL non-empty children to include short text
  let interpolationTemplate: string | undefined;
  let localeValue: string | undefined;
  let replacement: string | undefined;

  if (canInterpolate && strategy === AdjacentStrategy.Interpolate && hasAdjacentPattern) {
    const result = buildInterpolationTemplate(nonEmptyChildren, expressions, format, translationFn, keyGenerator);
    interpolationTemplate = result.template;
    localeValue = result.localeValue;
    replacement = result.replacement;
  }

  return {
    hasAdjacentPattern,
    children: analyzedChildren,
    staticText,
    expressions,
    suggestedStrategy: determineSuggestedStrategy(hasAdjacentPattern, canInterpolate, strategy),
    canInterpolate,
    noInterpolateReason: reason,
    interpolationTemplate,
    localeValue,
    suggestedKey: staticText ? keyGenerator(staticText) : undefined,
    replacement,
  };
}

/**
 * Get children of a JSX element
 */
function getJsxChildren(element: JsxElement | JsxSelfClosingElement): Node[] {
  if (Node.isJsxSelfClosingElement(element)) {
    return [];
  }
  
  // JsxElement has children between opening and closing tags
  return element.getJsxChildren();
}

/**
 * Analyze a single JSX child node
 */
function analyzeChild(node: Node, trimWhitespace: boolean): JsxChild {
  const start = node.getStart();
  const end = node.getEnd();

  // JsxText
  if (Node.isJsxText(node)) {
    const text = node.getText();
    const cleanedText = trimWhitespace ? text.trim() : text;
    return {
      type: 'text',
      text,
      cleanedText,
      start,
      end,
      node,
    };
  }

  // JsxExpression
  if (Node.isJsxExpression(node)) {
    const expr = node.getExpression();
    const exprText = expr?.getText() || '';
    
    // Check if it's a static string expression like {'Hello'}
    const isStaticExpression = expr && (
      Node.isStringLiteral(expr) ||
      Node.isNoSubstitutionTemplateLiteral(expr)
    );

    let cleanedText: string | undefined;
    if (isStaticExpression && expr) {
      if (Node.isStringLiteral(expr)) {
        cleanedText = expr.getLiteralText();
      } else if (Node.isNoSubstitutionTemplateLiteral(expr)) {
        cleanedText = expr.getLiteralText();
      }
    }

    return {
      type: 'expression',
      expression: exprText,
      isStaticExpression,
      cleanedText,
      start,
      end,
      node,
    };
  }

  // JsxElement (nested)
  if (Node.isJsxElement(node) || Node.isJsxSelfClosingElement(node)) {
    return {
      type: 'element',
      start,
      end,
      node,
    };
  }

  return {
    type: 'other',
    start,
    end,
    node,
  };
}

/**
 * Extract a variable name from an expression
 */
function extractVariableName(expression: string, index: number): string {
  const trimmed = expression.trim();
  
  // Simple identifier
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed)) {
    return trimmed;
  }
  
  // Property access like user.name -> name
  const propertyMatch = trimmed.match(/\.([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (propertyMatch) {
    return propertyMatch[1];
  }
  
  // Array access like items[0] -> item
  const arrayMatch = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\[/);
  if (arrayMatch) {
    // Make it singular if it looks plural
    const name = arrayMatch[1];
    if (name.endsWith('s')) {
      return name.slice(0, -1);
    }
    return name + 'Item';
  }
  
  // Fallback to generic name
  return `var${index + 1}`;
}

/**
 * Check if the content can be interpolated
 */
function checkCanInterpolate(
  children: JsxChild[],
  expressions: Array<{ expression: string }>
): { canInterpolate: boolean; reason?: string } {
  // Check for nested elements
  if (children.some(c => c.type === 'element')) {
    return { canInterpolate: false, reason: 'contains-nested-elements' };
  }

  // Check for complex expressions that don't interpolate well
  for (const expr of expressions) {
    for (const pattern of COMPLEX_EXPRESSION_PATTERNS) {
      if (pattern.test(expr.expression)) {
        // Allow property access with dots
        if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(expr.expression.replace(/\s/g, ''))) {
          continue;
        }
        return { canInterpolate: false, reason: 'complex-expression' };
      }
    }
  }

  return { canInterpolate: true };
}

/**
 * Determine the suggested strategy
 */
function determineSuggestedStrategy(
  hasAdjacentPattern: boolean,
  canInterpolate: boolean,
  preferred: AdjacentStrategy
): AdjacentStrategy {
  if (!hasAdjacentPattern) {
    return AdjacentStrategy.TextOnly;
  }
  
  if (canInterpolate && preferred === AdjacentStrategy.Interpolate) {
    return AdjacentStrategy.Interpolate;
  }
  
  return AdjacentStrategy.Separate;
}

/**
 * Build the interpolation template
 */
function buildInterpolationTemplate(
  children: JsxChild[],
  expressions: Array<{ name: string; expression: string }>,
  format: 'i18next' | 'icu' | 'vue' | 'printf',
  translationFn: string,
  keyGenerator: (text: string) => string
): { template: string; localeValue: string; replacement: string } {
  const parts: string[] = [];
  const localeParts: string[] = [];
  let exprIndex = 0;

  for (const child of children) {
    if (child.type === 'text') {
      let text = child.cleanedText || child.text || '';
      if (!text) continue;

      // If this text contains an embedded SQL-like fragment, only keep the
      // prefix up to the SQL keyword for translation (e.g. "SQL-like: WHERE ...").
      const sqlMatch = text.match(/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ORDER\s+BY|GROUP\s+BY|CREATE|DROP|ALTER|TRUNCATE)\b/i);
      if (sqlMatch && sqlMatch.index !== undefined) {
        const matchedToken = text.substr(sqlMatch.index, sqlMatch[0].length);
        const looksLikeSql = matchedToken === matchedToken.toUpperCase() || /[=*'"()]/.test(text);
        if (looksLikeSql) {
          text = text.slice(0, sqlMatch.index).trimEnd();
        }
      }

      // Note: We intentionally keep structural punctuation in the locale value
      // for better translator context. The key generation via generateKey()
      // will automatically strip it via toKeySafeText().

      if (text) {
        parts.push(text);
        localeParts.push(text);
      }
    } else if (child.type === 'expression') {
      if (child.isStaticExpression) {
        const text = child.cleanedText || '';
        if (text) {
          parts.push(text);
          localeParts.push(text);
        }
      } else {
        const expr = expressions[exprIndex];
        if (expr) {
          parts.push(`{${expr.name}}`);
          localeParts.push(formatPlaceholder(expr.name, format));
          exprIndex++;
        }
      }
    }
  }

  // Join parts intelligently - don't add space before punctuation
  const joinParts = (arr: string[]): string => {
    if (arr.length === 0) return '';
    let result = arr[0];
    for (let i = 1; i < arr.length; i++) {
      const part = arr[i];
      // Don't add space before punctuation
      if (/^[.,!?;:)\]}'"]/.test(part)) {
        result += part;
      // Don't add space after opening brackets
      } else if (/[([{'""]$/.test(result)) {
        result += part;
      } else {
        result += ' ' + part;
      }
    }
    return result.replace(/\s+/g, ' ').trim();
  };

  // Join and strip structural punctuation adjacent to placeholders
  const template = stripAdjacentPunctuation(joinParts(parts));
  const localeValue = stripAdjacentPunctuation(joinParts(localeParts));
  const key = keyGenerator(template.replace(/\{[^}]+\}/g, '').trim());

  // Build replacement code
  let replacement: string;
  if (expressions.length > 0) {
    const varsObj = expressions.map(e => {
      if (e.name === e.expression) {
        return e.name;
      }
      return `${e.name}: ${e.expression}`;
    }).join(', ');
    replacement = `{${translationFn}('${key}', { ${varsObj} })}`;
  } else {
    replacement = `{${translationFn}('${key}')}`;
  }

  return { template, localeValue, replacement };
}

/**
 * Format a placeholder based on interpolation format
 */
function formatPlaceholder(name: string, format: 'i18next' | 'icu' | 'vue' | 'printf'): string {
  switch (format) {
    case 'i18next':
      return `{{${name}}}`;
    case 'icu':
    case 'vue':
      return `{${name}}`;
    case 'printf':
      return '%s';
    default:
      return `{{${name}}}`;
  }
}

/**
 * Create empty analysis result
 */
function createEmptyAnalysis(): AdjacentAnalysis {
  return {
    hasAdjacentPattern: false,
    children: [],
    staticText: '',
    expressions: [],
    suggestedStrategy: AdjacentStrategy.TextOnly,
    canInterpolate: false,
    noInterpolateReason: 'no-children',
  };
}

/**
 * Check if a JSX element contains adjacent text/expression patterns
 */
export function hasAdjacentTextExpression(element: JsxElement | JsxSelfClosingElement): boolean {
  const analysis = analyzeAdjacentContent(element);
  return analysis.hasAdjacentPattern;
}

/**
 * Get the combined static text from an element
 */
export function getCombinedStaticText(element: JsxElement | JsxSelfClosingElement): string {
  const analysis = analyzeAdjacentContent(element);
  return analysis.staticText;
}
