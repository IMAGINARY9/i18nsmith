/**
 * Expression Analysis Tests
 *
 * Tests for JSX expression analysis utilities that understand the full context
 * of JSX expressions before transformation.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeJsxExpression,
  ExpressionType,
  ExpressionAnalysis,
} from '../utils/expression-analyzer.js';
import { Project, SyntaxKind } from 'ts-morph';

function createTestProject() {
  return new Project({ skipAddingFilesFromTsConfig: true });
}

function getJsxExpression(code: string) {
  const project = createTestProject();
  const file = project.createSourceFile('test.tsx', code, { overwrite: true });
  return file.getFirstDescendantByKind(SyntaxKind.JsxExpression);
}

function getJsxExpressionInner(code: string) {
  const expr = getJsxExpression(code);
  return expr?.getExpression();
}

describe('Expression Analyzer', () => {
  describe('ExpressionType Detection', () => {
    describe('Simple String Literals', () => {
      it('should detect single string literal with single quotes', () => {
        const code = `<p>{'Hello World'}</p>`;
        const expr = getJsxExpressionInner(code);
        expect(expr).toBeDefined();

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.SimpleString);
        expect(analysis.staticValue).toBe('Hello World');
        expect(analysis.hasDynamicParts).toBe(false);
      });

      it('should detect single string literal with double quotes', () => {
        const code = `<p>{"Hello World"}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.SimpleString);
        expect(analysis.staticValue).toBe('Hello World');
      });
    });

    describe('String Concatenation', () => {
      it('should detect pure static string concatenation', () => {
        const code = `<p>{'Hello, ' + 'world!'}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.StaticConcatenation);
        expect(analysis.staticValue).toBe('Hello, world!');
        expect(analysis.hasDynamicParts).toBe(false);
        expect(analysis.canMerge).toBe(true);
      });

      it('should detect multi-part static concatenation', () => {
        const code = `<p>{'a' + 'b' + 'c'}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.StaticConcatenation);
        expect(analysis.staticValue).toBe('abc');
      });

      it('should detect mixed static + dynamic concatenation', () => {
        const code = `<p>{'Hello ' + name}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.MixedConcatenation);
        expect(analysis.hasDynamicParts).toBe(true);
        expect(analysis.staticParts).toEqual(['Hello ']);
        expect(analysis.dynamicParts).toHaveLength(1);
        expect(analysis.dynamicParts![0].name).toBe('name');
      });

      it('should detect static prefix with dynamic suffix', () => {
        const code = `<p>{'Count: ' + count}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.MixedConcatenation);
        expect(analysis.pattern).toBe('static-prefix');
        expect(analysis.staticParts).toContain('Count: ');
      });

      it('should detect dynamic prefix with static suffix', () => {
        const code = `<p>{count + ' items'}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.MixedConcatenation);
        expect(analysis.pattern).toBe('dynamic-prefix');
        expect(analysis.staticParts).toContain(' items');
      });

      it('should detect sandwich pattern (static-dynamic-static)', () => {
        const code = `<p>{'Hello ' + name + '!'}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.MixedConcatenation);
        expect(analysis.pattern).toBe('sandwich');
        expect(analysis.staticParts).toEqual(['Hello ', '!']);
        expect(analysis.dynamicParts).toHaveLength(1);
      });

      it('should detect complex interleaved pattern', () => {
        const code = `<p>{'Hello ' + name + ', you have ' + count + ' messages'}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.MixedConcatenation);
        expect(analysis.pattern).toBe('interleaved');
        expect(analysis.dynamicParts).toHaveLength(2);
      });
    });

    describe('Template Literals', () => {
      it('should detect simple template literal (no expressions)', () => {
        const code = '<p>{`Hello World`}</p>';
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.SimpleTemplateLiteral);
        expect(analysis.staticValue).toBe('Hello World');
        expect(analysis.hasDynamicParts).toBe(false);
      });

      it('should detect template literal with single expression', () => {
        const code = '<p>{`Hello ${name}!`}</p>';
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.TemplateWithExpressions);
        expect(analysis.hasDynamicParts).toBe(true);
        expect(analysis.templateParts).toEqual(['Hello ', '!']);
        expect(analysis.dynamicParts).toHaveLength(1);
        expect(analysis.dynamicParts![0].name).toBe('name');
      });

      it('should detect template literal with multiple expressions', () => {
        const code = '<p>{`${greeting}, ${name}!`}</p>';
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.TemplateWithExpressions);
        expect(analysis.templateParts).toEqual(['', ', ', '!']);
        expect(analysis.dynamicParts).toHaveLength(2);
      });

      it('should detect template literal with complex expression', () => {
        const code = '<p>{`Count: ${items.length}`}</p>';
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.TemplateWithExpressions);
        expect(analysis.dynamicParts![0].expression).toBe('items.length');
        expect(analysis.dynamicParts![0].isComplex).toBe(true);
      });

      it('should detect template literal with function call', () => {
        const code = '<p>{`Items: ${items.join(", ")}`}</p>';
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.TemplateWithExpressions);
        expect(analysis.dynamicParts![0].isComplex).toBe(true);
      });
    });

    describe('Pure Dynamic Expressions', () => {
      it('should detect simple variable reference', () => {
        const code = `<p>{userName}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.PureDynamic);
        expect(analysis.hasDynamicParts).toBe(true);
        expect(analysis.extractable).toBe(false);
      });

      it('should detect property access', () => {
        const code = `<p>{user.name}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.PureDynamic);
      });

      it('should detect function call', () => {
        const code = `<p>{formatDate(date)}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.PureDynamic);
      });

      it('should detect array method call', () => {
        const code = `<p>{items.join(', ')}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.PureDynamic);
      });
    });

    describe('Non-Translatable Patterns', () => {
      it('should detect JSON-like strings', () => {
        // Need to use single quotes with escape sequences
        const code = '<p>{"{\\"key\\": \\"value\\"}"}</p>';
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
        expect(analysis.skipReason).toBe('json-like-string');
      });

      it('should detect SQL-like strings', () => {
        const code = `<p>{"SELECT * FROM users WHERE id = 1"}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
        expect(analysis.skipReason).toBe('sql-like-string');
      });

      it('should detect format specifier strings', () => {
        const code = `<p>{"%s %d %f"}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
        expect(analysis.skipReason).toBe('format-specifiers');
      });

      it('should detect phone number patterns', () => {
        const code = `<p>{"+1 (555) 123-4567"}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
        expect(analysis.skipReason).toBe('phone-number');
      });

      it('should detect regex-like patterns', () => {
        const code = `<p>{"/[a-z]+/g"}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
        expect(analysis.skipReason).toBe('regex-pattern');
      });

      it('should detect i18n-call-like strings', () => {
        const code = `<p>{"t('greeting')"}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
        expect(analysis.skipReason).toBe('i18n-call-pattern');
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty expression', () => {
        const code = `<p>{}</p>`;
        const expr = getJsxExpression(code);

        const analysis = analyzeJsxExpression(expr!.getExpression()!);
        expect(analysis.type).toBe(ExpressionType.Empty);
      });

      it('should handle numeric literals', () => {
        const code = `<p>{42}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
      });

      it('should handle boolean literals', () => {
        const code = `<p>{true}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
      });

      it('should handle null/undefined', () => {
        const code = `<p>{null}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.NonTranslatable);
      });

      it('should handle conditional expressions with strings', () => {
        const code = `<p>{isActive ? 'Active' : 'Inactive'}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.ConditionalStrings);
        expect(analysis.conditionalParts).toHaveLength(2);
        expect(analysis.conditionalParts![0].value).toBe('Active');
        expect(analysis.conditionalParts![1].value).toBe('Inactive');
      });

      it('should handle logical OR with string fallback', () => {
        const code = `<p>{value || 'Default'}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.LogicalWithFallback);
        expect(analysis.fallbackValue).toBe('Default');
      });

      it('should handle nested concatenation', () => {
        const code = `<p>{('a' + 'b') + ('c' + 'd')}</p>`;
        const expr = getJsxExpressionInner(code);

        const analysis = analyzeJsxExpression(expr!);
        expect(analysis.type).toBe(ExpressionType.StaticConcatenation);
        expect(analysis.staticValue).toBe('abcd');
      });
    });
  });

  describe('Transformation Suggestions', () => {
    it('should suggest simple replacement for static string', () => {
      const code = `<p>{'Hello World'}</p>`;
      const expr = getJsxExpressionInner(code);

      const analysis = analyzeJsxExpression(expr!);
      expect(analysis.suggestion?.strategy).toBe('simple-replace');
      expect(analysis.suggestion?.translationKey).toBeDefined();
    });

    it('should suggest merged replacement for static concatenation', () => {
      const code = `<p>{'Hello, ' + 'world!'}</p>`;
      const expr = getJsxExpressionInner(code);

      const analysis = analyzeJsxExpression(expr!);
      expect(analysis.suggestion?.strategy).toBe('merge-and-replace');
      expect(analysis.suggestion?.mergedValue).toBe('Hello, world!');
    });

    it('should suggest interpolation for mixed concatenation', () => {
      const code = `<p>{'Hello ' + name + '!'}</p>`;
      const expr = getJsxExpressionInner(code);

      const analysis = analyzeJsxExpression(expr!);
      expect(analysis.suggestion?.strategy).toBe('interpolation');
      expect(analysis.suggestion?.interpolationTemplate).toBe('Hello {name}!');
      expect(analysis.suggestion?.variables).toEqual([{ name: 'name', expression: 'name' }]);
    });

    it('should suggest interpolation for template literal with expressions', () => {
      const code = '<p>{`Hello ${name}!`}</p>';
      const expr = getJsxExpressionInner(code);

      const analysis = analyzeJsxExpression(expr!);
      expect(analysis.suggestion?.strategy).toBe('interpolation');
      expect(analysis.suggestion?.interpolationTemplate).toBe('Hello {name}!');
    });

    it('should suggest skip for non-translatable patterns', () => {
      const code = '<p>{"{\\"key\\": \\"value\\"}"}</p>';
      const expr = getJsxExpressionInner(code);

      const analysis = analyzeJsxExpression(expr!);
      expect(analysis.suggestion?.strategy).toBe('skip');
      expect(analysis.suggestion?.skipReason).toBe('json-like-string');
    });

    it('should suggest preserve for pure dynamic expressions', () => {
      const code = `<p>{userName}</p>`;
      const expr = getJsxExpressionInner(code);

      const analysis = analyzeJsxExpression(expr!);
      expect(analysis.suggestion?.strategy).toBe('preserve');
    });
  });
});
