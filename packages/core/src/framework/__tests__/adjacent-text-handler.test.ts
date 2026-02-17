/**
 * Adjacent Text Handler Tests
 */

import { describe, it, expect } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import {
  analyzeAdjacentContent,
  AdjacentStrategy,
  hasAdjacentTextExpression,
  getCombinedStaticText,
} from '../utils/adjacent-text-handler.js';

function getJsxElement(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('test.tsx', code);
  
  // Find the first JSX element
  const jsxElement = sourceFile.getFirstDescendantByKind(SyntaxKind.JsxElement);
  if (jsxElement) return jsxElement;
  
  return sourceFile.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement);
}

describe('Adjacent Text Handler', () => {
  describe('analyzeAdjacentContent', () => {
    describe('Text Only Patterns', () => {
      it('should handle element with only text', () => {
        const element = getJsxElement('<p>Hello World</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(false);
        expect(result.staticText).toBe('Hello World');
        expect(result.expressions).toHaveLength(0);
        expect(result.suggestedStrategy).toBe(AdjacentStrategy.TextOnly);
      });

      it('should handle element with static string expression', () => {
        const element = getJsxElement('<p>{"Hello World"}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(false);
        expect(result.staticText).toBe('Hello World');
        expect(result.expressions).toHaveLength(0);
      });
    });

    describe('Expression Only Patterns', () => {
      it('should handle element with only expression', () => {
        const element = getJsxElement('<p>{userName}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(false);
        expect(result.staticText).toBe('');
        expect(result.expressions).toHaveLength(1);
        expect(result.expressions[0].name).toBe('userName');
      });
    });

    describe('Adjacent Text + Expression Patterns', () => {
      it('should detect text before expression: "User name: {userName}"', () => {
        const element = getJsxElement('<p>User name: {userName}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(true);
        expect(result.staticText).toBe('User name:');
        expect(result.expressions).toHaveLength(1);
        expect(result.expressions[0].name).toBe('userName');
        expect(result.canInterpolate).toBe(true);
      });

      it('should detect expression before text: "{count} items remaining"', () => {
        const element = getJsxElement('<p>{count} items remaining</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(true);
        expect(result.staticText).toBe('items remaining');
        expect(result.expressions).toHaveLength(1);
        expect(result.expressions[0].name).toBe('count');
        expect(result.canInterpolate).toBe(true);
      });

      it('should handle multiple interleaved text and expressions', () => {
        const element = getJsxElement('<p>Hello {name}, you have {count} messages</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(true);
        expect(result.expressions).toHaveLength(2);
        expect(result.expressions[0].name).toBe('name');
        expect(result.expressions[1].name).toBe('count');
        expect(result.canInterpolate).toBe(true);
      });

      it('should handle expression at start and end', () => {
        const element = getJsxElement('<p>{greeting}, welcome to {appName}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(true);
        expect(result.expressions).toHaveLength(2);
        expect(result.expressions[0].name).toBe('greeting');
        expect(result.expressions[1].name).toBe('appName');
      });
    });

    describe('Property Access Expressions', () => {
      it('should extract name from property access: user.name', () => {
        const element = getJsxElement('<p>Name: {user.name}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(true);
        expect(result.expressions[0].name).toBe('name');
        expect(result.expressions[0].expression).toBe('user.name');
        expect(result.canInterpolate).toBe(true);
      });

      it('should handle deep property access: data.user.profile.name', () => {
        const element = getJsxElement('<p>Profile: {data.user.profile.name}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.expressions[0].name).toBe('name');
        expect(result.canInterpolate).toBe(true);
      });
    });

    describe('Array Access Expressions', () => {
      it('should extract name from array access: items[0]', () => {
        const element = getJsxElement('<p>First: {items[0]}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.expressions[0].name).toBe('item');
      });

      it('should handle array access with variable index', () => {
        const element = getJsxElement('<p>Selected: {users[selectedIndex]}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.expressions[0].name).toBe('user');
      });
    });

    describe('Complex Expression Detection', () => {
      it('should detect function calls as non-interpolatable', () => {
        const element = getJsxElement('<p>Result: {formatDate(date)}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.hasAdjacentPattern).toBe(true);
        expect(result.canInterpolate).toBe(false);
        expect(result.noInterpolateReason).toBe('complex-expression');
      });

      it('should detect ternary as non-interpolatable', () => {
        const element = getJsxElement('<p>Status: {isActive ? "Active" : "Inactive"}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.canInterpolate).toBe(false);
        expect(result.noInterpolateReason).toBe('complex-expression');
      });

      it('should detect logical operators as non-interpolatable', () => {
        const element = getJsxElement('<p>Name: {firstName || lastName}</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.canInterpolate).toBe(false);
        expect(result.noInterpolateReason).toBe('complex-expression');
      });
    });

    describe('Nested Elements', () => {
      it('should detect nested elements as non-interpolatable', () => {
        const element = getJsxElement('<p>Click <a href="#">here</a> to continue</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.canInterpolate).toBe(false);
        expect(result.noInterpolateReason).toBe('contains-nested-elements');
      });
    });

    describe('Interpolation Template Generation', () => {
      it('should generate i18next interpolation template', () => {
        const element = getJsxElement('<p>Hello {name}!</p>');
        const result = analyzeAdjacentContent(element!, {
          format: 'i18next',
          translationFn: 't',
        });

        expect(result.interpolationTemplate).toBe('Hello {name}!');
        expect(result.localeValue).toBe('Hello {{name}}!');
        expect(result.replacement).toContain("t('hello'");
        expect(result.replacement).toContain('{ name }');
      });

      it('should generate ICU interpolation template', () => {
        const element = getJsxElement('<p>Hello {name}!</p>');
        const result = analyzeAdjacentContent(element!, {
          format: 'icu',
          translationFn: 't',
        });

        expect(result.localeValue).toBe('Hello {name}!');
      });

      it('should generate Vue interpolation template', () => {
        const element = getJsxElement('<p>Hello {name}!</p>');
        const result = analyzeAdjacentContent(element!, {
          format: 'vue',
          translationFn: '$t',
        });

        expect(result.localeValue).toBe('Hello {name}!');
        expect(result.replacement).toContain("$t('hello'");
      });

      it('should generate replacement with multiple variables', () => {
        const element = getJsxElement('<p>Hello {name}, you have {count} items</p>');
        const result = analyzeAdjacentContent(element!, {
          format: 'i18next',
          translationFn: 't',
        });

        expect(result.replacement).toContain('name');
        expect(result.replacement).toContain('count');
      });

      it('should use expression for different variable name', () => {
        const element = getJsxElement('<p>Name: {user.name}</p>');
        const result = analyzeAdjacentContent(element!, {
          format: 'i18next',
          translationFn: 't',
        });

        // Should use the extracted name with the full expression
        expect(result.replacement).toContain('name: user.name');
      });
    });

    describe('Strategy Selection', () => {
      it('should suggest TextOnly for text-only content', () => {
        const element = getJsxElement('<p>Hello World</p>');
        const result = analyzeAdjacentContent(element!);

        expect(result.suggestedStrategy).toBe(AdjacentStrategy.TextOnly);
      });

      it('should suggest Interpolate for simple adjacent patterns', () => {
        const element = getJsxElement('<p>Hello {name}</p>');
        const result = analyzeAdjacentContent(element!, {
          strategy: AdjacentStrategy.Interpolate,
        });

        expect(result.suggestedStrategy).toBe(AdjacentStrategy.Interpolate);
      });

      it('should suggest Separate for complex expressions', () => {
        const element = getJsxElement('<p>Result: {calculateSum()}</p>');
        const result = analyzeAdjacentContent(element!, {
          strategy: AdjacentStrategy.Interpolate,
        });

        expect(result.suggestedStrategy).toBe(AdjacentStrategy.Separate);
      });

      it('should respect explicit Separate strategy', () => {
        const element = getJsxElement('<p>Hello {name}</p>');
        const result = analyzeAdjacentContent(element!, {
          strategy: AdjacentStrategy.Separate,
        });

        expect(result.suggestedStrategy).toBe(AdjacentStrategy.Separate);
      });
    });
  });

  describe('hasAdjacentTextExpression', () => {
    it('should return true for text + expression', () => {
      const element = getJsxElement('<p>Hello {name}</p>');
      expect(hasAdjacentTextExpression(element!)).toBe(true);
    });

    it('should return false for text only', () => {
      const element = getJsxElement('<p>Hello World</p>');
      expect(hasAdjacentTextExpression(element!)).toBe(false);
    });

    it('should return false for expression only', () => {
      const element = getJsxElement('<p>{name}</p>');
      expect(hasAdjacentTextExpression(element!)).toBe(false);
    });
  });

  describe('getCombinedStaticText', () => {
    it('should return combined static text', () => {
      const element = getJsxElement('<p>Hello World</p>');
      expect(getCombinedStaticText(element!)).toBe('Hello World');
    });

    it('should return static text excluding expressions', () => {
      const element = getJsxElement('<p>Hello {name}, welcome!</p>');
      const text = getCombinedStaticText(element!);
      expect(text).toContain('Hello');
      expect(text).toContain('welcome!');
      expect(text).not.toContain('{');
    });
  });

  describe('Edge Cases', () => {
    it('should handle self-closing elements', () => {
      const element = getJsxElement('<br />');
      const result = analyzeAdjacentContent(element!);

      expect(result.hasAdjacentPattern).toBe(false);
      expect(result.children).toHaveLength(0);
    });

    it('should handle whitespace-only text nodes', () => {
      const element = getJsxElement('<p>   {name}   </p>');
      const result = analyzeAdjacentContent(element!);

      // Should not count whitespace-only as meaningful text
      expect(result.hasAdjacentPattern).toBe(false);
    });

    it('should handle mixed static and dynamic expressions', () => {
      const element = getJsxElement('<p>{"Hello "}{name}{"!"}</p>');
      const result = analyzeAdjacentContent(element!);

      // Static expressions count as text, so we have text + dynamic expression
      expect(result.hasAdjacentPattern).toBe(true);
      expect(result.staticText).toContain('Hello');
      expect(result.expressions).toHaveLength(1);
      expect(result.expressions[0].name).toBe('name');
    });
  });
});
