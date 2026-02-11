import { describe, it, expect, beforeEach } from 'vitest';
import { VueAdapter } from './vue.js';
import type { I18nConfig } from '../../config.js';
import { normalizeConfig } from '../../config/normalizer.js';
import { validateConfig } from '../../config/validator.js';

describe('VueAdapter', () => {
  let adapter: VueAdapter;
  let config: I18nConfig;

  beforeEach(() => {
    config = normalizeConfig({
      sourceLanguage: 'en',
      targetLanguages: ['es'],
      localesDir: './locales',
      include: ['src/**/*.{vue}'],
      frameworks: ['vue'],
      extraction: {
        translatableAttributes: ['placeholder', 'title', 'alt', 'label']
      }
    });

    const issues = validateConfig(config);
    expect(issues).toHaveLength(0);

    adapter = new VueAdapter(config, '/tmp');
  });

  describe('capabilities', () => {
    it('should declare correct capabilities', () => {
      expect(adapter.capabilities).toEqual({
        scan: true,
        mutate: true,
        diff: true,
      });
    });

    it('should declare correct extensions', () => {
      expect(adapter.extensions).toEqual(['.vue']);
    });

    it('should have correct id and name', () => {
      expect(adapter.id).toBe('vue');
      expect(adapter.name).toBe('Vue SFC');
    });
  });

  describe('checkDependencies', () => {
    it('should return vue-eslint-parser dependency check', () => {
      const deps = adapter.checkDependencies();
      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('vue-eslint-parser');
      expect(deps[0].installHint).toBe('npm install --save-dev vue-eslint-parser');
      // Note: available will depend on whether vue-eslint-parser is installed
    });
  });

  describe('scan', () => {
    it('should scan template text content', () => {
      const content = `
<template>
  <div>
    <h1>Hello World</h1>
    <p>This is a test message</p>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);

      expect(candidates.length).toBeGreaterThan(0);
      const textCandidate = candidates.find(c => c.text === 'Hello World');
      expect(textCandidate).toBeDefined();
      expect(textCandidate?.kind).toBe('jsx-text');
    });

    it('should scan translatable attributes', () => {
      const content = `
<template>
  <div>
    <input placeholder="Enter your name" />
    <button title="Click me">Submit</button>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);

      expect(candidates.length).toBeGreaterThan(0);
      const placeholderCandidate = candidates.find(c => c.context === 'placeholder');
      expect(placeholderCandidate).toBeDefined();
      expect(placeholderCandidate?.text).toBe('Enter your name');
      expect(placeholderCandidate?.kind).toBe('jsx-attribute');
    });

    it('should handle fallback extraction when parser is not available', () => {
      // Mock the parser as unavailable
      const originalGetVueParser = (adapter as any).getVueEslintParser;
      (adapter as any).getVueEslintParser = () => null;

      const content = `
<template>
  <div>
    <h1>Simple text</h1>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);

      // Should still find candidates with fallback extraction
      expect(candidates.length).toBeGreaterThan(0);

      // Restore original method
      (adapter as any).getVueEslintParser = originalGetVueParser;
    });

    it('should skip fallback literals in script expressions', () => {
      const content = `
<script>
export default {
  setup() {
    const title = t('known.key') || 'Fallback text';
    const alt = t('known.key') ?? 'Alt fallback';
    return { title, alt };
  }
}
</script>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      expect(candidates.some(c => c.text === 'Fallback text')).toBe(false);
      expect(candidates.some(c => c.text === 'Alt fallback')).toBe(false);
    });

    it('should extract attribute literals from fallback parsing even with malformed template', () => {
      const originalGetVueParser = (adapter as any).getVueEslintParser;
      (adapter as any).getVueEslintParser = () => null;

      const content = `
<template>
  <div>
    <div>{{ $t('common.key') }}per ? '✓' : '✗' }}</div>
  <img :alt="\`Property image \${index + 1}\`" />
    <img alt="VR Preview" />
    <span>360°</span>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
  expect(candidates.some(c => c.text === 'Property image')).toBe(true);
  expect(candidates.some(c => c.text === 'VR Preview')).toBe(true);

      (adapter as any).getVueEslintParser = originalGetVueParser;
    });
  });

  describe('mutate', () => {
    it('should transform template text', () => {
      const content = `
<template>
  <div>
    <h1>Hello World</h1>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      const textCandidate = candidates.find(c => c.text === 'Hello World');
      expect(textCandidate).toBeDefined();

      if (textCandidate) {
        const transformCandidate = {
          ...textCandidate,
          suggestedKey: 'hello_world',
          hash: 'hash123',
          status: 'pending' as const,
        };

        const result = adapter.mutate('/test/Component.vue', content, [transformCandidate], {
          config,
          workspaceRoot: '/tmp',
          translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
          allowFallback: true
        });

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`{{ $t('hello_world') }}`);
        expect(transformCandidate.status).toBe('applied');
      }
    });

    it('should transform attributes', () => {
      const content = `
<template>
  <div>
    <input placeholder="Enter name" />
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      const attrCandidate = candidates.find(c => c.context === 'placeholder');
      expect(attrCandidate).toBeDefined();

      if (attrCandidate) {
        const transformCandidate = {
          ...attrCandidate,
          suggestedKey: 'enter_name',
          hash: 'hash456',
          status: 'pending' as const,
        };

        const result = adapter.mutate('/test/Component.vue', content, [transformCandidate], {
          config,
          workspaceRoot: '/tmp',
          translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
          allowFallback: true
        });

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`:placeholder="$t('enter_name')"`);
        expect(transformCandidate.status).toBe('applied');
      }
    });

    it('should return edits array', () => {
      const content = `
<template>
  <div>
    <h1>Test</h1>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      const textCandidate = candidates.find(c => c.text === 'Test');

      if (textCandidate) {
        const transformCandidate = {
          ...textCandidate,
          suggestedKey: 'test_key',
          hash: 'hash789',
          status: 'pending' as const,
        };

        const result = adapter.mutate('/test/Component.vue', content, [transformCandidate], {
          config,
          workspaceRoot: '/tmp',
          translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
          allowFallback: true
        });

        expect(result.edits).toHaveLength(1);
        expect(result.edits[0]).toHaveProperty('start');
        expect(result.edits[0]).toHaveProperty('end');
        expect(result.edits[0]).toHaveProperty('replacement');
      }
    });
  });
});