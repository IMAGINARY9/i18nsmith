import { describe, it, expect, beforeEach } from 'vitest';
import { ReactAdapter } from './ReactAdapter';
import { shouldExtractText } from './utils/text-filters';
import { AdapterRegistry } from './registry';
import { normalizeConfig } from '../config/normalizer';
import { validateConfig } from '../config/validator';
import { I18nConfig } from '../config/types';
import { ScanCandidate } from '../scanner';
import { TransformCandidate } from './types';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('ReactAdapter Integration', () => {
  let adapter: ReactAdapter;
  let registry: AdapterRegistry;
  let config: I18nConfig;

  beforeEach(() => {
    config = normalizeConfig({
      sourceLanguage: 'en',
      targetLanguages: ['es'],
      localesDir: './locales',
      include: ['src/**/*.{ts,tsx}'],
      frameworks: ['react'],
      extraction: {
        translatableAttributes: ['placeholder', 'title', 'alt', 'label']
      }
    });

    const issues = validateConfig(config);
    expect(issues).toHaveLength(0);

    registry = new AdapterRegistry();
    adapter = new ReactAdapter(config, '/tmp');
    registry.register(adapter);
  });

  describe('scan integration', () => {
    it('should scan JSX attributes from real React component', () => {
      const content = `
import React from 'react';

const App = () => {
  return (
    <div>
      <input placeholder="Enter your name" />
      <button title="Click me">Submit</button>
      <img alt="Logo" src="logo.png" />
    </div>
  );
};

export default App;
`;

      const candidates = adapter.scan('App.tsx', content);

      // Default extraction presets now filter common UI tokens (e.g. button
      // labels like "Submit"). Expect only the meaningful translatable
      // candidates to be returned by default.
      expect(candidates).toHaveLength(3);
      expect(candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: 'Enter your name',
            filePath: 'App.tsx',
            kind: 'jsx-attribute',
            context: 'placeholder'
          }),
          expect.objectContaining({
            text: 'Click me',
            filePath: 'App.tsx',
            kind: 'jsx-attribute',
            context: 'title'
          }),
          expect.objectContaining({
            text: 'Logo',
            filePath: 'App.tsx',
            kind: 'jsx-attribute',
            context: 'alt'
          })
        ])
      );
    });

    it('should scan JSX text content from real React component', () => {
      const content = `
import React from 'react';

const Header = () => {
  return (
    <div>
      <h1>Welcome to our app</h1>
      <p>This is a description</p>
    </div>
  );
};

export default Header;
`;

      const candidates = adapter.scan('Header.tsx', content);

      expect(candidates).toHaveLength(2);
      expect(candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: 'Welcome to our app',
            filePath: 'Header.tsx',
            kind: 'jsx-text',
            position: expect.objectContaining({
              line: 7
            })
          }),
          expect.objectContaining({
            text: 'This is a description',
            filePath: 'Header.tsx',
            kind: 'jsx-text',
            position: expect.objectContaining({
              line: 8
            })
          })
        ])
      );
    });

    it('should handle self-closing JSX elements', () => {
      // TODO: This test fails when run in the full test suite due to unknown shared state issue
      // The functionality works correctly when tested in isolation
      const content = `import React from 'react';

const Icon = () => {
  return <input placeholder="Search..." />;
};

export default Icon;
`;

      const candidates = adapter.scan('Icon.tsx', content);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].text).toBe('Search...');
    });

    it('should handle multi-line JSX text', () => {
      const content = `
import React from 'react';

const Message = () => {
  return (
    <div>
      <p>
        This is a long message
        that spans multiple lines
        in the JSX.
      </p>
    </div>
  );
};

export default Message;
`;

      const candidates = adapter.scan('Message.tsx', content);

      expect(candidates).toHaveLength(3);
      expect(candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: 'This is a long message',
            filePath: 'Message.tsx',
            kind: 'jsx-text'
          }),
          expect.objectContaining({
            text: 'that spans multiple lines',
            filePath: 'Message.tsx',
            kind: 'jsx-text'
          }),
          expect.objectContaining({
            text: 'in the JSX.',
            filePath: 'Message.tsx',
            kind: 'jsx-text'
          })
        ])
      );
    });
  });

  describe('mutate integration', () => {
    it('should transform JSX attributes in real React component', () => {
      const originalContent = `
import React from 'react';
import { t } from 'i18n';

const Form = () => {
  return (
    <div>
      <input placeholder="Enter your email" />
      <button title="Submit form">Send</button>
    </div>
  );
};

export default Form;
`;

      // First scan to get actual candidates with correct positions
      const scanCandidates = adapter.scan('Form.tsx', originalContent);
      const candidates: TransformCandidate[] = scanCandidates.map(c => ({
        ...c,
        suggestedKey: c.suggestedKey || 'defaultKey',
        hash: c.hash || 'defaultHash',
        status: 'pending' as const
      }));

      const result = adapter.mutate('Form.tsx', originalContent, candidates, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' }
      });

      expect(result.didMutate).toBe(true);
      expect(result.edits).toHaveLength(candidates.length);
    });

    it('should transform JSX text content in real React component', () => {
      const originalContent = `
import React from 'react';
import { t } from 'i18n';

const Welcome = () => {
  return (
    <div>
      <h1>Hello World</h1>
      <p>Welcome to our application</p>
    </div>
  );
};

export default Welcome;
`;

      // First scan to get actual candidates with correct positions
      const scanCandidates = adapter.scan('Welcome.tsx', originalContent);
      const candidates: TransformCandidate[] = scanCandidates.map(c => ({
        ...c,
        suggestedKey: c.suggestedKey || 'defaultKey',
        hash: c.hash || 'defaultHash',
        status: 'pending' as const
      }));

      const result = adapter.mutate('Welcome.tsx', originalContent, candidates, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' }
      });

      expect(result.didMutate).toBe(true);
      expect(result.edits).toHaveLength(candidates.length);
    });

    it('should handle self-closing elements in mutation', () => {
      const originalContent = `
import React from 'react';
import { t } from 'i18n';

const Search = () => {
  return <input placeholder="Search products" />;
};

export default Search;
`;

      // First scan to get actual candidates with correct positions
      const scanCandidates = adapter.scan('Search.tsx', originalContent);
      const candidates: TransformCandidate[] = scanCandidates.map(c => ({
        ...c,
        suggestedKey: c.suggestedKey || 'defaultKey',
        hash: c.hash || 'defaultHash',
        status: 'pending' as const
      }));

      const result = adapter.mutate('Search.tsx', originalContent, candidates, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' }
      });

      expect(result.didMutate).toBe(true);
      expect(result.edits).toHaveLength(candidates.length);
    });

    it('wraps jsx-expression replacements in braces (template literal case)', () => {
      const originalContent = `
import React from 'react';

export function Example() {
  return <p>Template literal inline: {` + "`backtick ${'value'}`" + `}</p>;
}
`;

      const scanCandidates = adapter.scan('Example.tsx', originalContent);
      const target = scanCandidates.find((c) => c.kind === 'jsx-expression');
      expect(target).toBeDefined();

      const candidates: TransformCandidate[] = [
        {
          ...(target as ScanCandidate),
          suggestedKey: 'common.app.template-literal-inline.dca888',
          hash: target?.hash || 'defaultHash',
          status: 'pending' as const,
        },
      ];

      const result = adapter.mutate('Example.tsx', originalContent, candidates, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
  // t() call may include interpolation params for template-literal expressions
  expect(result.content).toMatch(/Template literal inline: \{t\('common\.app\.template-literal-inline\.dca888'(, \{[^}]+\})?\)\}/);
    });

    it('does not corrupt concatenation replacement with trailing fragments', () => {
      const originalContent = `
import React from 'react';

export function Example() {
  return <p>Simple concatenation: {'Hello, ' + 'world!'}</p>;
}
`;

      const scanCandidates = adapter.scan('Example.tsx', originalContent);
      const target = scanCandidates.find(
        (c) => c.kind === 'jsx-expression' && (c.text?.includes('Hello, world!') || c.text?.includes('{'))
      ) ?? scanCandidates.find((c) => c.kind === 'jsx-expression');
      expect(target).toBeDefined();

      const candidates: TransformCandidate[] = [
        {
          ...(target as ScanCandidate),
          suggestedKey: 'common.app.hello-world.552585',
          hash: target?.hash || 'defaultHash',
          status: 'pending' as const,
        },
      ];

      const result = adapter.mutate('Example.tsx', originalContent, candidates, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      expect(result.content).toContain("<p>Simple concatenation: {t('common.app.hello-world.552585')}</p>");
      expect(result.content).not.toContain("+ 'world!'");
    });

    it('preserves dynamic variable expressions when only static jsx-text is transformed', () => {
      const originalContent = `
import React from 'react';

export function Example({ userName }: { userName: string }) {
  return <p>User name: {userName}</p>;
}
`;

      const scanCandidates = adapter.scan('Example.tsx', originalContent);
      const staticTextCandidate = scanCandidates.find(
        (c) => c.kind === 'jsx-text' && c.text?.includes('User name:')
      );
      expect(staticTextCandidate).toBeDefined();

      const candidates: TransformCandidate[] = [
        {
          ...(staticTextCandidate as ScanCandidate),
          suggestedKey: 'common.app.user-name.7ada35',
          hash: staticTextCandidate?.hash || 'defaultHash',
          status: 'pending' as const,
        },
      ];

      const result = adapter.mutate('Example.tsx', originalContent, candidates, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
      });

      expect(result.didMutate).toBe(true);
      expect(result.content).toContain("{t('common.app.user-name.7ada35')}");
      expect(result.content).toContain('{userName}');
    });
  });

  describe('registry integration', () => {
    it('should be discoverable by file extension', () => {
      const reactAdapter = registry.getForFile('Component.tsx');
      expect(reactAdapter).toBeInstanceOf(ReactAdapter);
    });

    it('should not match non-React files', () => {
      const adapter = registry.getForFile('Component.vue');
      expect(adapter).toBeUndefined();
    });

    it('should pass preflight checks', async () => {
      const results = await registry.preflightCheck();
      expect(results.size).toBeGreaterThan(0); // Should have results for registered adapters
      
      // All dependency checks should pass
      for (const [adapterId, checks] of results) {
        for (const check of checks) {
          expect(check.available).toBe(true);
        }
      }
    });
  });

  describe('config integration', () => {
    it('should respect translatableAttributes from config', () => {
      const customConfig = normalizeConfig({
        sourceLanguage: 'en',
        targetLanguages: ['es'],
        localesDir: './locales',
        include: ['src/**/*.{ts,tsx}'],
        extraction: {
          translatableAttributes: ['data-label', 'aria-label']
        },
        frameworks: ['react']
      });

      const customAdapter = new ReactAdapter(customConfig, '/tmp');

      const content = `
import React from 'react';

const Custom = () => {
  return (
    <div>
      <input placeholder="This should not be extracted" />
      <button data-label="This should be extracted">OK</button>
    </div>
  );
};

export default Custom;
`;

    const candidates = customAdapter.scan('Custom.tsx', content);

    // With stricter defaults the button inner text ('OK') is no longer
    // considered translatable; only the explicitly configured
    // `data-label` attribute should be returned.
    expect(candidates).toHaveLength(1);
    expect(candidates.some(c => c.text === 'This should be extracted')).toBe(true);
    expect(candidates.some(c => c.context === 'data-label')).toBe(true);
    });

    it('should skip fallback literals for existing translation calls', () => {
      const adapter = new ReactAdapter(config, '/tmp');
      const content = `
import React from 'react';

export function Example() {
  return (
    <div>
      {t('known.key') || 'Fallback text'}
      {t('known.key') ?? 'Alt fallback'}
    </div>
  );
}
`;

      const candidates = adapter.scan('Example.tsx', content);
      expect(candidates.some(c => c.text === 'Fallback text')).toBe(false);
      expect(candidates.some(c => c.text === 'Alt fallback')).toBe(false);
    });

    it('should work with frameworks config field', () => {
      // Config already has frameworks: ['react'] from beforeEach
      const reactAdapter = registry.getForFile('App.tsx');
      expect(reactAdapter).toBeInstanceOf(ReactAdapter);
    });
  });
});