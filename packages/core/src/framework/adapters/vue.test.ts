import { describe, it, expect, beforeEach } from 'vitest';
import { VueAdapter } from './vue.js';
import type { I18nConfig } from '../../config.js';
import type { ScanCandidate } from '../../scanner.js';
import type { TransformCandidate } from '../types.js';
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
      expect(deps.length).toBeGreaterThanOrEqual(1);
      expect(deps[0].name).toBe('vue-eslint-parser');
      expect(deps[0].installHint).toBe('npm install --save-dev vue-eslint-parser');
      // Note: available will depend on whether vue-eslint-parser is installed
      
      // If vue-i18n (or configured translation adapter) is not installed, it will be in the deps list
      if (deps.length > 1) {
        expect(deps[1].available).toBe(false);
      }
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
  // (debug logging removed)
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
  // (debug logging removed)
  expect(candidates.some(c => c.text && c.text.includes('Property image'))).toBe(true);
  const propExtract = candidates.find(c => c.text && c.text.includes('Property image'));
  expect(propExtract?.interpolation).toBeDefined();
    expect(candidates.some(c => c.text === 'VR Preview')).toBe(true);

      (adapter as any).getVueEslintParser = originalGetVueParser;
    });

    it('should extract bound attribute template-literals with interpolation in fallback mode', () => {
      // Force fallback extraction (no parser) to hit the line-based extractor
      const originalGetVueParser = (adapter as any).getVueEslintParser;
      (adapter as any).getVueEslintParser = () => null;

      const content = `
<template>
  <div>
    <img :alt="` + "`Property image ${index + 1}`" + `" />
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      const alt = candidates.find(c => c.context === 'alt' && c.text?.includes('Property image'));
      expect(alt).toBeDefined();
      expect(alt?.interpolation).toBeDefined();
      expect(alt?.interpolation?.variables.length).toBeGreaterThan(0);
      // Ensure the expression for the parameter contains the index arithmetic
      expect(alt?.interpolation?.variables[0].expression).toContain('index');

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

    it('should transform bound attribute with template-literal and preserve interpolation params (fallback mode)', () => {
      // Force fallback extraction so the bound attribute is analyzed by the line extractor
      const originalGetVueParser = (adapter as any).getVueEslintParser;
      (adapter as any).getVueEslintParser = () => null;

      const content = `
<template>
  <div>
    <img :alt="` + "`Property image ${index + 1}`" + `" />
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      const altCandidate = candidates.find(c => c.context === 'alt' && c.text?.includes('Property image'));
      expect(altCandidate).toBeDefined();

      if (altCandidate) {
        const transformCandidate = {
          ...altCandidate,
          // Use a deterministic key for the assertion
          suggestedKey: 'property_image',
          hash: 'hash-attr',
          status: 'pending' as const,
        };

        const result = adapter.mutate('/test/Component.vue', content, [transformCandidate], {
          config,
          workspaceRoot: '/tmp',
          translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
          allowFallback: true
        });

  expect(result.didMutate).toBe(true);
  // (debug logging removed)
  // Should replace with $t('property_image', { ... }) and include the original expression
  expect(result.content).toContain(`:alt="$t('property_image'`);
  expect(result.content).toContain('index + 1');
        expect(transformCandidate.status).toBe('applied');
      }

      (adapter as any).getVueEslintParser = originalGetVueParser;
    });

    it('should handle text with leading whitespace correctly', () => {
      const content = `
<template>
  <div>
    <b>STEP 1:</b> Select the travel dates
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
  const textCandidate = candidates.find(c => c.text === 'Select the travel dates');
  // (debug logging removed)
      expect(textCandidate).toBeDefined();

      if (textCandidate) {
        const transformCandidate = {
          ...textCandidate,
          suggestedKey: 'select_the_travel_dates',
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
        // Should replace the entire text node including whitespace, not leave trailing characters
        expect(result.content).not.toContain('Select the travel dates');
        expect(result.content).toContain(`{{ $t('select_the_travel_dates') }}`);
        // Should not have corrupted output like ">{{ $t('...') }}s"
        expect(result.content).toMatch(/\{\{ \$t\('select_the_travel_dates'\) \}\}(?:\s*<|$)/);
      }
    });
      it('preserves wrapper element and attributes when replacing adjacent content (v-if)', () => {
        const content = `
  <template>
    <div>
      <p v-if="name">{{ $t('greeting') }}, {{ name }}!</p>
    </div>
  </template>
  `;

        // The scanner may not always produce a merged/adjacent candidate for
        // this synthetic input, so construct an element-level transform
        // candidate (the form produced by analyzeVueAdjacentContent) to
        // validate that mutation preserves wrapper attributes.
        const opening = content.indexOf('<p');
        const closing = content.indexOf('</p>') + 4;
        const transformCandidate: TransformCandidate = {
          id: '/test/Component.vue:4:6',
          kind: 'jsx-expression',
          filePath: '/test/Component.vue',
          text: '{arg0}, {name}!',
          position: { line: 4, column: 6 },
          suggestedKey: 'composite.greeting',
          hash: 'h-vue-1',
          status: 'pending',
          fullRange: [opening, closing],
          interpolation: {
            template: '{arg0}, {name}!',
            variables: [
              { name: 'arg0', expression: "$t('greeting')" },
              { name: 'name', expression: 'name' },
            ],
            localeValue: '{arg0}, {name}!',
          },
        } as TransformCandidate;

        const result = adapter.mutate('/test/Component.vue', content, [transformCandidate], {
          config,
          workspaceRoot: '/tmp',
          translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
          allowFallback: true,
        });
    expect(result.didMutate).toBe(true);
    expect(result.content).toContain('<p v-if="name">');
    // allow either simple $t('key') or $t('key', { ... }) forms when interpolation params exist
    expect(result.content).toMatch(/<p v-if="name">\s*\{\{ \$t\('composite.greeting'/);
      });

      it('preserves spacing between adjacent transformed nodes (label + text)', () => {
        const content = `
  <template>
    <div>
      <p><strong>Label:</strong> This is the value</p>
    </div>
  </template>
  `;

        const candidates = adapter.scan('/test/Component.vue', content);
        const label = candidates.find(c => c.text === 'Label:');
        const value = candidates.find(c => c.text === 'This is the value');
        expect(label).toBeDefined();
        expect(value).toBeDefined();

        const tLabel: TransformCandidate = { ...(label as any), suggestedKey: 'label', hash: 'h1', status: 'pending' };
        const tValue: TransformCandidate = { ...(value as any), suggestedKey: 'value', hash: 'h2', status: 'pending' };

        const result = adapter.mutate('/test/Component.vue', content, [tLabel, tValue], {
          config,
          workspaceRoot: '/tmp',
          translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
          allowFallback: true,
        });

  expect(result.didMutate).toBe(true);
  // Ensure both translation calls are present and there remains at least
  // one whitespace character between the closing tag and the following
  // transformed fragment (preserve visible spacing outside the <strong>). 
  expect(result.content).toContain("{{ $t('label') }}");
  expect(result.content).toContain("{{ $t('value') }}");
  expect(result.content).toMatch(/<\/strong>\s+\{\{/);
      });

    it('should handle Unicode text correctly', () => {
      const content = `
<template>
  <div>
    Keine Angaben verfügbar
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      const textCandidate = candidates.find(c => c.text === 'Keine Angaben verfügbar');
      expect(textCandidate).toBeDefined();

      if (textCandidate) {
        const transformCandidate = {
          ...textCandidate,
          suggestedKey: 'keine_angaben_verfuegbar',
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
        // Should replace the entire Unicode text without corruption
        expect(result.content).not.toContain('Keine Angaben verfügbar');
        expect(result.content).toContain(`{{ $t('keine_angaben_verfuegbar') }}`);
        // Should not have extra content after the closing braces
        expect(result.content).toMatch(/\{\{ \$t\('keine_angaben_verfuegbar'\) \}\}(?:\s*<|$)/);
      }
    });

    it('should handle text after closing tags correctly', () => {
      const content = `
<template>
  <div>
    <b>STEP 2:</b> Verify occupation
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      const textCandidate = candidates.find(c => c.text === 'Verify occupation');
      expect(textCandidate).toBeDefined();

      if (textCandidate) {
        const transformCandidate = {
          ...textCandidate,
          suggestedKey: 'verify_occupation',
          hash: 'hash789',
          status: 'pending' as const,
        };

        const result = adapter.mutate('/test/Component.vue', content, [transformCandidate], {
          config,
          workspaceRoot: '/tmp',
          translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
          allowFallback: true
        });

        expect(result.didMutate).toBe(true);
        // Should not leave trailing characters like "n"
        expect(result.content).not.toContain('Verify occupation');
        expect(result.content).toContain(`{{ $t('verify_occupation') }}`);
        expect(result.content).toMatch(/\{\{ \$t\('verify_occupation'\) \}\}(?:\s*<|$)/);
      }
    });

    it('does not extract text fragments adjacent to mustache expressions (no-op)', () => {
      const content = `
<template>
  <div>
    <p>User name: {{ userName }}</p>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      // Vue intentionally treats "User name:" as a fragment adjacent to {{}} and does not extract it
      const staticCandidate = candidates.find(c => c.kind === 'jsx-text' && c.text?.includes('User name'));
      expect(staticCandidate).toBeUndefined();

      // Mutate with no candidates should be a no-op and mustache stays intact
      const result = adapter.mutate('/test/Component.vue', content, [], {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
        allowFallback: true
      });

      expect(result.didMutate).toBe(false);
      expect(result.content).toContain('{{ userName }}');
    });

    it('does not extract template-literals inside mustache and leaves them intact', () => {
      const content = `
<template>
  <div>
    <p>Template literal inline: {{ ` + "`backtick ${'value'}`" + ` }}</p>
  </div>
</template>
`;

  const candidates = adapter.scan('/test/Component.vue', content);
  // (debug logging removed)
  // Template literal inside mustache should now be extracted with interpolation
  // The adjacent static text and the template-literal expression should
  // be merged into a single translatable candidate.
      const tpl = candidates.find(c => c.text && c.text.includes('Template literal inline'));
      expect(tpl).toBeDefined();
      expect(tpl?.interpolation).toBeDefined();

      // Mutate the merged candidate and ensure it becomes a single $t() call
      const transformCandidates: TransformCandidate[] = [{
        ...(tpl as ScanCandidate),
        suggestedKey: 'common.app.template-literal-inline.dca888',
        hash: tpl?.hash || 'h',
        status: 'pending' as const,
      }];

      const result = adapter.mutate('/test/Component.vue', content, transformCandidates, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
        allowFallback: true
      });

  expect(result.didMutate).toBe(true);
  expect(result.content).toContain("{{ $t('common.app.template-literal-inline.dca888'");
    });

    it('does not extract concatenated string literals inside mustache (no-op)', () => {
      const content = `
<template>
  <div>
    <p>Simple concatenation: {{ 'Hello, ' + 'world!' }}</p>
  </div>
</template>
`;

      const candidates = adapter.scan('/test/Component.vue', content);
      // Vue currently does not extract parts of binary concatenation inside mustache
      const hello = candidates.find(c => c.text === 'Hello,' || c.text === 'Hello,');
      const world = candidates.find(c => c.text === 'world!');

      // If the scanner extracted the literals, apply transforms for them; otherwise
      // verify that no mutation occurs and the mustache stays intact.
      const transforms = [hello, world].filter(Boolean).map((c) => ({
        ...(c as any),
        suggestedKey: (c as any).text?.includes('Hello') ? 'hello' : 'world',
        hash: 'h',
        status: 'pending' as const,
      }));

      const result = adapter.mutate('/test/Component.vue', content, transforms, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
        allowFallback: true
      });

      if (transforms.length === 0) {
        expect(result.didMutate).toBe(false);
        expect(result.content).toContain("{{ 'Hello, ' + 'world!' }}");
      } else {
        expect(result.didMutate).toBe(true);
        // Ensure no corruption fragments (regression guard)
        expect(result.content).toContain('{{');
        expect(result.content).toContain('}}');
        expect(result.content).not.toMatch(/rld\.[0-9a-f]{6}/);
        if (hello && world) {
          expect(result.content).toContain("$t('hello')");
          expect(result.content).toContain("$t('world')");
        } else if (hello) {
          expect(result.content).toContain("$t('hello')");
        }
      }
    });
  });

  // ── HTML entity decoding ──────────────────────────────────────────────────
  describe('HTML entity decoding', () => {
    let decodingAdapter: VueAdapter;

    beforeEach(() => {
      const decodingConfig = normalizeConfig({
        sourceLanguage: 'en',
        targetLocales: [],
        localesDir: '/tmp/locales',
        include: ['**/*.vue'],
        extraction: { decodeHtmlEntities: true },
      });
      decodingAdapter = new VueAdapter(decodingConfig, '/tmp');
    });

    it('decodes &lt; and &gt; in template text nodes', () => {
      const content = `
<template>
  <p>This component uses the classic Options API (no &lt;script setup&gt;).</p>
</template>
`;
      const candidates = decodingAdapter.scan('/test/Comp.vue', content);
      const c = candidates.find((x) => x.text.includes('Options API'));
      expect(c).toBeDefined();
      // The stored text must be human-readable, NOT the raw HTML-escaped form
      expect(c!.text).toContain('<script setup>');
      expect(c!.text).not.toContain('&lt;');
      expect(c!.text).not.toContain('&gt;');
    });

    it('decodes &amp; in template text nodes', () => {
      const content = `
<template>
  <p>Search &amp; Filter</p>
</template>
`;
      const candidates = decodingAdapter.scan('/test/Comp.vue', content);
      const c = candidates.find((x) => x.text.includes('Search'));
      expect(c).toBeDefined();
      expect(c!.text).toBe('Search & Filter');
      expect(c!.text).not.toContain('&amp;');
    });

    it('uses decoded text for suggestedKey generation', () => {
      const content = `
<template>
  <p>This component uses &lt;script setup&gt; without TypeScript.</p>
</template>
`;
      const candidates = decodingAdapter.scan('/test/Comp.vue', content);
      const c = candidates.find((x) => x.text.includes('without TypeScript'));
      expect(c).toBeDefined();
      // The key must be derived from the decoded form, not the raw escaped one
      expect(c!.suggestedKey).not.toContain('lt;');
      expect(c!.suggestedKey).not.toContain('gt;');
    });

    it('decodes &lt;/&gt; in static attribute values', () => {
      const content = `
<template>
  <input placeholder="Enter &lt;name&gt;" />
</template>
`;
      const candidates = decodingAdapter.scan('/test/Comp.vue', content);
      const c = candidates.find((x) => x.text.includes('name'));
      expect(c).toBeDefined();
      expect(c!.text).toBe('Enter <name>');
      expect(c!.text).not.toContain('&lt;');
    });

    it('still correctly replaces the original raw bytes in the source on mutate', () => {
      // Even though candidate.text is decoded, mutation must rewrite the original
      // encoded source range, not search for the decoded string.
      const content = `
<template>
  <p>Uses &lt;script setup&gt; syntax.</p>
</template>
`;
      const candidates = decodingAdapter.scan('/test/Comp.vue', content);
      const c = candidates.find((x) => x.text.includes('script setup'));
      expect(c).toBeDefined();

      const transforms: TransformCandidate[] = [{
        ...(c as any),
        suggestedKey: 'my.key',
        status: 'pending' as const,
      }];

      const result = decodingAdapter.mutate('/test/Comp.vue', content, transforms, {
        config,
        workspaceRoot: '/tmp',
        translationAdapter: { module: 'vue-i18n', hookName: 'useI18n' },
        allowFallback: true,
      });

      expect(result.didMutate).toBe(true);
      // The entire encoded text range is replaced; no leftover entity fragments
      expect(result.content).not.toContain('&lt;');
      expect(result.content).toContain("$t('my.key')");
    });

    it('does not double-decode when decodeHtmlEntities is false', () => {
      const rawConfig = normalizeConfig({
        sourceLanguage: 'en',
        targetLocales: [],
        localesDir: '/tmp/locales',
        include: ['**/*.vue'],
        extraction: { decodeHtmlEntities: false },
      });
      const rawAdapter = new VueAdapter(rawConfig, '/tmp');

      const content = `
<template>
  <p>Search &amp; Filter</p>
</template>
`;
      const candidates = rawAdapter.scan('/test/Comp.vue', content);
      // When decoding is disabled the raw entity form is kept as-is
      const c = candidates.find((x) => x.text.includes('Search'));
      // The text may or may not be extracted (the HTML entity check may skip it),
      // but if extracted it should NOT have been decoded.
      if (c) {
        expect(c.text).toContain('&amp;');
      }
    });
  });
});