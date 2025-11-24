import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nConfig } from './config.js';
import { KeyRenamer } from './key-renamer.js';

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

describe('KeyRenamer', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'key-renamer-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'locales'), { recursive: true });

    await fs.writeFile(
      path.join(tempDir, 'src', 'App.tsx'),
      `import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return <div>{t('old.key')}</div>;
}
`
    );

    await fs.writeFile(
      path.join(tempDir, 'src', 'Profile.tsx'),
      `import { useTranslation } from 'react-i18next';

export function Profile() {
  const { t } = useTranslation();
  return <div>{t('profile.greeting')}</div>;
}
`
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ 'old.key': 'Hello', 'profile.greeting': 'Hi profile' }, null, 2)
    );
    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify({ 'old.key': 'Hola', 'profile.greeting': 'Hola perfil' }, null, 2)
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('detects occurrences without writing when dry-run', async () => {
    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    const summary = await renamer.rename('old.key', 'new.key');

    expect(summary.occurrences).toBe(1);
    expect(summary.filesUpdated).toHaveLength(0);
    expect(summary.localeStats).toHaveLength(0);
    expect(summary.localePreview.some((entry) => entry.missing)).toBe(false);

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toHaveProperty('old.key');
    expect(enContents).not.toHaveProperty('new.key');
  });

  it('renames occurrences and locale entries when write flag is set', async () => {
    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    const summary = await renamer.rename('old.key', 'new.key', { write: true });

  expect(summary.filesUpdated).toEqual(['src/App.tsx']);
    expect(summary.localeStats.length).toBeGreaterThan(0);

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toMatchObject({ 'new.key': 'Hello' });
    expect(enContents).not.toHaveProperty('old.key');

    const esContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'es.json'), 'utf8'));
    expect(esContents).toMatchObject({ 'new.key': 'Hola' });
  });

  it('renames multiple keys using a mapping batch', async () => {
    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    const summary = await renamer.renameBatch(
      [
        { from: 'old.key', to: 'new.key' },
        { from: 'profile.greeting', to: 'profile.salutation' },
      ],
      { write: true }
    );

    expect(summary.mappingSummaries).toHaveLength(2);
    const mapping = summary.mappingSummaries.find((entry) => entry.from === 'profile.greeting');
    expect(mapping?.occurrences).toBe(1);
    expect(summary.filesUpdated).toEqual(expect.arrayContaining(['src/App.tsx', 'src/Profile.tsx']));

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toMatchObject({ 'new.key': 'Hello', 'profile.salutation': 'Hi profile' });
    expect(enContents).not.toHaveProperty('profile.greeting');
  });

  it('throws when duplicate mapping entries are provided', async () => {
    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    await expect(
      renamer.renameBatch(
        [
          { from: 'old.key', to: 'new.key' },
          { from: 'old.key', to: 'another.key' },
        ],
        { write: false }
      )
    ).rejects.toThrow(/Duplicate mapping detected/);
  });
});
