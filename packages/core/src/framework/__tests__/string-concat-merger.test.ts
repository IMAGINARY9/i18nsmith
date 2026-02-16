/**
 * String Concatenation Merger Tests
 *
 * Tests for merging string concatenation in JSX expressions.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeStringConcatenation,
  MergeResult,
  MergeStrategy,
} from '../utils/string-concat-merger.js';
import { Project, SyntaxKind } from 'ts-morph';

function createTestProject() {
  return new Project({ skipAddingFilesFromTsConfig: true });
}

function getJsxExpression(code: string) {
  const project = createTestProject();
  const file = project.createSourceFile('test.tsx', code, { overwrite: true });
  return file.getFirstDescendantByKind(SyntaxKind.JsxExpression);
}

describe('String Concatenation Merger', () => {
  describe('Pure Static Concatenation', () => {
    it('should merge two static strings', () => {
      const code = `<p>{'Hello, ' + 'world!'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.mergedValue).toBe('Hello, world!');
      expect(result.strategy).toBe(MergeStrategy.FullMerge);
      expect(result.replacement).toBe("t('hello_world')");
    });

    it('should merge multiple static strings', () => {
      const code = `<p>{'a' + 'b' + 'c' + 'd'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.mergedValue).toBe('abcd');
    });

    it('should handle nested parentheses', () => {
      const code = `<p>{('a' + 'b') + ('c' + 'd')}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.mergedValue).toBe('abcd');
    });

    it('should preserve whitespace correctly', () => {
      const code = `<p>{'Hello ' + ' World'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.mergedValue).toBe('Hello  World');
    });
  });

  describe('Mixed Static + Dynamic (Interpolation Strategy)', () => {
    it('should create interpolation for static prefix + dynamic', () => {
      const code = `<p>{'Count: ' + count}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.strategy).toBe(MergeStrategy.Interpolation);
      expect(result.interpolationTemplate).toBe('Count: {count}');
      expect(result.variables).toEqual([{ name: 'count', expression: 'count' }]);
    });

    it('should create interpolation for dynamic + static suffix', () => {
      const code = `<p>{count + ' items'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.strategy).toBe(MergeStrategy.Interpolation);
      expect(result.interpolationTemplate).toBe('{count} items');
    });

    it('should create interpolation for sandwich pattern', () => {
      const code = `<p>{'Hello ' + name + '!'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.strategy).toBe(MergeStrategy.Interpolation);
      expect(result.interpolationTemplate).toBe('Hello {name}!');
    });

    it('should handle multiple dynamic parts', () => {
      const code = `<p>{'Hello ' + name + ', you have ' + count + ' messages'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.strategy).toBe(MergeStrategy.Interpolation);
      expect(result.interpolationTemplate).toBe('Hello {name}, you have {count} messages');
      expect(result.variables).toHaveLength(2);
    });

    it('should handle complex expressions with generated names', () => {
      const code = `<p>{'Items: ' + items.length}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.interpolationTemplate).toMatch(/Items: \{[\w]+\}/);
      expect(result.variables![0].expression).toBe('items.length');
    });

    it('should handle method calls in dynamic parts', () => {
      const code = `<p>{'Items: ' + items.join(', ')}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.variables![0].expression).toBe("items.join(', ')");
    });
  });

  describe('Separate Strategy (No Interpolation)', () => {
    it('should provide separate strategy option', () => {
      const code = `<p>{'Label: ' + value}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!, { preferSeparate: true });
      
      expect(result.strategy).toBe(MergeStrategy.Separate);
      expect(result.separateParts).toEqual([
        { type: 'static', value: 'Label: ', replacement: "t('label')" },
        { type: 'dynamic', value: 'value', replacement: '{value}' },
      ]);
    });

    it('should return full replacement for separate strategy', () => {
      const code = `<p>{'User: ' + userName}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!, { preferSeparate: true });
      
      expect(result.strategy).toBe(MergeStrategy.Separate);
      expect(result.fullReplacement).toContain("t('");
      expect(result.fullReplacement).toContain('{userName}');
    });
  });

  describe('Non-Concatenation Expressions', () => {
    it('should return no-merge for simple strings', () => {
      const code = `<p>{'Hello World'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(false);
      expect(result.reason).toBe('not-concatenation');
    });

    it('should return no-merge for pure dynamic expressions', () => {
      const code = `<p>{userName}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(false);
      expect(result.reason).toBe('pure-dynamic');
    });

    it('should return no-merge for template literals', () => {
      const code = '<p>{`Hello ${name}`}</p>';
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      // Template literals should be handled by the template literal handler
      expect(result.canMerge).toBe(false);
      expect(result.reason).toBe('template-literal');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings in concatenation', () => {
      const code = `<p>{'' + 'Hello' + ''}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.mergedValue).toBe('Hello');
    });

    it('should handle special characters', () => {
      const code = `<p>{'Hello! ' + 'World?'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.mergedValue).toBe('Hello! World?');
    });

    it('should handle unicode characters', () => {
      const code = `<p>{'🚀 ' + 'Launch!'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.mergedValue).toBe('🚀 Launch!');
    });

    it('should handle numbers converted to strings', () => {
      const code = `<p>{count + ' items'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.canMerge).toBe(true);
      expect(result.strategy).toBe(MergeStrategy.Interpolation);
    });
  });

  describe('Key Generation', () => {
    it('should generate translation key from merged value', () => {
      const code = `<p>{'Hello World'+ '!'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.suggestedKey).toBeDefined();
      expect(result.suggestedKey).toMatch(/^[a-z0-9_]+$/);
    });

    it('should generate meaningful key from interpolation template', () => {
      const code = `<p>{'Hello ' + name}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.suggestedKey).toBeDefined();
      // Key should be based on the static parts
      expect(result.suggestedKey).toContain('hello');
    });
  });

  describe('Replacement Generation', () => {
    it('should generate correct t() call for full merge', () => {
      const code = `<p>{'Hello, ' + 'world!'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.replacement).toMatch(/^t\('[^']+'\)$/);
    });

    it('should generate correct t() call with parameters for interpolation', () => {
      const code = `<p>{'Hello ' + name}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.replacement).toMatch(/^t\('[^']+', \{ .+ \}\)$/);
    });

    it('should include all variables in parameters object', () => {
      const code = `<p>{'Hello ' + name + ', you have ' + count + ' messages'}</p>`;
      const expr = getJsxExpression(code);
      
      const result = mergeStringConcatenation(expr!);
      
      expect(result.replacement).toContain('name');
      expect(result.replacement).toContain('count');
    });
  });
});
