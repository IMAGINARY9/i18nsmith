import { describe, it, expect, beforeEach } from 'vitest';
import { ReactAdapter } from './ReactAdapter.js';
import type { I18nConfig } from '../config.js';

const mockConfig: I18nConfig = {
  sourceLanguage: 'en',
  targetLanguages: ['es', 'fr'],
  localesDir: 'locales',
  include: ['src/**/*.{ts,tsx,js,jsx}'],
  exclude: ['node_modules/**'],
};

describe('ReactAdapter', () => {
  let adapter: ReactAdapter;

  beforeEach(() => {
    adapter = new ReactAdapter(mockConfig, '/workspace');
  });

  describe('basic properties', () => {
    it('should have correct id, name, and extensions', () => {
      expect(adapter.id).toBe('react');
      expect(adapter.name).toBe('React');
      expect(adapter.extensions).toEqual(['.ts', '.tsx', '.js', '.jsx']);
    });

    it('should declare correct capabilities', () => {
      expect(adapter.capabilities).toEqual({
        scan: true,
        mutate: true,
        diff: true,
      });
    });
  });

  describe('checkDependencies', () => {
    it('should return ts-morph as available dependency', () => {
      const deps = adapter.checkDependencies();
      expect(deps).toHaveLength(1);
      expect(deps[0]).toEqual({
        name: 'ts-morph',
        available: true,
        installHint: 'npm install ts-morph',
      });
    });
  });

  describe('scan', () => {
    it('should scan JSX text content', () => {
      const content = `
        function Component() {
          return (
            <div>
              Hello World
            </div>
          );
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        kind: 'jsx-text',
        filePath: '/test.tsx',
        text: 'Hello World',
        position: { line: 5, column: 14 },
      });
    });

    it('should scan JSX attributes', () => {
      const content = `
        function Component() {
          return (
            <input placeholder="Enter your name" />
          );
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toMatchObject({
        kind: 'jsx-attribute',
        filePath: '/test.tsx',
        text: 'Enter your name',
        context: 'placeholder',
      });
    });

    it('should not scan non-translatable attributes', () => {
      const content = `
        function Component() {
          return (
            <input type="text" className="input" />
          );
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      expect(candidates).toHaveLength(0);
    });

    it('should skip single characters and symbols', () => {
      const content = `
        function Component() {
          return (
            <div>
              x
              ---
              Hello
            </div>
          );
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].text).toBe('Hello');
    });
  });

  describe('mutate', () => {
    it('should mutate JSX text content', () => {
      const content = `
        function Component() {
          return (
            <div>
              Hello World
            </div>
          );
        }
      `;

      const candidates = adapter.scan('/test.tsx', content);
      expect(candidates).toHaveLength(1);

      // Create a transform candidate
      const transformCandidate = {
        ...candidates[0],
        suggestedKey: 'greeting',
        hash: 'abc123',
        status: 'pending' as const,
      };

      const result = adapter.mutate('/test.tsx', content, [transformCandidate], {
        config: mockConfig,
        workspaceRoot: '/workspace',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      expect(result.content).toContain("t('greeting')");
      expect(result.edits).toHaveLength(1);
    });

    it('should handle empty candidates array', () => {
      const content = `
        function Component() {
          return <div>Hello</div>;
        }
      `;

      const result = adapter.mutate('/test.tsx', content, [], {
        config: mockConfig,
        workspaceRoot: '/workspace',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(false);
      expect(result.content).toBe(content);
      expect(result.edits).toHaveLength(0);
    });

    it('should rename call-expression argument (single quotes)', () => {
      const content = `
        function Component() {
          const { t } = useTranslation();
          return <div>{t('old.key')}</div>;
        }
      `;

  const candidates = adapter.scan('/test.tsx', content, { scanCalls: true, config: mockConfig, workspaceRoot: '/workspace' });
      const callCandidate = candidates.find((c) => c.kind === 'call-expression');
      expect(callCandidate).toBeDefined();

      // Simulate rename suggestion
      (callCandidate as any).suggestedKey = 'new.key';

      const result = adapter.mutate('/test.tsx', content, [callCandidate as any], {
        mode: 'rename',
        config: mockConfig,
        workspaceRoot: '/workspace',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      expect(result.content).toContain("t('new.key')");
    });

    it('should rename call-expression argument (double quotes, template literals, and extra args)', () => {
      const content = `
        function Component() {
          const { t } = useTranslation();
          return (
            <div>
              {t("old.key")}
              {t(\`old.key\`)}
              {t('old.key', { count: 1 })}
            </div>
          );
        }
      `;

      const candidates = adapter.scan('/test.tsx', content, { scanCalls: true, config: mockConfig, workspaceRoot: '/workspace' });
      const callCandidates = candidates.filter((c) => c.kind === 'call-expression');
      expect(callCandidates.length).toBeGreaterThanOrEqual(3);

      // Rename all found occurrences
      for (const cand of callCandidates) {
        (cand as any).suggestedKey = 'new.key';
      }

      const result = adapter.mutate('/test.tsx', content, callCandidates as any[], {
        mode: 'rename',
        config: mockConfig,
        workspaceRoot: '/workspace',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      // preserves quoting style and extra args
      expect(result.content).toContain('t("new.key")');
      expect(result.content).toContain('t(`new.key`)');
      expect(result.content).toContain("t('new.key', { count: 1 })");
    });
  });
});