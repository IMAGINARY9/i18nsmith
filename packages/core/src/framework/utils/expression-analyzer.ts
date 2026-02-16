/**
 * JSX Expression Analyzer
 *
 * Analyzes JSX expressions to understand their full context before transformation.
 * This enables smarter decisions about how to handle concatenation, template literals,
 * and mixed static/dynamic content.
 */

import { Node, SyntaxKind } from 'ts-morph';

/**
 * Types of expressions that can be found in JSX
 */
export enum ExpressionType {
  /** Empty expression: {} */
  Empty = 'empty',
  /** Simple string literal: {'Hello'} */
  SimpleString = 'simple-string',
  /** Simple template literal without expressions: {`Hello`} */
  SimpleTemplateLiteral = 'simple-template-literal',
  /** Static string concatenation: {'Hello' + 'World'} */
  StaticConcatenation = 'static-concatenation',
  /** Mixed static and dynamic concatenation: {'Hello ' + name} */
  MixedConcatenation = 'mixed-concatenation',
  /** Template literal with expressions: {`Hello ${name}`} */
  TemplateWithExpressions = 'template-with-expressions',
  /** Pure dynamic expression: {userName} */
  PureDynamic = 'pure-dynamic',
  /** Conditional with string branches: {active ? 'Yes' : 'No'} */
  ConditionalStrings = 'conditional-strings',
  /** Logical expression with string fallback: {value || 'Default'} */
  LogicalWithFallback = 'logical-with-fallback',
  /** Non-translatable content (JSON, SQL, etc.) */
  NonTranslatable = 'non-translatable',
}

/**
 * Information about a dynamic part in an expression
 */
export interface DynamicPart {
  /** Variable name if simple identifier */
  name?: string;
  /** Full expression text */
  expression: string;
  /** Whether this is a complex expression (not a simple identifier) */
  isComplex: boolean;
  /** Position in the original expression */
  position: number;
}

/**
 * Information about conditional branches
 */
export interface ConditionalPart {
  /** The static string value */
  value: string;
  /** Whether this is the 'true' branch */
  isTrueBranch: boolean;
}

/**
 * Suggestion for how to transform the expression
 */
export interface TransformSuggestion {
  /** Strategy to use */
  strategy: 'simple-replace' | 'merge-and-replace' | 'interpolation' | 'skip' | 'preserve' | 'conditional-keys';
  /** Generated translation key (if applicable) */
  translationKey?: string;
  /** Merged static value (for concatenation) */
  mergedValue?: string;
  /** Interpolation template (e.g., "Hello {name}!") */
  interpolationTemplate?: string;
  /** Variables needed for interpolation */
  variables?: Array<{ name: string; expression: string }>;
  /** Reason for skipping */
  skipReason?: string;
}

/**
 * Result of expression analysis
 */
export interface ExpressionAnalysis {
  /** Detected expression type */
  type: ExpressionType;
  /** Whether the expression has dynamic parts */
  hasDynamicParts: boolean;
  /** The static value (for simple strings or merged concatenation) */
  staticValue?: string;
  /** Whether static parts can be merged */
  canMerge?: boolean;
  /** Static string parts */
  staticParts?: string[];
  /** Dynamic parts information */
  dynamicParts?: DynamicPart[];
  /** Template literal parts (for template expressions) */
  templateParts?: string[];
  /** Pattern detected in mixed concatenation */
  pattern?: 'static-prefix' | 'dynamic-prefix' | 'sandwich' | 'interleaved';
  /** Whether the expression is extractable for translation */
  extractable: boolean;
  /** Reason for skipping (if non-translatable) */
  skipReason?: string;
  /** Conditional parts (for ternary expressions) */
  conditionalParts?: ConditionalPart[];
  /** Fallback value (for logical expressions) */
  fallbackValue?: string;
  /** Transformation suggestion */
  suggestion?: TransformSuggestion;
}

// Non-translatable pattern detectors
const JSON_PATTERN = /^\s*\{[\s\S]*"[\w-]+"[\s\S]*:[\s\S]*\}\s*$/;
const SQL_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ORDER\s+BY|GROUP\s+BY)\b/i;
const FORMAT_SPECIFIER_PATTERN = /^[%$]?[sdif](\s+[%$]?[sdif])*$/;
const PHONE_PATTERN = /^[+]?\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{1,4}[\s.-]?\d{1,9}$/;
const REGEX_PATTERN = /^\/.*\/[gimsuvy]*$/;
const I18N_CALL_PATTERN = /^(t|i18n|translate|\$t)\s*\(\s*['"`]/;

/**
 * Analyze a JSX expression to understand its structure and content
 */
export function analyzeJsxExpression(node: Node | undefined): ExpressionAnalysis {
  if (!node) {
    return createEmptyAnalysis();
  }

  // Handle JsxExpression wrapper - get inner expression
  if (Node.isJsxExpression(node)) {
    const innerExpr = node.getExpression();
    if (!innerExpr) {
      return createEmptyAnalysis();
    }
    return analyzeJsxExpression(innerExpr);
  }

  // String literal
  if (Node.isStringLiteral(node)) {
    return analyzeStringLiteral(node);
  }

  // No-substitution template literal
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    return analyzeSimpleTemplateLiteral(node);
  }

  // Template expression (with ${})
  if (Node.isTemplateExpression(node)) {
    return analyzeTemplateExpression(node);
  }

  // Binary expression (concatenation)
  if (Node.isBinaryExpression(node)) {
    const operator = node.getOperatorToken().getText();
    if (operator === '+') {
      return analyzeConcatenation(node);
    }
    if (operator === '||' || operator === '??') {
      return analyzeLogicalExpression(node);
    }
  }

  // Conditional expression (ternary)
  if (Node.isConditionalExpression(node)) {
    return analyzeConditionalExpression(node);
  }

  // Parenthesized expression - unwrap
  if (Node.isParenthesizedExpression(node)) {
    return analyzeJsxExpression(node.getExpression());
  }

  // Identifier (variable reference)
  if (Node.isIdentifier(node)) {
    return createPureDynamicAnalysis(node.getText());
  }

  // Property access expression
  if (Node.isPropertyAccessExpression(node)) {
    return createPureDynamicAnalysis(node.getText());
  }

  // Call expression
  if (Node.isCallExpression(node)) {
    return createPureDynamicAnalysis(node.getText());
  }

  // Element access expression
  if (Node.isElementAccessExpression(node)) {
    return createPureDynamicAnalysis(node.getText());
  }

  // Numeric literal
  if (Node.isNumericLiteral(node)) {
    return createNonTranslatableAnalysis('numeric-literal');
  }

  // Boolean literal or keywords
  if (node.getKind() === SyntaxKind.TrueKeyword ||
      node.getKind() === SyntaxKind.FalseKeyword) {
    return createNonTranslatableAnalysis('boolean-literal');
  }

  // Null/undefined
  if (node.getKind() === SyntaxKind.NullKeyword ||
      node.getKind() === SyntaxKind.UndefinedKeyword) {
    return createNonTranslatableAnalysis('null-undefined');
  }

  // Default: pure dynamic
  return createPureDynamicAnalysis(node.getText());
}

function createEmptyAnalysis(): ExpressionAnalysis {
  return {
    type: ExpressionType.Empty,
    hasDynamicParts: false,
    extractable: false,
  };
}

function analyzeStringLiteral(node: Node): ExpressionAnalysis {
  const text = Node.isStringLiteral(node) ? node.getLiteralText() : '';
  
  // Check for non-translatable patterns
  const nonTranslatable = checkNonTranslatablePatterns(text);
  if (nonTranslatable) {
    return createNonTranslatableAnalysis(nonTranslatable, text);
  }

  return {
    type: ExpressionType.SimpleString,
    hasDynamicParts: false,
    staticValue: text,
    extractable: true,
    suggestion: {
      strategy: 'simple-replace',
      translationKey: generateSuggestedKey(text),
    },
  };
}

function analyzeSimpleTemplateLiteral(node: Node): ExpressionAnalysis {
  const text = Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : '';
  
  // Check for non-translatable patterns
  const nonTranslatable = checkNonTranslatablePatterns(text);
  if (nonTranslatable) {
    return createNonTranslatableAnalysis(nonTranslatable, text);
  }

  return {
    type: ExpressionType.SimpleTemplateLiteral,
    hasDynamicParts: false,
    staticValue: text,
    extractable: true,
    suggestion: {
      strategy: 'simple-replace',
      translationKey: generateSuggestedKey(text),
    },
  };
}

function analyzeTemplateExpression(node: Node): ExpressionAnalysis {
  if (!Node.isTemplateExpression(node)) {
    return createEmptyAnalysis();
  }

  const head = node.getHead();
  const spans = node.getTemplateSpans();
  
  const templateParts: string[] = [head.getLiteralText()];
  const dynamicParts: DynamicPart[] = [];
  
  let position = 0;
  for (const span of spans) {
    const expr = span.getExpression();
    const exprText = expr.getText();
    const literal = span.getLiteral();
    
    // Determine variable name
    const name = Node.isIdentifier(expr) ? exprText : undefined;
    const isComplex = !Node.isIdentifier(expr);
    
    dynamicParts.push({
      name,
      expression: exprText,
      isComplex,
      position: position++,
    });
    
    templateParts.push(literal.getLiteralText());
  }

  // Build interpolation template
  const interpolationTemplate = buildInterpolationTemplate(templateParts, dynamicParts);

  return {
    type: ExpressionType.TemplateWithExpressions,
    hasDynamicParts: true,
    templateParts,
    dynamicParts,
    extractable: true,
    suggestion: {
      strategy: 'interpolation',
      interpolationTemplate,
      variables: dynamicParts.map(dp => ({
        name: dp.name || `var${dp.position}`,
        expression: dp.expression,
      })),
    },
  };
}

function analyzeConcatenation(node: Node): ExpressionAnalysis {
  if (!Node.isBinaryExpression(node)) {
    return createEmptyAnalysis();
  }

  const parts = flattenConcatenation(node);
  const staticParts: string[] = [];
  const dynamicParts: DynamicPart[] = [];
  let isAllStatic = true;
  let position = 0;

  for (const part of parts) {
    if (Node.isStringLiteral(part) || Node.isNoSubstitutionTemplateLiteral(part)) {
      const text = Node.isStringLiteral(part) 
        ? part.getLiteralText() 
        : part.getLiteralText();
      staticParts.push(text);
    } else {
      isAllStatic = false;
      const exprText = part.getText();
      const name = Node.isIdentifier(part) ? exprText : undefined;
      
      dynamicParts.push({
        name,
        expression: exprText,
        isComplex: !Node.isIdentifier(part),
        position: position++,
      });
      staticParts.push(''); // Placeholder for dynamic position
    }
  }

  if (isAllStatic) {
    const mergedValue = staticParts.join('');
    
    // Check for non-translatable patterns
    const nonTranslatable = checkNonTranslatablePatterns(mergedValue);
    if (nonTranslatable) {
      return createNonTranslatableAnalysis(nonTranslatable, mergedValue);
    }

    return {
      type: ExpressionType.StaticConcatenation,
      hasDynamicParts: false,
      staticValue: mergedValue,
      canMerge: true,
      extractable: true,
      suggestion: {
        strategy: 'merge-and-replace',
        mergedValue,
        translationKey: generateSuggestedKey(mergedValue),
      },
    };
  }

  // Determine the pattern
  const pattern = determineConcatenationPattern(parts);
  
  // Build interpolation template
  const interpolationTemplate = buildInterpolationTemplateFromParts(parts);

  return {
    type: ExpressionType.MixedConcatenation,
    hasDynamicParts: true,
    staticParts: staticParts.filter(s => s !== ''),
    dynamicParts,
    pattern,
    extractable: true,
    suggestion: {
      strategy: 'interpolation',
      interpolationTemplate,
      variables: dynamicParts.map(dp => ({
        name: dp.name || `var${dp.position}`,
        expression: dp.expression,
      })),
    },
  };
}

function analyzeLogicalExpression(node: Node): ExpressionAnalysis {
  if (!Node.isBinaryExpression(node)) {
    return createEmptyAnalysis();
  }

  const right = node.getRight();
  
  if (Node.isStringLiteral(right)) {
    const fallbackValue = right.getLiteralText();
    return {
      type: ExpressionType.LogicalWithFallback,
      hasDynamicParts: true,
      fallbackValue,
      extractable: true,
      suggestion: {
        strategy: 'interpolation',
        interpolationTemplate: `{value} || ${fallbackValue}`,
      },
    };
  }

  return createPureDynamicAnalysis(node.getText());
}

function analyzeConditionalExpression(node: Node): ExpressionAnalysis {
  if (!Node.isConditionalExpression(node)) {
    return createEmptyAnalysis();
  }

  const whenTrue = node.getWhenTrue();
  const whenFalse = node.getWhenFalse();

  const conditionalParts: ConditionalPart[] = [];
  let hasStringBranches = false;

  if (Node.isStringLiteral(whenTrue)) {
    conditionalParts.push({
      value: whenTrue.getLiteralText(),
      isTrueBranch: true,
    });
    hasStringBranches = true;
  }

  if (Node.isStringLiteral(whenFalse)) {
    conditionalParts.push({
      value: whenFalse.getLiteralText(),
      isTrueBranch: false,
    });
    hasStringBranches = true;
  }

  if (hasStringBranches && conditionalParts.length === 2) {
    return {
      type: ExpressionType.ConditionalStrings,
      hasDynamicParts: true,
      conditionalParts,
      extractable: true,
      suggestion: {
        strategy: 'conditional-keys',
      },
    };
  }

  return createPureDynamicAnalysis(node.getText());
}

function createPureDynamicAnalysis(_expression: string): ExpressionAnalysis {
  return {
    type: ExpressionType.PureDynamic,
    hasDynamicParts: true,
    extractable: false,
    suggestion: {
      strategy: 'preserve',
    },
  };
}

function createNonTranslatableAnalysis(reason: string, value?: string): ExpressionAnalysis {
  return {
    type: ExpressionType.NonTranslatable,
    hasDynamicParts: false,
    staticValue: value,
    extractable: false,
    skipReason: reason,
    suggestion: {
      strategy: 'skip',
      skipReason: reason,
    },
  };
}

function checkNonTranslatablePatterns(text: string): string | null {
  if (JSON_PATTERN.test(text)) {
    return 'json-like-string';
  }
  if (SQL_PATTERN.test(text)) {
    return 'sql-like-string';
  }
  if (FORMAT_SPECIFIER_PATTERN.test(text.trim())) {
    return 'format-specifiers';
  }
  if (PHONE_PATTERN.test(text.trim())) {
    return 'phone-number';
  }
  if (REGEX_PATTERN.test(text.trim())) {
    return 'regex-pattern';
  }
  if (I18N_CALL_PATTERN.test(text.trim())) {
    return 'i18n-call-pattern';
  }
  return null;
}

function flattenConcatenation(node: Node): Node[] {
  const parts: Node[] = [];
  
  function traverse(n: Node) {
    if (Node.isBinaryExpression(n) && n.getOperatorToken().getText() === '+') {
      traverse(n.getLeft());
      traverse(n.getRight());
    } else if (Node.isParenthesizedExpression(n)) {
      traverse(n.getExpression());
    } else {
      parts.push(n);
    }
  }
  
  traverse(node);
  return parts;
}

function determineConcatenationPattern(parts: Node[]): 'static-prefix' | 'dynamic-prefix' | 'sandwich' | 'interleaved' {
  const isStatic = (n: Node) => Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n);
  
  const firstIsStatic = isStatic(parts[0]);
  const lastIsStatic = isStatic(parts[parts.length - 1]);
  
  // Count transitions between static and dynamic
  let transitions = 0;
  for (let i = 1; i < parts.length; i++) {
    if (isStatic(parts[i]) !== isStatic(parts[i - 1])) {
      transitions++;
    }
  }

  if (transitions <= 1) {
    if (firstIsStatic) {
      return 'static-prefix';
    }
    return 'dynamic-prefix';
  }
  
  if (transitions === 2 && firstIsStatic && lastIsStatic) {
    return 'sandwich';
  }
  
  return 'interleaved';
}

function buildInterpolationTemplate(templateParts: string[], dynamicParts: DynamicPart[]): string {
  let result = templateParts[0];
  for (let i = 0; i < dynamicParts.length; i++) {
    const varName = dynamicParts[i].name || `var${i}`;
    result += `{${varName}}`;
    if (i + 1 < templateParts.length) {
      result += templateParts[i + 1];
    }
  }
  return result;
}

function buildInterpolationTemplateFromParts(parts: Node[]): string {
  let result = '';
  let varIndex = 0;
  
  for (const part of parts) {
    if (Node.isStringLiteral(part)) {
      result += part.getLiteralText();
    } else if (Node.isNoSubstitutionTemplateLiteral(part)) {
      result += part.getLiteralText();
    } else {
      const varName = Node.isIdentifier(part) ? part.getText() : `var${varIndex++}`;
      result += `{${varName}}`;
    }
  }
  
  return result;
}

function generateSuggestedKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}
