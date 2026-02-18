import { describe, it, expect } from 'vitest';
import { VueAdapter } from '../adapters/vue.js';
import { normalizeConfig } from '../../config/normalizer.js';
import { analyzeVueAdjacentContent } from '../utils/vue-expression-handler.js';
import { analyzeAdjacentContent } from '../utils/adjacent-text-handler.js';
import type { VueTemplateChild } from '../utils/vue-expression-handler.js';
import { Project, SyntaxKind } from 'ts-morph';

function getJsxElement(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sourceFile = project.createSourceFile('test.tsx', code);
  return sourceFile.getFirstDescendantByKind(SyntaxKind.JsxElement);
}

describe('scenario repro — adjacent content extraction', () => {
  const config = normalizeConfig({
    sourceLanguage: 'en', targetLanguages: ['es'], localesDir: './locales',
    include: ['src/**/*.vue'], frameworks: ['vue']
  } as any);

  // ── Vue ──────────────────────────────────────────────────────────────────

  it('Vue: paren before {{ count }} is stripped from extracted text and key', () => {
    const adapter = new VueAdapter(config as any, '/tmp');
    const content = `<template>\n  <p>Items ({{ count }}): {{ items.join(', ') }}</p>\n</template>`;
    const candidates = adapter.scan('/test.vue', content);
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    // Opening ( before the dynamic placeholder must NOT appear in the extracted text
    expect(c.text).not.toContain('(');
    // Key is derived from static text only: "Items" → starts with "items"
    expect(c.suggestedKey).toMatch(/^items/);
    expect(c.suggestedKey).not.toMatch(/count|join/);
  });

  it('Vue: template literal inline — key comes from static prefix only', () => {
    const adapter = new VueAdapter(config as any, '/tmp');
    const content = "<template>\n  <p>Template literal inline: {{`backtick ${'value'}`}}</p>\n</template>";
    const candidates = adapter.scan('/test2.vue', content);
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    // Key must be derived from the static prefix "Template literal inline"
    expect(c.suggestedKey).toMatch(/template.?literal.?inline/i);
    // "backtick" or "arg0" (from inner expression) must NOT pollute the key
    expect(c.suggestedKey).not.toMatch(/backtick|arg0/);
  });

  it('Vue: analyzeVueAdjacentContent — paren stripped, spacing preserved', () => {
    // Simulate: Items ({{ count }}): {{ items.join(',') }}
    // VText nodes carry original source spacing
    const children: VueTemplateChild[] = [
      { type: 'VText', text: 'Items (', range: [0, 7] },
      { type: 'VExpressionContainer', expression: 'count', range: [7, 16] },
      { type: 'VText', text: '): ', range: [16, 19] },
      { type: 'VExpressionContainer', expression: "items.join(', ')", range: [19, 38] },
    ];
    const adj = analyzeVueAdjacentContent(children);
    expect(adj.canInterpolate).toBe(true);
    // Opening ( must not appear in mergedText
    expect(adj.mergedText).not.toContain('(');
    // keyText: static fragments only
    expect(adj.keyText).not.toContain('(');
    expect(adj.keyText).toContain('Items');
    // ): after the placeholder should be present with correct spacing (no extra space)
    expect(adj.mergedText).toMatch(/\{count\}\):/);
  });

  it('Vue: Hello {{ name }}, you have {{ count }} messages — no extra spaces', () => {
    const children: VueTemplateChild[] = [
      { type: 'VText', text: 'Hello ', range: [0, 6] },
      { type: 'VExpressionContainer', expression: 'name', range: [6, 15] },
      { type: 'VText', text: ', you have ', range: [15, 26] },
      { type: 'VExpressionContainer', expression: 'count', range: [26, 35] },
      { type: 'VText', text: ' messages', range: [35, 44] },
    ];
    const adj = analyzeVueAdjacentContent(children);
    expect(adj.canInterpolate).toBe(true);
    expect(adj.mergedText).toBe('Hello {name}, you have {count} messages');
  });

  // ── React ─────────────────────────────────────────────────────────────────

  it('React: paren before {count} is stripped from suggestedKey', () => {
    const element = getJsxElement('<p>Items ({count}): {items}</p>');
    const result = analyzeAdjacentContent(element!, { strategy: 'interpolate' as any, format: 'i18next', translationFn: 't' });
    // suggestedKey must not include the ( character
    expect(result.suggestedKey).toBeDefined();
    expect(result.suggestedKey).not.toContain('(');
    // Key should be derived from "Items" and "items remaining"-style text only
    expect(result.suggestedKey).toMatch(/^items/i);
  });

  it('React: localeValue has paren stripped for Items ({count})', () => {
    const element = getJsxElement('<p>Items ({count}): {label}</p>');
    const result = analyzeAdjacentContent(element!, { strategy: 'interpolate' as any, format: 'i18next', translationFn: 't' });
    // localeValue / interpolationTemplate should not contain the ( before {count}
    expect(result.localeValue).toBeDefined();
    expect(result.localeValue).not.toContain('(');
  });
});
