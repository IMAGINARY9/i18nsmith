/**
 * Template Literal Handler Tests
 *
 * Tests for handling template literals in JSX expressions.
 */

import { describe, it, expect } from 'vitest';
import {
  handleTemplateLiteral,
  TemplateLiteralResult,
  InterpolationFormat,
} from '../utils/template-literal-handler.js';
import { Project, SyntaxKind } from 'ts-morph';

function createTestProject() {
  return new Project({ skipAddingFilesFromTsConfig: true });
}

function getJsxExpression(code: string) {
  const project = createTestProject();
  const file = project.createSourceFile('test.tsx', code, { overwrite: true });
  return file.getFirstDescendantByKind(SyntaxKind.JsxExpression);
}

describe('Template Literal Handler', () => {
  describe('Simple Template Literals (No Expressions)', () => {
    it('should handle simple template literal', () => {
      const code = '<p>{`Hello World`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.hasExpressions).toBe(false);
      expect(result.staticValue).toBe('Hello World');
      expect(result.replacement).toMatch(/t\('[^']+'\)/);
    });

    it('should handle template literal with special characters', () => {
      const code = '<p>{`Hello "World"!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.staticValue).toBe('Hello "World"!');
    });

    it('should handle multiline template literal', () => {
      const code = '<p>{`Line 1\nLine 2`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.staticValue).toContain('Line 1');
    });
  });

  describe('Template Literals with Expressions', () => {
    it('should handle template with single variable', () => {
      const code = '<p>{`Hello ${name}!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.hasExpressions).toBe(true);
      expect(result.interpolationTemplate).toBe('Hello {name}!');
      expect(result.variables).toEqual([{ name: 'name', expression: 'name' }]);
    });

    it('should handle template with multiple variables', () => {
      const code = '<p>{`Hello ${firstName} ${lastName}!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.interpolationTemplate).toBe('Hello {firstName} {lastName}!');
      expect(result.variables).toHaveLength(2);
    });

    it('should handle template with expression at start', () => {
      const code = '<p>{`${greeting}, World!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.interpolationTemplate).toBe('{greeting}, World!');
    });

    it('should handle template with expression at end', () => {
      const code = '<p>{`Count: ${count}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.interpolationTemplate).toBe('Count: {count}');
    });

    it('should handle template with only expressions', () => {
      const code = '<p>{`${a}${b}${c}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.interpolationTemplate).toBe('{a}{b}{c}');
    });
  });

  describe('Complex Expressions in Templates', () => {
    it('should handle property access expressions', () => {
      const code = '<p>{`User: ${user.name}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.variables![0].expression).toBe('user.name');
      // Complex expressions get generated names
      expect(result.variables![0].name).toMatch(/^userName$|^arg\d+$/);
    });

    it('should handle method call expressions', () => {
      const code = '<p>{`Items: ${items.join(", ")}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.variables![0].expression).toBe('items.join(", ")');
    });

    it('should handle array access expressions', () => {
      const code = '<p>{`First: ${items[0]}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.variables![0].expression).toBe('items[0]');
    });

    it('should handle ternary expressions', () => {
      const code = '<p>{`Status: ${isActive ? "Active" : "Inactive"}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      // The ternary is treated as a single complex expression
      expect(result.variables![0].expression).toContain('isActive');
    });

    it('should handle function call expressions', () => {
      const code = '<p>{`Date: ${formatDate(date)}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.variables![0].expression).toBe('formatDate(date)');
    });
  });

  describe('Interpolation Format Options', () => {
    it('should use i18next format by default', () => {
      const code = '<p>{`Hello ${name}!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.interpolationTemplate).toBe('Hello {name}!');
      expect(result.localeValue).toBe('Hello {{name}}!');
    });

    it('should support ICU format', () => {
      const code = '<p>{`Hello ${name}!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!, { format: InterpolationFormat.ICU });
      
      expect(result.localeValue).toBe('Hello {name}!');
    });

    it('should support Vue format', () => {
      const code = '<p>{`Hello ${name}!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!, { format: InterpolationFormat.Vue });
      
      expect(result.localeValue).toBe('Hello {name}!');
    });

    it('should support printf format', () => {
      const code = '<p>{`Hello ${name}!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!, { format: InterpolationFormat.Printf });
      
      expect(result.localeValue).toBe('Hello %s!');
    });
  });

  describe('Replacement Generation', () => {
    it('should generate simple t() for no expressions', () => {
      const code = '<p>{`Hello World`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.replacement).toMatch(/^t\('[^']+'\)$/);
    });

    it('should generate t() with parameters for expressions', () => {
      const code = '<p>{`Hello ${name}!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.replacement).toMatch(/t\('[^']+', \{.*name.*\}\)/);
    });

    it('should generate correct variable names in parameters', () => {
      const code = '<p>{`${firstName} ${lastName}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.replacement).toContain('firstName');
      expect(result.replacement).toContain('lastName');
    });

    it('should handle complex expressions with generated names', () => {
      const code = '<p>{`Items: ${items.length}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      // Should use the generated name, not the full expression
      expect(result.replacement).toMatch(/itemsLength|arg\d+/);
    });
  });

  describe('Non-Translatable Templates', () => {
    it('should skip JSON-like template content', () => {
      const code = '<p>{`{"key": "value"}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(false);
      expect(result.skipReason).toBe('json-like-content');
    });

    it('should skip code-like template content', () => {
      const code = '<p>{`const x = 1; return x;`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(false);
      expect(result.skipReason).toBe('code-like-content');
    });

    it('should skip URL templates', () => {
      const code = '<p>{`https://example.com/${path}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(false);
      expect(result.skipReason).toBe('url-template');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty template literal', () => {
      const code = '<p>{``}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(false);
      expect(result.skipReason).toBe('empty-template');
    });

    it('should handle whitespace-only template literal', () => {
      const code = '<p>{`   `}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(false);
      expect(result.skipReason).toBe('whitespace-only');
    });

    it('should return no-transform for non-template expressions', () => {
      const code = `<p>{'Hello World'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(false);
      expect(result.skipReason).toBe('not-template-literal');
    });

    it('should handle template with escaped backticks', () => {
      const code = '<p>{`Code: \\`example\\``}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
    });

    it('should handle template with unicode characters', () => {
      const code = '<p>{`🚀 ${action} successful!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.canTransform).toBe(true);
      expect(result.interpolationTemplate).toContain('🚀');
    });
  });

  describe('Key Generation', () => {
    it('should generate key from static content', () => {
      const code = '<p>{`Welcome to the app`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.suggestedKey).toBeDefined();
      expect(result.suggestedKey).toMatch(/welcome/);
    });

    it('should generate key from static parts of interpolated template', () => {
      const code = '<p>{`Hello ${name}, welcome!`}</p>';
      const expr = getJsxExpression(code);
      
      const result = handleTemplateLiteral(expr!);
      
      expect(result.suggestedKey).toBeDefined();
      expect(result.suggestedKey).toMatch(/hello.*welcome/);
    });
  });
});
