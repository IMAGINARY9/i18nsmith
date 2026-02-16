/**
 * String Concatenation Merger
 *
 * Handles merging of string concatenation expressions in JSX.
 * Transforms patterns like {'Hello, ' + 'world!'} into single translations.
 */

import { Node } from 'ts-morph';
import { analyzeJsxExpression, ExpressionType, DynamicPart } from './expression-analyzer.js';

/**
 * Strategy for handling string concatenation
 */
export enum MergeStrategy {
  /** Merge all static parts into a single translation key */
  FullMerge = 'full-merge',
  /** Create interpolation template with variables */
  Interpolation = 'interpolation',
  /** Keep parts separate (static translated, dynamic preserved) */
  Separate = 'separate',
}

/**
 * A part of the separated expression
 */
export interface SeparatePart {
  type: 'static' | 'dynamic';
  value: string;
  replacement: string;
}

/**
 * Variable for interpolation
 */
export interface InterpolationVariable {
  name: string;
  expression: string;
}

/**
 * Options for merging
 */
export interface MergeOptions {
  /** Prefer separate strategy over interpolation */
  preferSeparate?: boolean;
  /** Custom key generator function */
  keyGenerator?: (text: string) => string;
  /** Translation function name (default: 't') */
  translationFn?: string;
}

/**
 * Result of the merge operation
 */
export interface MergeResult {
  /** Whether the expression can be merged */
  canMerge: boolean;
  /** Reason if cannot merge */
  reason?: string;
  /** Strategy used for merging */
  strategy?: MergeStrategy;
  /** Merged static value (for FullMerge strategy) */
  mergedValue?: string;
  /** Interpolation template (for Interpolation strategy) */
  interpolationTemplate?: string;
  /** Variables for interpolation */
  variables?: InterpolationVariable[];
  /** Separate parts (for Separate strategy) */
  separateParts?: SeparatePart[];
  /** Full replacement code */
  replacement?: string;
  /** Full replacement for separate strategy */
  fullReplacement?: string;
  /** Suggested translation key */
  suggestedKey?: string;
}

/**
 * Merge string concatenation expressions in JSX
 */
export function mergeStringConcatenation(
  jsxExpr: Node,
  options: MergeOptions = {}
): MergeResult {
  const translationFn = options.translationFn || 't';
  const keyGen = options.keyGenerator || generateKey;

  // Get the inner expression from JsxExpression
  let expr = jsxExpr;
  if (Node.isJsxExpression(jsxExpr)) {
    const inner = jsxExpr.getExpression();
    if (!inner) {
      return { canMerge: false, reason: 'empty-expression' };
    }
    expr = inner;
  }

  // Analyze the expression first
  const analysis = analyzeJsxExpression(expr);

  // Handle based on expression type
  switch (analysis.type) {
    case ExpressionType.SimpleString:
    case ExpressionType.SimpleTemplateLiteral:
      return { canMerge: false, reason: 'not-concatenation' };

    case ExpressionType.TemplateWithExpressions:
      return { canMerge: false, reason: 'template-literal' };

    case ExpressionType.PureDynamic:
      return { canMerge: false, reason: 'pure-dynamic' };

    case ExpressionType.NonTranslatable:
      return { canMerge: false, reason: 'non-translatable' };

    case ExpressionType.StaticConcatenation:
      return handleStaticConcatenation(analysis.staticValue!, keyGen, translationFn);

    case ExpressionType.MixedConcatenation:
      return handleMixedConcatenation(
        analysis,
        keyGen,
        translationFn,
        options.preferSeparate
      );

    default:
      return { canMerge: false, reason: 'unsupported-expression' };
  }
}

function handleStaticConcatenation(
  mergedValue: string,
  keyGen: (text: string) => string,
  translationFn: string
): MergeResult {
  const suggestedKey = keyGen(mergedValue);
  const replacement = `${translationFn}('${suggestedKey}')`;

  return {
    canMerge: true,
    strategy: MergeStrategy.FullMerge,
    mergedValue,
    suggestedKey,
    replacement,
  };
}

function handleMixedConcatenation(
  analysis: ReturnType<typeof analyzeJsxExpression>,
  keyGen: (text: string) => string,
  translationFn: string,
  preferSeparate?: boolean
): MergeResult {
  const staticParts = analysis.staticParts || [];
  const dynamicParts = analysis.dynamicParts || [];

  if (preferSeparate) {
    return handleSeparateStrategy(staticParts, dynamicParts, keyGen, translationFn);
  }

  return handleInterpolationStrategy(staticParts, dynamicParts, keyGen, translationFn, analysis);
}

function handleInterpolationStrategy(
  staticParts: string[],
  dynamicParts: DynamicPart[],
  keyGen: (text: string) => string,
  translationFn: string,
  analysis: ReturnType<typeof analyzeJsxExpression>
): MergeResult {
  // Build interpolation template from the analysis suggestion or reconstruct it
  let interpolationTemplate = analysis.suggestion?.interpolationTemplate;
  
  if (!interpolationTemplate) {
    // Reconstruct from parts
    interpolationTemplate = buildInterpolationTemplate(staticParts, dynamicParts);
  }

  const variables: InterpolationVariable[] = dynamicParts.map((dp, index) => ({
    name: dp.name || `arg${index}`,
    expression: dp.expression,
  }));

  // Generate key from static parts
  const staticText = staticParts.join(' ').trim();
  const suggestedKey = keyGen(staticText || 'message');

  // Build the replacement t() call
  const paramsObj = variables
    .map(v => v.name === v.expression ? v.name : `${v.name}: ${v.expression}`)
    .join(', ');
  const replacement = `${translationFn}('${suggestedKey}', { ${paramsObj} })`;

  return {
    canMerge: true,
    strategy: MergeStrategy.Interpolation,
    interpolationTemplate,
    variables,
    suggestedKey,
    replacement,
  };
}

function handleSeparateStrategy(
  staticParts: string[],
  dynamicParts: DynamicPart[],
  keyGen: (text: string) => string,
  translationFn: string
): MergeResult {
  const separateParts: SeparatePart[] = [];
  const replacementParts: string[] = [];

  // Rebuild the expression structure
  // This is simplified - in reality we'd need to track the original order
  let dynamicIndex = 0;

  // Interleave static and dynamic parts based on the original order
  // For now, assume static-dynamic-static... pattern
  for (const staticPart of staticParts) {
    if (staticPart && staticPart.trim()) {
      const key = keyGen(staticPart);
      const replacement = `${translationFn}('${key}')`;
      separateParts.push({
        type: 'static',
        value: staticPart,
        replacement,
      });
      replacementParts.push(`{${replacement}}`);
    }

    if (dynamicIndex < dynamicParts.length) {
      const dp = dynamicParts[dynamicIndex++];
      separateParts.push({
        type: 'dynamic',
        value: dp.expression,
        replacement: `{${dp.expression}}`,
      });
      replacementParts.push(`{${dp.expression}}`);
    }
  }

  // Add remaining dynamic parts
  while (dynamicIndex < dynamicParts.length) {
    const dp = dynamicParts[dynamicIndex++];
    separateParts.push({
      type: 'dynamic',
      value: dp.expression,
      replacement: `{${dp.expression}}`,
    });
    replacementParts.push(`{${dp.expression}}`);
  }

  return {
    canMerge: true,
    strategy: MergeStrategy.Separate,
    separateParts,
    fullReplacement: replacementParts.join(''),
  };
}

function buildInterpolationTemplate(staticParts: string[], dynamicParts: DynamicPart[]): string {
  let result = '';
  
  // Interleave static and dynamic parts
  for (let i = 0; i < Math.max(staticParts.length, dynamicParts.length); i++) {
    if (i < staticParts.length && staticParts[i]) {
      result += staticParts[i];
    }
    if (i < dynamicParts.length) {
      const varName = dynamicParts[i].name || `arg${i}`;
      result += `{${varName}}`;
    }
  }

  return result;
}

function generateKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50);
}
