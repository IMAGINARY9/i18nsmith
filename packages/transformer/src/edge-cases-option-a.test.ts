import { describe, expect, it } from 'vitest';
import { Project, ScriptTarget, SyntaxKind } from 'ts-morph';
import { Transformer } from './transformer.js';

describe('Transformer Option A (pluralization/concat) guardrail', () => {
  it('flags conditional expressions inside JSX as unsafe', () => {
    const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { target: ScriptTarget.ESNext, jsx: 2 } });
    const sourceFile = project.createSourceFile(
      'App.tsx',
      [
        "import React from 'react';",
        'export function App({ count }: { count: number }) {',
        '  return <span>{count === 1 ? \'item\' : \'items\'}</span>;',
        '}',
      ].join('\n')
    );

    const jsxExpr = sourceFile.getFirstDescendantByKindOrThrow(SyntaxKind.JsxExpression);

    const transformer = new Transformer(
      {
        localesDir: 'locales',
        sourceLanguage: 'en',
        targetLanguages: [],
        sync: { suspiciousKeyPolicy: 'skip' },
        keyGeneration: { namespace: 'common', shortHashLen: 6 },
      } as any,
      { workspaceRoot: process.cwd(), write: false, project }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reason = (transformer as any).getUnsafeJsxExpressionReason(jsxExpr);
    expect(typeof reason).toBe('string');
    expect(String(reason).toLowerCase()).toContain('conditional');
  });
});
