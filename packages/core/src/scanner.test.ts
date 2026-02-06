import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { Scanner } from './scanner';

describe('Scanner', async () => {
  it('should scan JSX text and attributes', async () => {
    const project = new Project();
    const sourceFile = project.createSourceFile(
      '/test/test.tsx',
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });

    const summary = scanner.scan({ targets: ['test.tsx'] });

    expect(summary.filesScanned).toBe(1);
    expect(summary.filesExamined).toHaveLength(1);
    expect(summary.candidates).toHaveLength(3);

    const texts = summary.candidates.map((c) => c.text);
    expect(texts).toContain('Hello World');
    expect(texts).toContain('Enter name');
    expect(texts).toContain('OK');

    // All candidates should be in highConfidence bucket
    expect(summary.buckets.highConfidence).toHaveLength(3);
    expect(summary.buckets.highConfidence.some(c => c.text === 'Hello World')).toBe(true);
    expect(summary.buckets.highConfidence.some(c => c.text === 'Enter name')).toBe(true);
    expect(summary.buckets.highConfidence.some(c => c.text === 'OK')).toBe(true);
  });

  it('should respect minTextLength', async () => {
    const project = new Project();
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `
      import React from 'react';
      function App() {
        return (
          <div>
            <span>A</span>
            <span>Label</span>
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });

    const summary = scanner.scan();

    expect(summary.candidates).toHaveLength(1);
    expect(summary.filesExamined).toHaveLength(1);
  expect(summary.candidates[0].text).toBe('Label');
  });

  it('captures translation calls accessed via properties when scanCalls enabled', async () => {
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });

  const summary = scanner.scan({ scanCalls: true } as any);
    const callCandidates = summary.candidates.filter((candidate) => candidate.kind === 'call-expression');

  expect(summary.filesScanned).toBe(1);
  expect(summary.filesExamined).toHaveLength(1);
    expect(callCandidates).toHaveLength(6);
    const texts = callCandidates.map((candidate) => candidate.text);
    expect(texts).toContain('Hello optional chaining world');
    expect(texts).toContain('Hello nested world');
    expect(texts).toContain('Hello optional world');
    expect(texts).toContain('Hello element access world');
    expect(texts).toContain('Hello property world');
    expect(texts).toContain('Nospace');
  });

  it('captures no-substitution template literals in JSX and translation calls', async () => {
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });

    const summary = scanner.scan({ scanCalls: true } as any);
    const texts = summary.candidates.map((candidate) => candidate.text);

    expect(texts).toContain('Template title text');
    expect(texts).toContain('Template body copy');
    expect(texts).toContain('Template placeholder');
    expect(texts).toContain('Template call expression');
  });

  it('skips symbol-only and emoji-only text while keeping meaningful strings', async () => {
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
            <p>x</p>
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });

    const summary = scanner.scan({ scanCalls: true } as any);
    const texts = summary.candidates.map((candidate) => candidate.text);

    expect(texts).toEqual(['Ready ✅', 'All set now', '30% off']);
  });

  it('decodes HTML entities and preserves newlines when configured', async () => {
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

  it('honors allow and deny patterns', async () => {
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });
    const texts = scanner.scan().candidates.map((c) => c.text);

    expect(texts).toEqual(['150800', 'Keep me']);
  });

  it('respects data attributes and inline comment directives', async () => {
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });
    const summary = scanner.scan({ scanCalls: true } as any);
    const texts = summary.candidates.map((c) => c.text);

    expect(texts).toContain('••••');
    expect(texts).toContain('••');
    expect(texts).not.toContain('Skip me');
    expect(texts).not.toContain('Skip via comment');
  });

  it('categorizes candidates into confidence buckets and records skip reasons', async () => {
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

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });
    const summary = scanner.scan({ scanCalls: true } as any);

  const highTexts = summary.buckets.highConfidence.map((candidate) => candidate.text);
  const reviewTexts = summary.buckets.needsReview.map((candidate) => candidate.text);

  expect(highTexts).toContain('Welcome aboard traveler');
  expect(reviewTexts).toContain('Go');

  const skippedOk = summary.buckets.skipped.find((entry) => entry.text === 'OK');
  expect(skippedOk?.reason).toBe('non_sentence');

    const skipReasons = summary.buckets.skipped.map((entry) => entry.reason);
    expect(skipReasons).toContain('directive_skip');

  const nonSentence = summary.buckets.skipped.find((entry) => entry.reason === 'non_sentence');
  expect(nonSentence?.text).toBe('OK');
  });

  it('streams workspace files to avoid retaining large AST sets', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scanner-stream-'));

    const files = [
      ['src/App.tsx', `<div>Hello One</div>`],
      ['src/Dashboard.tsx', `<main><p>Hello Two</p></main>`],
      ['src/forms/Widget.tsx', `<span>Hello Three</span>`],
    ] as const;

    try {
      for (const [relative, contents] of files) {
        const fullPath = path.join(tempDir, relative);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(
          fullPath,
          `import React from 'react';
           export function Component() {
             return ${contents};
           }
          `
        );
      }

      const config = {
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        include: ['src/**/*.{ts,tsx}'],
        minTextLength: 1,
      };

      const scanner = new Scanner(config, { workspaceRoot: tempDir });
      const summary = scanner.scan();

      expect(summary.filesScanned).toBe(files.length);
      expect(summary.candidates).toHaveLength(files.length);

      const internalProject = (scanner as unknown as { project: Project }).project;
      expect(internalProject.getSourceFiles().length).toBe(0);

      const followUp = scanner.scan();
      expect(followUp.filesScanned).toBe(summary.filesScanned);
      expect(followUp.candidates.length).toBe(summary.candidates.length);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('skips html entities and system-like short labels unless forced', async () => {
    const project = new Project();
    project.createSourceFile(
      'entities-and-labels.tsx',
      `
      export function Example() {
        return (
          <section>
            <p>{'&ldquo;'}</p>
            <p>{'&rdquo;'}</p>
            <p>{'--'}</p>
            <p>CPU</p>
            <p data-i18n-force-extract>Go</p>
            <p>Welcome aboard</p>
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
    };

    const scanner = await Scanner.create(config, { workspaceRoot: '/test', project });
    const summary = scanner.scan();
    const texts = summary.candidates.map((candidate) => candidate.text);

    expect(texts).toContain('Go');
    expect(texts).toContain('Welcome aboard');
    expect(texts).not.toContain('CPU');
    expect(texts).not.toContain('“');
    expect(texts).not.toContain('”');
    expect(texts).not.toContain('--');
  });
});