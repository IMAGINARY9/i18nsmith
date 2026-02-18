/**
 * Enhanced JSX Scanning Tests
 *
 * Tests for improved JSX expression scanning that handles concatenation,
 * template literals, and complex expressions as units.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReactAdapter } from '../ReactAdapter.js';
import type { I18nConfig } from '../../config.js';

const mockConfig: I18nConfig = {
  sourceLanguage: 'en',
  targetLanguages: ['es', 'fr'],
  localesDir: 'locales',
  include: ['src/**/*.{ts,tsx,js,jsx}'],
  exclude: ['node_modules/**'],
};

describe('Enhanced JSX Scanning', () => {
  let adapter: ReactAdapter;

  beforeEach(() => {
    adapter = new ReactAdapter(mockConfig, '/workspace');
  });

  describe('String Concatenation Scanning', () => {
    it('should scan static concatenation as a single candidate', () => {
      const content = `
        function Component() {
          return <p>{'Hello, ' + 'world!'}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      // Should produce a single candidate for the merged string
      const concatCandidate = candidates.find(c => c.text === 'Hello, world!');
      expect(concatCandidate).toBeDefined();
    });

    it('should handle mixed concatenation with interpolation info', () => {
      const content = `
        function Component() {
          const name = 'Alice';
          return <p>{'Hello ' + name + '!'}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      // Should produce a candidate with interpolation metadata
      const mixedCandidate = candidates.find(c => 
        c.text?.includes('Hello') && c.kind === 'jsx-expression'
      );
      expect(mixedCandidate).toBeDefined();
      // Should include interpolation info
      expect(mixedCandidate?.interpolation).toBeDefined();
    });

    it('should not extract individual strings from concatenation separately', () => {
      const content = `
        function Component() {
          return <p>{'Hello, ' + 'world!'}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      // Should NOT have separate candidates for 'Hello, ' and 'world!'
      const helloOnly = candidates.find(c => c.text === 'Hello, ');
      const worldOnly = candidates.find(c => c.text === 'world!');
      expect(helloOnly).toBeUndefined();
      expect(worldOnly).toBeUndefined();
    });
  });

  describe('Template Literal Scanning', () => {
    it('should scan simple template literal', () => {
      const content = `
        function Component() {
          return <p>{\`Hello World\`}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      const templateCandidate = candidates.find(c => c.text === 'Hello World');
      expect(templateCandidate).toBeDefined();
    });

    it('should scan template literal with expressions', () => {
      const content = `
        function Component() {
          const name = 'Alice';
          return <p>{\`Hello \${name}!\`}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      // Should produce a candidate with interpolation template
      const templateCandidate = candidates.find(c => 
        c.interpolation?.template === 'Hello {name}!'
      );
      expect(templateCandidate).toBeDefined();
    });

    it('should include variable information for template expressions', () => {
      const content = `
        function Component() {
          const firstName = 'Alice';
          const lastName = 'Smith';
          return <p>{\`\${firstName} \${lastName}\`}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      const templateCandidate = candidates.find(c => c.interpolation);
      expect(templateCandidate?.interpolation?.variables).toHaveLength(2);
    });
  });

  describe('Pure Dynamic Expression Handling', () => {
    it('should skip pure variable references', () => {
      const content = `
        function Component() {
          const userName = 'Alice';
          return <p>{userName}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      // Pure variable reference should not be extracted
      const varCandidate = candidates.find(c => c.text === 'userName');
      expect(varCandidate).toBeUndefined();
    });

    it('should skip function call results', () => {
      const content = `
        function Component() {
          return <p>{formatDate(new Date())}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      expect(candidates).toHaveLength(0);
    });
  });

  describe('Non-Translatable Pattern Detection', () => {
    it('should skip JSON-like strings', () => {
      const content = `
        function Component() {
          return <p>{"{\\"key\\": \\"value\\"}"}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      const jsonCandidate = candidates.find(c => c.text?.includes('key'));
      expect(jsonCandidate).toBeUndefined();
    });

    it('should skip SQL-like strings', () => {
      const content = `
        function Component() {
          return <p>{"SELECT * FROM users"}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      const sqlCandidate = candidates.find(c => c.text?.includes('SELECT'));
      expect(sqlCandidate).toBeUndefined();
    });

    it('should skip format specifier strings', () => {
      const content = `
        function Component() {
          return <p>{"%s %d %f"}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      const formatCandidate = candidates.find(c => c.text?.includes('%s'));
      expect(formatCandidate).toBeUndefined();
    });

    it('should extract only the label when text contains SQL-like fragment', () => {
      const content = `
        function Component() {
          return <p>SQL-like: WHERE name = 'O\'Reilly'</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      const labelCandidate = candidates.find(c => c.text?.startsWith('SQL-like'));
      expect(labelCandidate).toBeDefined();
      // Should NOT include the SQL fragment in the extracted text
      expect(labelCandidate?.text).toBe('SQL-like:');
    });
  });

  describe('Adjacent Text and Expression Handling', () => {
    it('should handle text followed by expression', () => {
      const content = `
        function Component() {
          const name = 'Alice';
          return <p>User name: {name}</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      // Should extract the static text "User name:"
      const textCandidate = candidates.find(c => c.text?.includes('User name'));
      expect(textCandidate).toBeDefined();
    });

    it('should handle expression followed by text', () => {
      const content = `
        function Component() {
          const count = 5;
          return <p>{count} items remaining</p>;
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      // Should extract the static text "items remaining"
      const textCandidate = candidates.find(c => c.text?.includes('items remaining'));
      expect(textCandidate).toBeDefined();
    });
  });
});
