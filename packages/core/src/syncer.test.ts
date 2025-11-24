import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nConfig } from './config.js';
import { Syncer } from './syncer.js';

const baseConfig: I18nConfig = {
  version: 1,
  sourceLanguage: 'en',
  targetLanguages: ['es'],
  localesDir: 'locales',
  include: ['src/**/*.{ts,tsx}'],
  exclude: [],
  minTextLength: 1,
  translation: undefined,
  translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
  keyGeneration: { namespace: 'common', shortHashLen: 6 },
  seedTargetLocales: true,
};

let tempDir: string;

describe('Syncer', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncer-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'locales'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const writeFixtures = async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'App.tsx'),
      `import React from 'react';
import { useTranslation } from 'react-i18next';

const Component = () => {
  const { t } = useTranslation();
  return (
    <>
      <div>{t('existing.key')}</div>
      <span>{t('new.key')}</span>
    </>
  );
};
export default Component;
`
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ 'existing.key': 'Existing Text', 'unused.key': 'Obsolete' }, null, 2)
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify({ 'existing.key': 'Existente', 'unused.key': 'Obsoleto' }, null, 2)
    );
  };

  it('reports missing and unused keys without touching disk', async () => {
    await writeFixtures();
    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });

    const summary = await syncer.run();

    expect(summary.filesScanned).toBeGreaterThan(0);
    expect(summary.missingKeys.map((item) => item.key)).toEqual(['new.key']);
    expect(summary.unusedKeys).toEqual([
      {
        key: 'unused.key',
        locales: ['en', 'es'],
      },
    ]);
    expect(summary.localeStats).toEqual([]);

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toHaveProperty('unused.key');
    expect(enContents).not.toHaveProperty('new.key');
  });

  it('applies fixes when run with write flag', async () => {
    await writeFixtures();
    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });

    const summary = await syncer.run({ write: true });

    expect(summary.localeStats).not.toHaveLength(0);

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toMatchObject({
      'existing.key': 'Existing Text',
      'new.key': 'new.key',
    });
    expect(enContents).not.toHaveProperty('unused.key');

    const esContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'es.json'), 'utf8'));
    expect(esContents).toMatchObject({
      'existing.key': 'Existente',
      'new.key': '',
    });
  });
});
