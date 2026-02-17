/**
 * Tests for Vue Expression Handler
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeVueExpression,
  analyzeVueAdjacentContent,
  generateVueReplacement,
  generateVueAttributeReplacement,
  VueTemplateChild,
} from '../utils/vue-expression-handler';
import { ExpressionType } from '../utils/expression-analyzer';
import { InterpolationFormat } from '../utils/template-literal-handler';
import { AdjacentStrategy } from '../utils/adjacent-text-handler';

describe('Vue Expression Handler', () => {
  describe('analyzeVueExpression', () => {
    describe('Simple String Literals', () => {
      it('should handle single-quoted strings', () => {
        const result = analyzeVueExpression("'Hello World'");
        
        expect(result.type).toBe(ExpressionType.SimpleString);
        expect(result.canExtract).toBe(true);
        expect(result.textParts).toEqual(['Hello World']);
        expect(result.mergedText).toBe('Hello World');
        expect(result.interpolationParams).toEqual({});
      });

      it('should handle double-quoted strings', () => {
        const result = analyzeVueExpression('"Hello World"');
        
        expect(result.type).toBe(ExpressionType.SimpleString);
        expect(result.canExtract).toBe(true);
        expect(result.textParts).toEqual(['Hello World']);
      });

      it('should skip non-translatable string content', () => {
        const result = analyzeVueExpression("'SELECT * FROM users'");
        
        expect(result.type).toBe(ExpressionType.NonTranslatable);
        expect(result.canExtract).toBe(false);
        expect(result.skipReason).toBeDefined();
      });
    });

    describe('Template Literals', () => {
      it('should handle simple template literals', () => {
        const result = analyzeVueExpression('`Hello World`');
        
        expect(result.type).toBe(ExpressionType.SimpleTemplateLiteral);
        expect(result.canExtract).toBe(true);
        expect(result.textParts).toEqual(['Hello World']);
        expect(result.mergedText).toBe('Hello World');
      });

      it('should handle template literals with expressions', () => {
        const result = analyzeVueExpression('`Hello ${name}!`');
        
        expect(result.type).toBe(ExpressionType.TemplateWithExpressions);
        expect(result.canExtract).toBe(true);
        expect(result.textParts).toEqual(['Hello ', '!']);
        expect(result.dynamicExpressions).toEqual(['name']);
        expect(result.mergedText).toBe('Hello {name}!');
        expect(result.interpolationParams).toEqual({ name: 'name' });
      });

      it('should handle template literals with multiple expressions', () => {
        const result = analyzeVueExpression('`${greeting}, ${name}!`');
        
        expect(result.type).toBe(ExpressionType.TemplateWithExpressions);
        expect(result.canExtract).toBe(true);
        expect(result.dynamicExpressions).toEqual(['greeting', 'name']);
        expect(result.mergedText).toBe('{greeting}, {name}!');
      });

      it('should handle template literals with property access', () => {
        const result = analyzeVueExpression('`Count: ${items.length}`');
        
        expect(result.type).toBe(ExpressionType.TemplateWithExpressions);
        expect(result.canExtract).toBe(true);
        expect(result.mergedText).toBe('Count: {length}');
        expect(result.interpolationParams).toEqual({ length: 'items.length' });
      });

      it('should skip pure dynamic template literals', () => {
        const result = analyzeVueExpression('`${dynamicContent}`');
        
        expect(result.type).toBe(ExpressionType.PureDynamic);
        expect(result.canExtract).toBe(false);
        expect(result.skipReason).toContain('only dynamic');
      });
    });

    describe('String Concatenation', () => {
      it('should handle static concatenation', () => {
        const result = analyzeVueExpression("'Hello' + ' ' + 'World'");
        
        expect(result.type).toBe(ExpressionType.StaticConcatenation);
        expect(result.canExtract).toBe(true);
        expect(result.mergedText).toBe('Hello World');
        expect(result.dynamicExpressions).toEqual([]);
      });

      it('should handle mixed concatenation', () => {
        const result = analyzeVueExpression("'Hello ' + name + '!'");
        
        expect(result.type).toBe(ExpressionType.MixedConcatenation);
        expect(result.canExtract).toBe(true);
        expect(result.textParts).toEqual(['Hello ', '!']);
        expect(result.dynamicExpressions).toEqual(['name']);
        expect(result.mergedText).toBe('Hello {name}!');
      });

      it('should skip pure dynamic concatenation', () => {
        const result = analyzeVueExpression('firstName + lastName');
        
        expect(result.type).toBe(ExpressionType.PureDynamic);
        expect(result.canExtract).toBe(false);
      });
    });

    describe('Conditional Expressions', () => {
      it('should identify conditional expressions', () => {
        const result = analyzeVueExpression("isAdmin ? 'Admin' : 'User'");
        
        expect(result.type).toBe(ExpressionType.ConditionalStrings);
        expect(result.textParts).toEqual(['Admin', 'User']);
        expect(result.dynamicExpressions).toContain('isAdmin');
      });
    });

    describe('Logical Expressions', () => {
      it('should identify logical fallbacks', () => {
        const result = analyzeVueExpression("user.name || 'Anonymous'");
        
        expect(result.type).toBe(ExpressionType.LogicalWithFallback);
        expect(result.canExtract).toBe(false);
        expect(result.textParts).toEqual(['Anonymous']);
      });

      it('should handle nullish coalescing', () => {
        const result = analyzeVueExpression("config.title ?? 'Default Title'");
        
        expect(result.type).toBe(ExpressionType.LogicalWithFallback);
        expect(result.canExtract).toBe(false);
      });
    });

    describe('Pure Dynamic Expressions', () => {
      it('should identify variable references', () => {
        const result = analyzeVueExpression('userName');
        
        expect(result.type).toBe(ExpressionType.PureDynamic);
        expect(result.canExtract).toBe(false);
        expect(result.dynamicExpressions).toEqual(['userName']);
      });

      it('should identify function calls', () => {
        const result = analyzeVueExpression('formatDate(date)');
        
        expect(result.type).toBe(ExpressionType.PureDynamic);
        expect(result.canExtract).toBe(false);
      });
    });

    describe('Non-Translatable Patterns', () => {
      it('should detect JSON-like strings', () => {
        const result = analyzeVueExpression('\'{"key": "value"}\'');
        
        expect(result.canExtract).toBe(false);
        expect(result.type).toBe(ExpressionType.NonTranslatable);
      });

      it('should detect URLs', () => {
        const result = analyzeVueExpression("'https://example.com/api'");
        
        expect(result.canExtract).toBe(false);
      });
    });

    describe('Interpolation Formats', () => {
      it('should use i18next format when specified', () => {
        const result = analyzeVueExpression('`Hello ${name}!`', {
          interpolationFormat: InterpolationFormat.I18next,
        });
        
        expect(result.mergedText).toBe('Hello {{name}}!');
      });

      it('should use ICU format when specified', () => {
        const result = analyzeVueExpression('`Hello ${name}!`', {
          interpolationFormat: InterpolationFormat.ICU,
        });
        
        expect(result.mergedText).toBe('Hello {name}!');
      });
    });
  });

  describe('analyzeVueAdjacentContent', () => {
    it('should analyze simple text node', () => {
      const children: VueTemplateChild[] = [
        { type: 'VText', text: 'Hello World', range: [0, 11] },
      ];
      
      const result = analyzeVueAdjacentContent(children);
      
      expect(result.canInterpolate).toBe(true);
      expect(result.strategy).toBe(AdjacentStrategy.TextOnly);
      expect(result.textParts).toEqual(['Hello World']);
    });

    it('should analyze text + expression pattern', () => {
      const children: VueTemplateChild[] = [
        { type: 'VText', text: 'User name: ', range: [0, 11] },
        { type: 'VExpressionContainer', expression: 'userName', range: [11, 25] },
      ];
      
      const result = analyzeVueAdjacentContent(children);
      
      expect(result.canInterpolate).toBe(true);
      expect(result.strategy).toBe(AdjacentStrategy.Interpolate);
      expect(result.textParts).toEqual(['User name:']);
      expect(result.expressions).toEqual(['userName']);
      expect(result.mergedText).toBe('User name: {userName}');
    });

    it('should analyze expression + text pattern', () => {
      const children: VueTemplateChild[] = [
        { type: 'VExpressionContainer', expression: 'count', range: [0, 10] },
        { type: 'VText', text: ' items remaining', range: [10, 26] },
      ];
      
      const result = analyzeVueAdjacentContent(children);
      
      expect(result.canInterpolate).toBe(true);
      expect(result.strategy).toBe(AdjacentStrategy.Interpolate);
      expect(result.mergedText).toBe('{count} items remaining');
    });

    it('should analyze interleaved text and expressions', () => {
      const children: VueTemplateChild[] = [
        { type: 'VText', text: 'Hello ', range: [0, 6] },
        { type: 'VExpressionContainer', expression: 'name', range: [6, 16] },
        { type: 'VText', text: ', you have ', range: [16, 27] },
        { type: 'VExpressionContainer', expression: 'count', range: [27, 38] },
        { type: 'VText', text: ' messages', range: [38, 47] },
      ];
      
      const result = analyzeVueAdjacentContent(children);
      
      expect(result.canInterpolate).toBe(true);
      expect(result.textParts).toEqual(['Hello', ', you have', 'messages']);
      expect(result.expressions).toEqual(['name', 'count']);
      expect(result.mergedText).toBe('Hello {name}, you have {count} messages');
    });

    it('should skip when no static text', () => {
      const children: VueTemplateChild[] = [
        { type: 'VExpressionContainer', expression: 'dynamicContent', range: [0, 20] },
      ];
      
      const result = analyzeVueAdjacentContent(children);
      
      expect(result.canInterpolate).toBe(false);
      expect(result.strategy).toBe(AdjacentStrategy.Separate);
    });

    it('should handle whitespace-only text nodes', () => {
      const children: VueTemplateChild[] = [
        { type: 'VText', text: '  ', range: [0, 2] },
        { type: 'VExpressionContainer', expression: 'value', range: [2, 12] },
      ];
      
      const result = analyzeVueAdjacentContent(children);
      
      expect(result.canInterpolate).toBe(false);
    });

    it('should use i18next format when specified', () => {
      const children: VueTemplateChild[] = [
        { type: 'VText', text: 'Hello ', range: [0, 6] },
        { type: 'VExpressionContainer', expression: 'name', range: [6, 16] },
      ];
      
      const result = analyzeVueAdjacentContent(children, {
        interpolationFormat: InterpolationFormat.I18next,
      });
      
      expect(result.mergedText).toBe('Hello {{name}}');
    });
  });

  describe('generateVueReplacement', () => {
    it('should generate simple replacement', () => {
      const result = generateVueReplacement('hello_world');
      
      expect(result).toBe("{{ $t('hello_world') }}");
    });

    it('should generate replacement with params', () => {
      const result = generateVueReplacement('hello_name', { name: 'userName' });
      
      expect(result).toBe("{{ $t('hello_name', { name: userName }) }}");
    });

    it('should generate replacement with multiple params', () => {
      const result = generateVueReplacement('greeting', { name: 'userName', count: 'messageCount' });
      
      expect(result).toBe("{{ $t('greeting', { name: userName, count: messageCount }) }}");
    });

    it('should use double quotes when specified', () => {
      const result = generateVueReplacement('hello', undefined, { useDoubleQuotes: true });
      
      expect(result).toBe('{{ $t("hello") }}');
    });
  });

  describe('generateVueAttributeReplacement', () => {
    it('should generate simple attribute replacement', () => {
      const result = generateVueAttributeReplacement('button_label');
      
      expect(result).toBe("$t('button_label')");
    });

    it('should generate attribute replacement with params', () => {
      const result = generateVueAttributeReplacement('items_count', { count: 'itemCount' });
      
      expect(result).toBe("$t('items_count', { count: itemCount })");
    });

    it('should use double quotes when specified', () => {
      const result = generateVueAttributeReplacement('label', undefined, { useDoubleQuotes: true });
      
      expect(result).toBe('$t("label")');
    });
  });
});
