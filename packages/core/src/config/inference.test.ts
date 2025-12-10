import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { inferConfig } from './inference.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-infer-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('inferConfig', () => {
  it('detects localesDir when missing', async () => {
    const localesPath = path.join(tmpDir, 'src/locales');
    await fs.mkdir(localesPath, { recursive: true });
    await fs.writeFile(path.join(localesPath, 'en.json'), '{"key":"value"}');

    const result = await inferConfig({}, { projectRoot: tmpDir });
    expect(result.localesDir).toBe('src/locales');
  });

  it('infers target languages from locale files', async () => {
    const localesPath = path.join(tmpDir, 'locales');
    await fs.mkdir(localesPath, { recursive: true });
    await fs.writeFile(path.join(localesPath, 'en.json'), '{}');
    await fs.writeFile(path.join(localesPath, 'fr.json'), '{}');
    await fs.writeFile(path.join(localesPath, 'es.yml'), '');

    const result = await inferConfig(
      { localesDir: 'locales', sourceLanguage: 'en' },
      { projectRoot: tmpDir }
    );

    expect(result.targetLanguages).toEqual(['es', 'fr']);
  });

  it('infers source language when missing', async () => {
    const localesPath = path.join(tmpDir, 'locales');
    await fs.mkdir(path.join(localesPath, 'fr'), { recursive: true });
    await fs.mkdir(path.join(localesPath, 'de'), { recursive: true });

    const result = await inferConfig({ localesDir: 'locales' }, { projectRoot: tmpDir });
    expect(result.sourceLanguage).toBe('de');
  });

  it('respects existing user configuration', async () => {
    const result = await inferConfig(
      {
        localesDir: 'custom/locales',
        targetLanguages: ['ja'],
        sourceLanguage: 'en',
      },
      { projectRoot: tmpDir }
    );

    expect(result.localesDir).toBe('custom/locales');
    expect(result.targetLanguages).toEqual(['ja']);
    expect(result.sourceLanguage).toBe('en');
  });
});
