import { describe, it, expect } from 'vitest';
import { ReactAdapter } from '../ReactAdapter.js';
import type { I18nConfig } from '../../config.js';
import type { TransformCandidate } from '../types.js';

const defaultConfig: I18nConfig = {
  locales: {
    default: 'en',
    supported: ['en', 'es'],
  },
  sourceDir: './src',
  localeDir: './locales',
  extraction: {
    preserveNewlines: false,
    decodeHtmlEntities: true,
  },
};

describe('ReactAdapter - Interpolation & Spacing Fixes', () => {
  describe('Issue 1: Template literal with expression should preserve interpolation params', () => {
    it('should extract template literal with interpolation metadata', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          return <p>Template literal inline: {\`backtick \${'value'}\`}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      
      // Should find the template literal
      const templateCandidate = candidates.find(c => c.text.includes('backtick'));
      expect(templateCandidate).toBeDefined();
      expect(templateCandidate?.text).toBe('backtick {arg0}');
      expect(templateCandidate?.interpolation).toBeDefined();
      expect(templateCandidate?.interpolation?.variables).toHaveLength(1);
      expect(templateCandidate?.interpolation?.variables[0].expression).toBe("'value'");
    });

    it('should mutate template literal to t() call with params', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          return <p>Template literal: {\`backtick \${'value'}\`}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      const templateCandidate = candidates.find(c => c.text.includes('backtick'));
      expect(templateCandidate).toBeDefined();

      const transformCandidates: TransformCandidate[] = [{
        ...templateCandidate!,
        suggestedKey: 'common.backtick_arg0',
        hash: 'abc123',
        status: 'approved',
      }];

      const result = adapter.mutate('/test/App.tsx', content, transformCandidates, {
        mode: 'transform',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      // Should have params in the t() call
      expect(result.content).toMatch(/t\('common\.backtick_arg0',\s*\{\s*arg0:\s*'value'\s*\}\)/);
    });
  });

  describe('Issue 2: Static concatenation should merge into single key with proper spacing', () => {
    it('should extract static concatenation as single merged candidate', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          return <p>{'Hello, ' + 'world!'}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      
      // Should create ONE candidate with merged text, not two separate ones
      const mergedCandidate = candidates.find(c => c.text === 'Hello, world!');
      expect(mergedCandidate).toBeDefined();
      expect(mergedCandidate?.kind).toBe('jsx-expression');
      
      // Should NOT have separate candidates for 'Hello, ' and 'world!'
      const separateHello = candidates.find(c => c.text === 'Hello, ');
      const separateWorld = candidates.find(c => c.text === 'world!');
      expect(separateHello).toBeUndefined();
      expect(separateWorld).toBeUndefined();
    });

    it('should mutate static concatenation to single t() call', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          return <p>{'Hello, ' + 'world!'}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      const mergedCandidate = candidates.find(c => c.text === 'Hello, world!');
      expect(mergedCandidate).toBeDefined();

      const transformCandidates: TransformCandidate[] = [{
        ...mergedCandidate!,
        suggestedKey: 'common.hello_world',
        hash: 'abc123',
        status: 'approved',
      }];

      const result = adapter.mutate('/test/App.tsx', content, transformCandidates, {
        mode: 'transform',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      // Should have single t() call, not multiple
      const tCallCount = (result.content.match(/\{t\(/g) || []).length;
      expect(tCallCount).toBe(1);
      expect(result.content).toMatch(/\{t\('common\.hello_world'\)\}/);
    });
  });

  describe('Issue 3: Trailing punctuation before dynamic content should not be extracted', () => {
    it('should extract mixed concatenation without trailing opening bracket', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          const count = 5;
          return <p>{'Items (' + count + ')'}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      
      // Should find mixed concatenation
      const mixedCandidate = candidates.find(c => c.text.includes('Items'));
      expect(mixedCandidate).toBeDefined();
      
      // Should NOT include the trailing '(' in the extracted text
      // The interpolation template should be "Items {count})" not "Items ({count})"
      expect(mixedCandidate?.text).not.toContain('Items (');
      expect(mixedCandidate?.interpolation).toBeDefined();
      expect(mixedCandidate?.interpolation?.template).toMatch(/^Items \{/);
      expect(mixedCandidate?.interpolation?.template).not.toMatch(/Items \(/);
    });

    it('should mutate mixed concatenation preserving structural punctuation', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          const count = 5;
          return <p>{'Items (' + count + ')'}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      const mixedCandidate = candidates.find(c => c.text.includes('Items'));
      expect(mixedCandidate).toBeDefined();

      const transformCandidates: TransformCandidate[] = [{
        ...mixedCandidate!,
        suggestedKey: 'common.items',
        hash: 'abc123',
        status: 'approved',
      }];

      const result = adapter.mutate('/test/App.tsx', content, transformCandidates, {
        mode: 'transform',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      // The locale key should NOT contain the opening bracket
      expect(result.content).toMatch(/t\('common\.items'/);
      // The result should still have proper syntax with the bracket
      expect(result.content).toMatch(/\{t\('common\.items',\s*\{[^}]+\}\)\}/);
    });
  });

  describe('Edge case: Multiple adjacent JSX text and expressions', () => {
    it('should handle adjacent JSX text followed by expression', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          const userName = 'John';
          return <p>User name: {userName}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      
      // Should only find "User name:" as JSX text (the variable is dynamic)
      const textCandidate = candidates.find(c => c.text === 'User name:');
      expect(textCandidate).toBeDefined();
      expect(textCandidate?.kind).toBe('jsx-text');
    });

    it('should not include opening punctuation in adjacent jsx-text before an expression', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          const count = 5;
          const items = ['a','b'];
          return <p>Items ({count}): {items.join(', ')}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);

      // Find the static jsx-text fragment that precedes the expression
      const textCandidate = candidates.find(c => c.kind === 'jsx-text' && /Items/.test(c.text || ''));
      expect(textCandidate).toBeDefined();
      // The extracted text must NOT include the structural opening parenthesis
      expect(textCandidate?.text).not.toContain('(');
      expect(textCandidate?.text).toBe('Items');
    });
  });

  describe('Edge case: Mixed concatenation with leading/trailing spaces', () => {
    it('should preserve spaces in interpolation template', () => {
      const adapter = new ReactAdapter(defaultConfig, '/test');
      const content = `
        export function App() {
          const name = 'Alice';
          return <p>{'Hello ' + name + '!'}</p>;
        }
      `;

      const candidates = adapter.scan('/test/App.tsx', content);
      
      const mixedCandidate = candidates.find(c => c.text.includes('Hello'));
      expect(mixedCandidate).toBeDefined();
      expect(mixedCandidate?.interpolation).toBeDefined();
      // Template should be "Hello {name}!" preserving the space after Hello
      expect(mixedCandidate?.interpolation?.template).toMatch(/^Hello \{name\}!$/);
    });
  });
});
