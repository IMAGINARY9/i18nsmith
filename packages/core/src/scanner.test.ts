import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { Scanner } from './scanner';

describe('Scanner', () => {
  it('should scan JSX text and attributes', () => {
    const project = new Project();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `
      import React from 'react';
      function App() {
        return (
          <div>
            <h1>Hello World</h1>
            <input placeholder="Enter name" />
            <button>OK</button>
          </div>
        );
      }
      `
    );

    const config = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      include: ['**/*.{ts,tsx}'],
      minTextLength: 1,
    };

    const scanner = new Scanner(config, { workspaceRoot: '/test', project });

    const summary = scanner.scan();

  expect(summary.filesScanned).toBe(1);
  expect(summary.filesExamined).toHaveLength(1);
    expect(summary.candidates).toHaveLength(3);

    const texts = summary.candidates.map(c => c.text);
    expect(texts).toContain('Hello World');
    expect(texts).toContain('Enter name');
    expect(texts).toContain('OK');
  });

  it('should respect minTextLength', () => {
    const project = new Project();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `
      import React from 'react';
      function App() {
        return (
          <div>
            <span>A</span>
            <span>AB</span>
          </div>
        );
      }
      `
    );

    const config = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      include: ['**/*.{ts,tsx}'],
      minTextLength: 2,
    };

    const scanner = new Scanner(config, { workspaceRoot: '/test', project });

    const summary = scanner.scan();

  expect(summary.candidates).toHaveLength(1);
  expect(summary.filesExamined).toHaveLength(1);
    expect(summary.candidates[0].text).toBe('AB');
  });

  it('captures translation calls accessed via properties when scanCalls enabled', () => {
    const project = new Project();
    project.createSourceFile(
      'calls.tsx',
      `
      export function Example(props) {
        const { t } = props;
        t('Hello optional chaining world');
        props.t('Hello nested world');
        this.props?.t('Hello optional world');
        props['t']('Hello element access world');
        props.t('Nospace');
        props.t(label);
        const i18n = props.i18n;
        i18n.t('Hello property world');
      }
      `
    );

    const config = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      include: ['**/*.{ts,tsx}'],
      minTextLength: 1,
      sync: {
        translationIdentifier: 't',
      },
    };

    const scanner = new Scanner(config, { workspaceRoot: '/test', project });

  const summary = scanner.scan({ scanCalls: true } as any);
    const callCandidates = summary.candidates.filter((candidate) => candidate.kind === 'call-expression');

  expect(summary.filesScanned).toBe(1);
  expect(summary.filesExamined).toHaveLength(1);
    expect(callCandidates).toHaveLength(5);
    const texts = callCandidates.map((candidate) => candidate.text);
    expect(texts).toContain('Hello optional chaining world');
    expect(texts).toContain('Hello nested world');
    expect(texts).toContain('Hello optional world');
    expect(texts).toContain('Hello element access world');
    expect(texts).toContain('Hello property world');
  });

  it('captures no-substitution template literals in JSX and translation calls', () => {
    const project = new Project();
    project.createSourceFile(
      'templates.tsx',
      `
      export function Example({ t }) {
        const heading = \`Welcome template users\`;
        return (
          <section title={\`Template title text\`}>
            {\`Template body copy\`}
            <input placeholder={\`Template placeholder\`} aria-label={heading} />
            {t(\`Template call expression\`)}
          </section>
        );
      }
      `
    );

    const config = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      include: ['**/*.{ts,tsx}'],
      minTextLength: 1,
      sync: {
        translationIdentifier: 't',
      },
    };

    const scanner = new Scanner(config, { workspaceRoot: '/test', project });

    const summary = scanner.scan({ scanCalls: true } as any);
    const texts = summary.candidates.map((candidate) => candidate.text);

    expect(texts).toContain('Template title text');
    expect(texts).toContain('Template body copy');
    expect(texts).toContain('Template placeholder');
    expect(texts).toContain('Template call expression');
  });
});