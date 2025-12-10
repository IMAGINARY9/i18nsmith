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

  it('skips symbol-only and emoji-only text while keeping meaningful strings', () => {
    const project = new Project();
    project.createSourceFile(
      'symbols.tsx',
      `
      export function Example({ t }) {
        return (
          <section>
            <p>••••••••</p>
            <p>📍</p>
            <p>30%</p>
            <p>a150800</p>
            <p>*</p>
            <p>Ready ✅</p>
            {t('All set now')}
            {t('30% off')}
            {t('••••••')}
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

    expect(texts).toEqual(['Ready ✅', 'All set now', '30% off']);
  });

  it('decodes HTML entities and preserves newlines when configured', () => {
    const project = new Project();
    project.createSourceFile(
      'entities.tsx',
      `
      export function Example({ t }) {
        return (
          <section>
            <p>{'Line one' + '\\n' + 'Line two'}</p>
            {t('First&#10;Second')}
          </section>
        );
      }
      `
    );

    const baseConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      include: ['**/*.{ts,tsx}'],
      minTextLength: 1,
      sync: {
        translationIdentifier: 't',
      },
    };

  const defaultScanner = new Scanner(baseConfig, { workspaceRoot: '/test', project });
    const defaultSummary = defaultScanner.scan({ scanCalls: true } as any);
  const defaultTexts = defaultSummary.candidates.map((c) => c.text);

    expect(defaultTexts).toContain('Line one Line two');
    expect(defaultTexts).toContain('First Second');

    const newlineScanner = new Scanner({
      ...baseConfig,
      extraction: {
        preserveNewlines: true,
      },
    }, { workspaceRoot: '/test', project });

    const newlineSummary = newlineScanner.scan({ scanCalls: true } as any);
  const newlineTexts = newlineSummary.candidates.map((c) => c.text);

    expect(newlineTexts).toContain('Line one\nLine two');
    expect(newlineTexts).toContain('First\nSecond');
  });

  it('honors allow and deny patterns', () => {
    const project = new Project();
    project.createSourceFile(
      'patterns.tsx',
      `
      export function Example() {
        return (
          <section>
            <p>150800</p>
            <p>Ready ✅</p>
            <p>Keep me</p>
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
      extraction: {
        allowPatterns: ['^\\d+$'],
        denyPatterns: ['^Ready'],
      },
    };

    const scanner = new Scanner(config, { workspaceRoot: '/test', project });
    const texts = scanner.scan().candidates.map((c) => c.text);

    expect(texts).toEqual(['150800', 'Keep me']);
  });

  it('respects data attributes and inline comment directives', () => {
    const project = new Project();
    project.createSourceFile(
      'directives.tsx',
      `
      export function Example({ t }) {
        return (
          <section>
            <p data-i18n-skip>Skip me</p>
            <p data-i18n-force-extract>••••</p>
          </section>
        );
      }

      export function WithComments({ t }) {
        t('Skip via comment'); // i18n:skip
        t('••'); // i18n:force-extract
        return null;
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
    const texts = summary.candidates.map((c) => c.text);

    expect(texts).toContain('••••');
    expect(texts).toContain('••');
    expect(texts).not.toContain('Skip me');
    expect(texts).not.toContain('Skip via comment');
  });

  it('categorizes candidates into confidence buckets and records skip reasons', () => {
    const project = new Project();
    project.createSourceFile(
      'buckets.tsx',
      `
      export function Example({ t }) {
        t('Go'); // i18n:force-extract
        return (
          <section>
            <p>Welcome aboard traveler</p>
            <p>OK</p>
            <p data-i18n-skip>Skip this</p>
            {t('Nospace')}
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
      extraction: {
        minLetterCount: 4,
        minLetterRatio: 0.6,
      },
      sync: {
        translationIdentifier: 't',
      },
    };

    const scanner = new Scanner(config, { workspaceRoot: '/test', project });
    const summary = scanner.scan({ scanCalls: true } as any);

    const highTexts = summary.buckets.highConfidence.map((candidate) => candidate.text);
    const reviewTexts = summary.buckets.needsReview.map((candidate) => candidate.text);

    expect(highTexts).toContain('Welcome aboard traveler');
    expect(reviewTexts).toContain('OK');
    expect(reviewTexts).toContain('Go');

    const skipReasons = summary.buckets.skipped.map((entry) => entry.reason);
    expect(skipReasons).toContain('directive_skip');

    const nonSentence = summary.buckets.skipped.find((entry) => entry.reason === 'non_sentence');
    expect(nonSentence?.text).toBe('Nospace');
  });
});