import { describe, it, expect } from 'vitest';
import { VueWriter } from './VueWriter.js';
import type { TransformCandidate } from './types.js';

describe('VueWriter', () => {
  const writer = new VueWriter();

  describe('canHandle', () => {
    it('returns true for .vue files', () => {
      expect(writer.canHandle('App.vue')).toBe(true);
      expect(writer.canHandle('src/components/Button.vue')).toBe(true);
    });

    it('returns false for non-Vue files', () => {
      expect(writer.canHandle('App.tsx')).toBe(false);
      expect(writer.canHandle('App.js')).toBe(false);
      expect(writer.canHandle('App.html')).toBe(false);
    });
  });

  describe('transform', () => {
    describe('Text Content Transformation', () => {
      it('transforms template text to i18n calls', async () => {
        const content = `
<template>
  <div>
    <h1>Hello World</h1>
    <p>Some description</p>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello World',
            suggestedKey: 'title',
            position: { line: 3, column: 8 },
            kind: 'jsx-text',
            status: 'pending',
          },
          {
            text: 'Some description',
            suggestedKey: 'description',
            position: { line: 4, column: 8 },
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<h1>{{ $t('title') }}</h1>`);
        expect(result.content).toContain(`<p>{{ $t('description') }}</p>`);
      });

      it('handles multi-line text', async () => {
        const content = `
<template>
  <div>
    <p>This is a
       multi-line
       message</p>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'This is a\n       multi-line\n       message',
            suggestedKey: 'multiline.message',
            position: { line: 3, column: 8 },
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<p>{{ $t('multiline.message') }}</p>`);
      });
    });

    describe('Attribute Transformation', () => {
      it('transforms static attributes to dynamic bindings', async () => {
        const content = `
<template>
  <input placeholder="Enter your name" title="Name field" />
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Enter your name',
            suggestedKey: 'form.placeholder.name',
            position: { line: 2, column: 22 },
            kind: 'jsx-attribute',
            status: 'pending',
          },
          {
            text: 'Name field',
            suggestedKey: 'form.title.name',
            position: { line: 2, column: 45 },
            kind: 'jsx-attribute',
            status: 'pending',
          },
        ];

        const result = await writer.transform('Form.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`:placeholder="$t('form.placeholder.name')"`);
        expect(result.content).toContain(`:title="$t('form.title.name')"`);
      });

      it('handles attributes with single quotes', async () => {
        const content = `
<template>
  <input placeholder='Enter name' title='Field title' />
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Enter name',
            suggestedKey: 'placeholder',
            position: { line: 2, column: 22 },
            kind: 'jsx-attribute',
            status: 'pending',
          },
        ];

        const result = await writer.transform('Form.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`:placeholder="$t('placeholder')"`);
      });

      it('handles complex attribute names', async () => {
        const content = `
<template>
  <input data-placeholder="Complex attribute" />
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Complex attribute',
            suggestedKey: 'data.placeholder',
            position: { line: 2, column: 25 },
            kind: 'jsx-attribute',
            status: 'pending',
          },
        ];

        const result = await writer.transform('Form.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`:data-placeholder="$t('data.placeholder')"`);
      });
    });

    describe('Expression Transformation', () => {
      it('transforms expressions in template literals', async () => {
        const content = `
<template>
  <div>
    <p>{{ greeting || 'Hello' }}</p>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello',
            suggestedKey: 'default.greeting',
            position: { line: 3, column: 21 },
            kind: 'jsx-expression',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<p>{{ greeting || $t('default.greeting') }}</p>`);
      });
    });

    describe('Script Transformation', () => {
      it('transforms string literals in script setup', async () => {
        const content = `
<template>
  <div>{{ message }}</div>
</template>

<script setup>
const message = 'Hello from script'
const title = 'Page Title'
</script>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello from script',
            suggestedKey: 'script.message',
            position: { line: 6, column: 16 },
            kind: 'call-expression',
            status: 'pending',
          },
          {
            text: 'Page Title',
            suggestedKey: 'page.title',
            position: { line: 7, column: 13 },
            kind: 'call-expression',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`const message = $t('script.message')`);
        expect(result.content).toContain(`const title = $t('page.title')`);
      });

      it('transforms string literals in options API', async () => {
        const content = `
<template>
  <div>{{ message }}</div>
</template>

<script>
export default {
  data() {
    return {
      message: 'Hello from options',
      title: 'Options Title'
    }
  }
}
</script>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello from options',
            suggestedKey: 'options.message',
            position: { line: 8, column: 18 },
            kind: 'call-expression',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`message: $t('options.message')`);
      });
    });

    describe('Position Handling', () => {
      it('handles 0-based column positions', async () => {
        const content = `
<template>
  <div>
    <h1>Hello</h1>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello',
            suggestedKey: 'greeting',
            position: { line: 3, column: 8 }, // 0-based
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<h1>{{ $t('greeting') }}</h1>`);
      });

      it('handles 1-based column positions', async () => {
        const content = `
<template>
  <div>
    <h1>Hello</h1>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello',
            suggestedKey: 'greeting',
            position: { line: 3, column: 9 }, // 1-based
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<h1>{{ $t('greeting') }}</h1>`);
      });

      it('handles trimmed text with surrounding whitespace', async () => {
        const content = `
<template>
  <div>
    <h1>  Hello World  </h1>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello World', // trimmed
            suggestedKey: 'title',
            position: { line: 3, column: 10 }, // points to "Hello"
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<h1>  {{ $t('title') }}  </h1>`);
      });
    });

    describe('Candidate Status Handling', () => {
      it('only transforms pending and existing candidates', async () => {
        const content = `
<template>
  <div>
    <h1>Pending</h1>
    <h2>Skipped</h2>
    <h3>Existing</h3>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Pending',
            suggestedKey: 'pending',
            position: { line: 3, column: 8 },
            kind: 'jsx-text',
            status: 'pending',
          },
          {
            text: 'Skipped',
            suggestedKey: 'skipped',
            position: { line: 4, column: 8 },
            kind: 'jsx-text',
            status: 'skipped',
          },
          {
            text: 'Existing',
            suggestedKey: 'existing',
            position: { line: 5, column: 8 },
            kind: 'jsx-text',
            status: 'existing',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<h1>{{ $t('pending') }}</h1>`);
        expect(result.content).toContain(`<h2>Skipped</h2>`); // not transformed
        expect(result.content).toContain(`<h3>{{ $t('existing') }}</h3>`);
      });

      it('updates candidate status to applied when successful', async () => {
        const content = `
<template>
  <div>
    <h1>Hello</h1>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello',
            suggestedKey: 'greeting',
            position: { line: 3, column: 8 },
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(candidates[0].status).toBe('applied');
      });
    });

    describe('Sorting and Offset Handling', () => {
      it('processes candidates in reverse order to avoid offset issues', async () => {
        const content = `
<template>
  <div>
    <h1>First</h1>
    <h2>Second</h2>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'First',
            suggestedKey: 'first',
            position: { line: 3, column: 8 },
            kind: 'jsx-text',
            status: 'pending',
          },
          {
            text: 'Second',
            suggestedKey: 'second',
            position: { line: 4, column: 8 },
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(true);
        expect(result.content).toContain(`<h1>{{ $t('first') }}</h1>`);
        expect(result.content).toContain(`<h2>{{ $t('second') }}</h2>`);
      });
    });

    describe('No Mutations', () => {
      it('returns original content when no candidates to transform', async () => {
        const content = `
<template>
  <div>
    <h1>Hello</h1>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(false);
        expect(result.content).toBe(content);
      });

      it('returns original content when all candidates are skipped', async () => {
        const content = `
<template>
  <div>
    <h1>Hello</h1>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello',
            suggestedKey: 'greeting',
            position: { line: 3, column: 8 },
            kind: 'jsx-text',
            status: 'skipped',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(false);
        expect(result.content).toBe(content);
      });
    });

    describe('Error Handling', () => {
      it('handles invalid positions gracefully', async () => {
        const content = `
<template>
  <div>
    <h1>Hello</h1>
  </div>
</template>
`;

        const candidates: TransformCandidate[] = [
          {
            text: 'Hello',
            suggestedKey: 'greeting',
            position: { line: 10, column: 100 }, // Invalid position
            kind: 'jsx-text',
            status: 'pending',
          },
        ];

        const result = await writer.transform('App.vue', content, candidates);

        expect(result.didMutate).toBe(false);
        expect(result.content).toBe(content);
        expect(candidates[0].status).toBe('pending'); // Status unchanged
      });
    });
  });
});