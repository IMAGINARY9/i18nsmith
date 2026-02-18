import { describe, it, expect } from 'vitest';
import { VueAdapter } from '../adapters/vue.js';
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

describe('VueAdapter - Interpolation & Spacing Fixes', () => {
  describe('Issue 1: Template expression with interpolation should preserve params', () => {
    it('should extract template expression with interpolation metadata', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <p>{{ \`backtick \${value}\` }}</p>
</template>
      `;

  const candidates = adapter.scan('/test/App.vue', content);
  // Should find the template literal with interpolation
  const templateCandidate = candidates.find(c => c.text.includes('backtick'));
      expect(templateCandidate).toBeDefined();
      expect(templateCandidate?.text).toBe('backtick {value}');
      expect(templateCandidate?.interpolation).toBeDefined();
      expect(templateCandidate?.interpolation?.variables).toHaveLength(1);
      expect(templateCandidate?.interpolation?.variables[0].name).toBe('value');
    });

    it('should mutate template expression to $t() call with params', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <p>{{ \`backtick \${value}\` }}</p>
</template>
      `;

      const candidates = adapter.scan('/test/App.vue', content);
      const templateCandidate = candidates.find(c => c.text.includes('backtick'));
      expect(templateCandidate).toBeDefined();

      const transformCandidates: TransformCandidate[] = [{
        ...templateCandidate!,
        suggestedKey: 'common.backtick_value',
        hash: 'abc123',
        status: 'pending',
      }];

      const result = adapter.mutate('/test/App.vue', content, transformCandidates, {
        mode: 'transform',
        config: defaultConfig,
        workspaceRoot: '/test',
      });

      expect(result.didMutate).toBe(true);
      // Should have params in the $t() call
      expect(result.content).toMatch(/\$t\('common\.backtick_value',\s*\{\s*value:\s*value\s*\}\)/);
    });
  });

  describe('Issue 2: Bound attribute with string concatenation should handle properly', () => {
    it('should extract bound attribute concatenation with interpolation', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <img :alt="'Hello ' + name" />
</template>
      `;

      const candidates = adapter.scan('/test/App.vue', content);
      
      // Should create candidate with interpolation
  const concatCandidate = candidates.find(c => c.text.includes('Hello'));
  expect(concatCandidate).toBeDefined();
      expect(concatCandidate?.interpolation).toBeDefined();
      expect(concatCandidate?.interpolation?.template).toMatch(/Hello \{name\}/);
    });

    it('should mutate bound attribute to $t() call with params', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <img :alt="'Hello ' + name" />
</template>
      `;

      const candidates = adapter.scan('/test/App.vue', content);
      const concatCandidate = candidates.find(c => c.text.includes('Hello'));
      expect(concatCandidate).toBeDefined();

      const transformCandidates: TransformCandidate[] = [{
        ...concatCandidate!,
        suggestedKey: 'common.hello',
        hash: 'abc123',
        status: 'pending',
      }];

      const result = adapter.mutate('/test/App.vue', content, transformCandidates, {
        mode: 'transform',
        config: defaultConfig,
        workspaceRoot: '/test',
      });

      expect(result.didMutate).toBe(true);
      // Should have params in the $t() call
      expect(result.content).toMatch(/:alt="\$t\('common\.hello',\s*\{\s*name:\s*name\s*\}\)"/);
    });
  });

  describe('Issue 3: Trailing punctuation before dynamic content should not be extracted', () => {
    it('should extract mixed expression without trailing opening bracket', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <p>{{ 'Items (' + count + ')' }}</p>
</template>
      `;

      const candidates = adapter.scan('/test/App.vue', content);
      
      // Should find mixed concatenation
      const mixedCandidate = candidates.find(c => c.text.includes('Items'));
      expect(mixedCandidate).toBeDefined();
      
      // Should NOT include the trailing '(' in the extracted text
      expect(mixedCandidate?.text).not.toContain('Items (');
      expect(mixedCandidate?.interpolation).toBeDefined();
      expect(mixedCandidate?.interpolation?.template).toMatch(/^Items \{/);
      expect(mixedCandidate?.interpolation?.template).not.toMatch(/Items \(/);
    });

    it('should mutate mixed expression preserving structural punctuation', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <p>{{ 'Items (' + count + ')' }}</p>
</template>
      `;

      const candidates = adapter.scan('/test/App.vue', content);
      const mixedCandidate = candidates.find(c => c.text.includes('Items'));
      expect(mixedCandidate).toBeDefined();

      const transformCandidates: TransformCandidate[] = [{
        ...mixedCandidate!,
        suggestedKey: 'common.items',
        hash: 'abc123',
        status: 'pending',
      }];

      const result = adapter.mutate('/test/App.vue', content, transformCandidates, {
        mode: 'transform',
        config: defaultConfig,
        workspaceRoot: '/test',
      });

      expect(result.didMutate).toBe(true);
      // The locale key should NOT contain the opening bracket
      expect(result.content).toMatch(/\$t\('common\.items'/);
      // The result should still have proper syntax
      expect(result.content).toMatch(/\$t\('common\.items',\s*\{[^}]+\}\)/);
    });
  });

  describe('Edge case: Template text followed by expression', () => {
    it('should handle adjacent template text and expression', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <p>User name: {{ userName }}</p>
</template>
      `;

      const candidates = adapter.scan('/test/App.vue', content);
      
  // Should find a combined interpolated candidate: "User name: {userName}"
  const combined = candidates.find(c => c.text.includes('User name'));
  expect(combined).toBeDefined();
  expect(combined?.interpolation).toBeDefined();
  expect(combined?.text).toMatch(/User name:\s*\{userName\}/);
    });
  });

  it('should extract only the label when template text contains SQL-like fragment', () => {
    const adapter = new VueAdapter(defaultConfig, '/test');
    const content = `
<template>
  <p>SQL-like: WHERE name = 'O\'Reilly'</p>
</template>
    `;

    const candidates = adapter.scan('/test/App.vue', content);
    const label = candidates.find(c => c.text && c.text.startsWith('SQL-like'));
    expect(label).toBeDefined();
    expect(label?.text).toBe('SQL-like:');
  });

  describe('Edge case: Mixed concatenation with spaces', () => {
    it('should preserve spaces in interpolation template', () => {
      const adapter = new VueAdapter(defaultConfig, '/test');
      const content = `
<template>
  <p>{{ 'Hello ' + name + '!' }}</p>
</template>
      `;

      const candidates = adapter.scan('/test/App.vue', content);
      
      const mixedCandidate = candidates.find(c => c.text.includes('Hello'));
      expect(mixedCandidate).toBeDefined();
      expect(mixedCandidate?.interpolation).toBeDefined();
      // Template should be "Hello {name}!" preserving the space after Hello
      expect(mixedCandidate?.interpolation?.template).toMatch(/^Hello \{name\}!$/);
    });
  });
});
