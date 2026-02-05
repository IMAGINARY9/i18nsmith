
import { describe, it, expect, beforeEach } from 'vitest';
import { VueParser } from './parsers/VueParser';
import type { I18nConfig } from './config/types.js';
import { Project } from 'ts-morph';
import path from 'path';

describe('VueParser', () => {
    let config: I18nConfig;
    let parser: VueParser;
    let project: Project;

    beforeEach(() => {
        config = {
            sourceLanguage: 'en',
            targetLanguages: ['de', 'fr'],
            localesDir: 'locales',
            include: ['src/**/*.{vue,ts,tsx,js,jsx}'],
            extraction: {
                minLetterCount: 1,
                minLetterRatio: 0.5,
                minTextLength: 2,
                allowHtmlEntities: true,
                vueAttributes: ['placeholder', 'title', 'aria-label', 'alt'],
            },
        } as I18nConfig;

        parser = new VueParser(config, '/tmp');
        project = new Project({ skipAddingFilesFromTsConfig: true });
    });

    describe('Template Text Extraction', () => {
        it('extracts text from template', () => {
            const content = `
<template>
  <div>
    <h1>Hello World</h1>
    <p>Some text</p>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);

            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello World');
            expect(texts).toContain('Some text');
        });

        it('extracts multi-line text', () => {
            const content = `
<template>
  <div>
    <p>This is a
       multi-line
       text</p>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('This is a\n       multi-line\n       text');
        });

        it('ignores HTML entities when configured', () => {
            const content = `
<template>
  <div>
    <p>&nbsp;Hello&nbsp;World&nbsp;</p>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello World'); // Entities should be decoded
        });

        it('handles expressions in text', () => {
            const content = `
<template>
  <div>
    <p>Hello {{ user.name || 'Guest' }}</p>
    <p>Count: {{ items.length }}</p>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello ');
            expect(texts).toContain('Count: ');
            // Expressions should not be extracted as text
            expect(texts).not.toContain('user.name || \'Guest\'');
        });
    });

    describe('Attribute Extraction', () => {
        it('extracts configured attributes', () => {
            const content = `
<template>
  <input placeholder="Enter name" title="User Name" aria-label="Name field" />
</template>
`;
            const candidates = parser.parse('/src/Form.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Enter name');
            expect(texts).toContain('User Name');
            expect(texts).toContain('Name field');
        });

        it('ignores non-configured attributes', () => {
            const content = `
<template>
  <input placeholder="Enter name" data-testid="name-input" custom-attr="value" />
</template>
`;
            const candidates = parser.parse('/src/Form.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Enter name');
            expect(texts).not.toContain('name-input');
            expect(texts).not.toContain('value');
        });

        it('handles dynamic attributes', () => {
            const content = `
<template>
  <input :placeholder="dynamicPlaceholder" :title="computedTitle" />
</template>
`;
            const candidates = parser.parse('/src/Form.vue', content, project);
            const texts = candidates.map(c => c.text);
            // Dynamic attributes should not be extracted as static text
            expect(texts).not.toContain('dynamicPlaceholder');
            expect(texts).not.toContain('computedTitle');
        });
    });

    describe('Script Extraction', () => {
        it('extracts string literals from script setup', () => {
            const content = `
<template>
  <div>{{ message }}</div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const message = ref('Hello from script')
const title = 'Page Title'
</script>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello from script');
            expect(texts).toContain('Page Title');
        });

        it('extracts from options API', () => {
            const content = `
<template>
  <div>{{ message }}</div>
</template>

<script>
export default {
  data() {
    return {
      message: 'Hello from options API',
      title: 'Page Title'
    }
  }
}
</script>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello from options API');
            expect(texts).toContain('Page Title');
        });

        it('extracts from composition API', () => {
            const content = `
<template>
  <div>{{ message }}</div>
</template>

<script>
import { ref } from 'vue'

export default {
  setup() {
    const message = ref('Hello from composition API')
    const title = 'Page Title'
    return { message, title }
  }
}
</script>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello from composition API');
            expect(texts).toContain('Page Title');
        });
    });

    describe('Directive Handling', () => {
        it('handles v-html with string literals', () => {
            const content = `
<template>
  <div>
    <p v-html="htmlContent"></p>
  </div>
</template>

<script setup>
const htmlContent = '<strong>Bold text</strong>'
</script>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('<strong>Bold text</strong>');
        });

        it('ignores v-text directives', () => {
            const content = `
<template>
  <div>
    <p v-text="message"></p>
    <span>Visible text</span>
  </div>
</template>

<script setup>
const message = 'This should not be extracted'
</script>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Visible text');
            expect(texts).not.toContain('This should not be extracted');
        });
    });

    describe('Slot Handling', () => {
        it('extracts slot content', () => {
            const content = `
<template>
  <div>
    <slot name="header">Default Header</slot>
    <slot>Default Content</slot>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Default Header');
            expect(texts).toContain('Default Content');
        });

        it('handles named slots', () => {
            const content = `
<template>
  <div>
    <slot name="title">Page Title</slot>
    <slot name="actions">
      <button>Save</button>
    </slot>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Page Title');
            expect(texts).toContain('Save');
        });
    });

    describe('Comment and Invisible Content', () => {
        it('ignores HTML comments', () => {
            const content = `
<template>
  <div>
    <!-- This is a comment -->
    <p>Visible text</p>
    <!-- <p>Hidden text</p> -->
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Visible text');
            expect(texts).not.toContain('This is a comment');
            expect(texts).not.toContain('Hidden text');
        });

        it('ignores script and style content', () => {
            const content = `
<template>
  <div>Visible</div>
</template>

<script>
const hidden = 'This should not be extracted'
</script>

<style>
.hidden { display: none; }
</style>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Visible');
            expect(texts).not.toContain('This should not be extracted');
            expect(texts).not.toContain('hidden');
        });
    });

    describe('Edge Cases', () => {
        it('handles empty templates', () => {
            const content = `
<template>
</template>

<script setup>
const message = 'Hello'
</script>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello');
        });

        it('handles malformed templates gracefully', () => {
            const content = `
<template>
  <div>
    <unclosed>
    <p>Valid text</p>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Valid text');
        });

        it('handles mixed quotes', () => {
            const content = `
<template>
  <input placeholder='Single quotes' title="Double quotes" />
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Single quotes');
            expect(texts).toContain('Double quotes');
        });

        it('respects extraction configuration', () => {
            const strictConfig = {
                ...config,
                extraction: {
                    ...config.extraction,
                    minTextLength: 10, // Require longer text
                },
            } as I18nConfig;

            const strictParser = new VueParser(strictConfig, '/tmp');

            const content = `
<template>
  <div>
    <p>Short</p>
    <p>This is a longer text that should be extracted</p>
  </div>
</template>
`;
            const candidates = strictParser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).not.toContain('Short');
            expect(texts).toContain('This is a longer text that should be extracted');
        });
    });

    describe('Parser Fallback', () => {
        it('falls back to regex when vue-eslint-parser is unavailable', () => {
            // Mock the parser to be unavailable
            const originalGetVueParser = (parser as any).getVueEslintParser;
            (parser as any).getVueEslintParser = () => null;

            const content = `
<template>
  <div>
    <h1>Hello World</h1>
    <p>Some text</p>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);
            const texts = candidates.map(c => c.text);
            expect(texts).toContain('Hello World');
            expect(texts).toContain('Some text');

            // Restore original function
            (parser as any).getVueEslintParser = originalGetVueParser;
        });
    });

    describe('Position Information', () => {
        it('provides accurate position information', () => {
            const content = `
<template>
  <div>
    <h1>Hello World</h1>
    <p>Some text</p>
  </div>
</template>
`;
            const candidates = parser.parse('/src/App.vue', content, project);

            const helloCandidate = candidates.find(c => c.text === 'Hello World');
            expect(helloCandidate).toBeDefined();
            expect(helloCandidate!.position.line).toBe(3); // Line numbers are 1-based
            expect(helloCandidate!.position.column).toBeGreaterThan(0);
        });
    });
});
