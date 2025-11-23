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
    expect(summary.candidates[0].text).toBe('AB');
  });
});