import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Project } from 'ts-morph';
import { describe, expect, it, afterEach } from 'vitest';
import type { I18nConfig } from '@i18nsmith/core';
import { Transformer } from './transformer';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('Transformer', () => {
  it('transforms JSX text nodes and updates locale files', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'App.tsx');
    const initial = "export const App = () => { return <div>Hello world</div>; };";
    await fs.writeFile(filePath, initial, 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['fr'],
      localesDir: path.join(tempDir, 'locales'),
      include: ['src/**/*.tsx'],
    } as I18nConfig;

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(filePath);

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      project,
      write: true,
    });

    const summary = await transformer.run({ write: true });

    expect(summary.filesChanged).toContain('src/App.tsx');
    expect(summary.localeStats.some((stat) => stat.locale === 'en')).toBe(true);

    const updatedFile = await fs.readFile(filePath, 'utf8');
    expect(updatedFile).toMatch(/useTranslation/);
    expect(updatedFile).toMatch(/t\('/);

    const enLocalePath = path.join(tempDir, 'locales', 'en.json');
    const enContents = JSON.parse(await fs.readFile(enLocalePath, 'utf8'));
    const key = Object.keys(enContents)[0];
    expect(enContents[key]).toBe('Hello world');

    const frLocalePath = path.join(tempDir, 'locales', 'fr.json');
    const frContents = JSON.parse(await fs.readFile(frLocalePath, 'utf8'));
    expect(frContents[key]).toBe('');
  });
});
