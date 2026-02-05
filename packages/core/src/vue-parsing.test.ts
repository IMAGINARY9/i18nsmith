
import { describe, it, expect } from 'vitest';
import { VueParser } from './parsers/VueParser';
import { I18nConfig } from './config';
import { Project } from 'ts-morph';
import path from 'path';

describe('VueParser', () => {
    const config = {
        sourceLanguage: 'en',
    } as I18nConfig;

    const parser = new VueParser(config, '/tmp');
    const project = new Project({ skipAddingFilesFromTsConfig: true });

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

    it('extracts attributes', () => {
        const content = `
<template>
  <input placeholder="Enter name" title="User Name" />
</template>
`;
        const candidates = parser.parse('/src/Form.vue', content, project);
        const texts = candidates.map(c => c.text);
        expect(texts).toContain('Enter name');
        expect(texts).toContain('User Name');
    });
});
