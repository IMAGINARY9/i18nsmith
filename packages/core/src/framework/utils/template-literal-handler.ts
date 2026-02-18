/**
 * Template Literal Handler
 *
 * Handles template literals in JSX expressions, converting them to translation calls
 * with proper interpolation support.
 */

import { Node } from 'ts-morph';
import { generateKey as sharedGenerateKey } from './text-filters.js';

/**
 * Interpolation format for generated locale values
 */
export enum InterpolationFormat {
  /** i18next format: {{name}} */
  I18next = 'i18next',
  /** ICU Message format: {name} */
  ICU = 'icu',
  /** Vue i18n format: {name} */
  Vue = 'vue',
  /** printf-style format: %s */
  Printf = 'printf',
}

/**
 * Variable for interpolation
 */
export interface TemplateVariable {
  /** Variable name to use in translation call */
  name: string;
  /** Original expression */
  expression: string;
}

/**
 * Options for template literal handling
 */
export interface TemplateLiteralOptions {
  /** Interpolation format for locale values */
  format?: InterpolationFormat;
  /** Translation function name (default: 't') */
  translationFn?: string;
  /** Custom key generator */
  keyGenerator?: (text: string) => string;
}

/**
 * Result of template literal handling
 */
export interface TemplateLiteralResult {
  /** Whether the template can be transformed */
  canTransform: boolean;
  /** Reason for skipping */
  skipReason?: string;
  /** Whether the template has expressions */
  hasExpressions?: boolean;
  /** Static value (for simple templates) */
  staticValue?: string;
  /** Interpolation template (for templates with expressions) */
  interpolationTemplate?: string;
  /** Variables for interpolation */
  variables?: TemplateVariable[];
  /** Suggested translation key */
  suggestedKey?: string;
  /** Generated locale value (with interpolation placeholders) */
  localeValue?: string;
  /** Generated replacement code */
  replacement?: string;
}

// Non-translatable patterns for templates
const JSON_PATTERN = /^\s*[[{][\s\S]*[\]}]\s*$/;
const CODE_PATTERN = /\b(const|let|var|function|return|if|else|for|while)\b/;
const URL_PATTERN = /^(https?:\/\/|mailto:|tel:|ftp:)/i;

/**
 * Handle a template literal expression in JSX
 */
export function handleTemplateLiteral(
  jsxExpr: Node,
  options: TemplateLiteralOptions = {}
): TemplateLiteralResult {
  const format = options.format || InterpolationFormat.I18next;
  const translationFn = options.translationFn || 't';
  const keyGen = options.keyGenerator || generateKey;

  // Get the inner expression from JsxExpression
  let expr = jsxExpr;
  if (Node.isJsxExpression(jsxExpr)) {
    const inner = jsxExpr.getExpression();
    if (!inner) {
      return { canTransform: false, skipReason: 'empty-expression' };
    }
    expr = inner;
  }

  // Handle no-substitution template literal (simple string)
  if (Node.isNoSubstitutionTemplateLiteral(expr)) {
    return handleSimpleTemplate(expr, keyGen, translationFn, format);
  }

  // Handle template expression (with ${})
  if (Node.isTemplateExpression(expr)) {
    return handleTemplateExpression(expr, keyGen, translationFn, format);
  }

  return { canTransform: false, skipReason: 'not-template-literal' };
}

function handleSimpleTemplate(
  node: Node,
  keyGen: (text: string) => string,
  translationFn: string,
  _format: InterpolationFormat
): TemplateLiteralResult {
  const text = Node.isNoSubstitutionTemplateLiteral(node) ? node.getLiteralText() : '';

  // Check for empty/whitespace
  if (!text || text.length === 0) {
    return { canTransform: false, skipReason: 'empty-template' };
  }

  if (text.trim().length === 0) {
    return { canTransform: false, skipReason: 'whitespace-only' };
  }

  // Check for non-translatable patterns
  const skipReason = checkNonTranslatablePattern(text);
  if (skipReason) {
    return { canTransform: false, skipReason };
  }

  const suggestedKey = keyGen(text);
  const replacement = `${translationFn}('${suggestedKey}')`;

  return {
    canTransform: true,
    hasExpressions: false,
    staticValue: text,
    suggestedKey,
    localeValue: text,
    replacement,
  };
}

function handleTemplateExpression(
  node: Node,
  keyGen: (text: string) => string,
  translationFn: string,
  format: InterpolationFormat
): TemplateLiteralResult {
  if (!Node.isTemplateExpression(node)) {
    return { canTransform: false, skipReason: 'not-template-expression' };
  }

  const head = node.getHead();
  const spans = node.getTemplateSpans();

  const staticParts: string[] = [head.getLiteralText()];
  const variables: TemplateVariable[] = [];

  for (const span of spans) {
    const expr = span.getExpression();
    const exprText = expr.getText();
    const literal = span.getLiteral();

    // Generate variable name
    const name = generateVariableName(expr);

    variables.push({
      name,
      expression: exprText,
    });

    staticParts.push(literal.getLiteralText());
  }

  // Check if any static content is non-translatable (e.g., URL template)
  const fullStaticContent = staticParts.join('');
  const skipReason = checkNonTranslatablePattern(fullStaticContent);
  if (skipReason) {
    return { canTransform: false, skipReason };
  }

  // Check for empty result
  const trimmedStatic = staticParts.map(s => s.trim()).join('');
  if (trimmedStatic.length === 0 && variables.length === 0) {
    return { canTransform: false, skipReason: 'empty-template' };
  }

  // Build interpolation template (uses {name} format for internal representation)
  const interpolationTemplate = buildInterpolationTemplate(staticParts, variables);

  // Build locale value (with proper format placeholders)
  const localeValue = buildLocaleValue(staticParts, variables, format);

  // Generate key from static parts
  const staticText = staticParts.join(' ').replace(/\s+/g, ' ').trim();
  const suggestedKey = keyGen(staticText || 'message');

  // Build replacement code
  const replacement = buildReplacement(suggestedKey, variables, translationFn);

  return {
    canTransform: true,
    hasExpressions: true,
    interpolationTemplate,
    variables,
    suggestedKey,
    localeValue,
    replacement,
  };
}

function generateVariableName(expr: Node): string {
  // Simple identifier - use as-is
  if (Node.isIdentifier(expr)) {
    return expr.getText();
  }

  // Property access - create camelCase name
  if (Node.isPropertyAccessExpression(expr)) {
    const name = expr.getName();
    const obj = expr.getExpression();
    if (Node.isIdentifier(obj)) {
      return camelCase(obj.getText() + '_' + name);
    }
    return camelCase(name);
  }

  // Element access - use object name with index hint
  if (Node.isElementAccessExpression(expr)) {
    const obj = expr.getExpression();
    if (Node.isIdentifier(obj)) {
      return obj.getText() + 'Item';
    }
  }

  // Call expression - use function name
  if (Node.isCallExpression(expr)) {
    const callee = expr.getExpression();
    if (Node.isIdentifier(callee)) {
      return callee.getText() + 'Result';
    }
    if (Node.isPropertyAccessExpression(callee)) {
      return camelCase(callee.getName() + '_result');
    }
  }

  // Default: use arg with index
  return 'arg0';
}

function buildInterpolationTemplate(staticParts: string[], variables: TemplateVariable[]): string {
  let result = staticParts[0];
  
  for (let i = 0; i < variables.length; i++) {
    result += `{${variables[i].name}}`;
    if (i + 1 < staticParts.length) {
      result += staticParts[i + 1];
    }
  }
  
  return result;
}

function buildLocaleValue(
  staticParts: string[],
  variables: TemplateVariable[],
  format: InterpolationFormat
): string {
  let result = staticParts[0];

  for (let i = 0; i < variables.length; i++) {
    const placeholder = formatPlaceholder(variables[i].name, format, i);
    result += placeholder;
    if (i + 1 < staticParts.length) {
      result += staticParts[i + 1];
    }
  }

  return result;
}

function formatPlaceholder(name: string, format: InterpolationFormat, _index: number): string {
  switch (format) {
    case InterpolationFormat.I18next:
      return `{{${name}}}`;
    case InterpolationFormat.ICU:
    case InterpolationFormat.Vue:
      return `{${name}}`;
    case InterpolationFormat.Printf:
      return '%s';
    default:
      return `{${name}}`;
  }
}

function buildReplacement(
  key: string,
  variables: TemplateVariable[],
  translationFn: string
): string {
  if (variables.length === 0) {
    return `${translationFn}('${key}')`;
  }

  const params = variables
    .map(v => {
      // If name equals expression, use shorthand
      if (v.name === v.expression) {
        return v.name;
      }
      return `${v.name}: ${v.expression}`;
    })
    .join(', ');

  return `${translationFn}('${key}', { ${params} })`;
}

function checkNonTranslatablePattern(text: string): string | null {
  if (JSON_PATTERN.test(text)) {
    return 'json-like-content';
  }
  if (CODE_PATTERN.test(text)) {
    return 'code-like-content';
  }
  if (URL_PATTERN.test(text)) {
    return 'url-template';
  }
  return null;
}

// Use the shared generateKey from text-filters which includes toKeySafeText cleanup
const generateKey = sharedGenerateKey;

function camelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^./, char => char.toLowerCase());
}
