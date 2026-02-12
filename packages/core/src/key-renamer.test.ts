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

  it('does not inject translation imports or hooks during rename', async () => {
    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    await renamer.rename('old.key', 'new.key', { write: true });

    const updatedContent = await fs.readFile(path.join(tempDir, 'src', 'App.tsx'), 'utf8');
    expect(updatedContent.match(/import\s+\{\s*useTranslation\s*\}\s+from\s+'react-i18next';/g)).toHaveLength(1);
    expect(updatedContent.match(/const\s+\{\s*t\s*\}\s*=\s*useTranslation\(\);/g)).toHaveLength(1);
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
    const oldKeyMapping = summary.mappingSummaries.find((entry) => entry.from === 'old.key');
    expect(oldKeyMapping?.occurrences).toBe(1);
    expect(summary.filesUpdated).toEqual(['src/App.tsx']);

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

  it('aborts renaming when target key already exists in a locale', async () => {
    const enPath = path.join(tempDir, 'locales', 'en.json');
    await fs.writeFile(
      enPath,
      JSON.stringify({ 'old.key': 'Hello', 'profile.greeting': 'Hi profile', 'new.key': 'Existing' }, null, 2)
    );

    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    await expect(renamer.rename('old.key', 'new.key', { write: true })).rejects.toThrow(/target entries already exist/i);

    const enContents = JSON.parse(await fs.readFile(enPath, 'utf8'));
    expect(enContents).toMatchObject({ 'old.key': 'Hello', 'new.key': 'Existing' });
  });

  it('reports duplicate targets during dry-run without modifying files', async () => {
    const esPath = path.join(tempDir, 'locales', 'es.json');
    await fs.writeFile(
      esPath,
      JSON.stringify({ 'old.key': 'Hola', 'profile.greeting': 'Hola perfil', 'new.key': 'Ya existe' }, null, 2)
    );

    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    const summary = await renamer.rename('old.key', 'new.key');

    expect(summary.localePreview.some((preview) => preview.duplicate)).toBe(true);
    const appContents = await fs.readFile(path.join(tempDir, 'src', 'App.tsx'), 'utf8');
    expect(appContents).toContain("t('old.key')");
  });

  it('renames keys in unconfigured locales', async () => {
    // Add unconfigured locale
    await fs.writeFile(
      path.join(tempDir, 'locales', 'fr.json'),
      JSON.stringify({ 'old.key': 'Bonjour' }, null, 2)
    );

    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    await renamer.rename('old.key', 'new.key', { write: true });

    const frContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8'));
    expect(frContents).toMatchObject({ 'new.key': 'Bonjour' });
    expect(frContents).not.toHaveProperty('old.key');
  });

  it('generates diffs for unconfigured locales', async () => {
    // Add unconfigured locale
    await fs.writeFile(
      path.join(tempDir, 'locales', 'fr.json'),
      JSON.stringify({ 'old.key': 'Bonjour' }, null, 2)
    );

    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    const summary = await renamer.rename('old.key', 'new.key', { diff: true });

    const frDiff = summary.localeDiffs?.find((d) => d.locale === 'fr');
    expect(frDiff).toBeDefined();
    expect(frDiff?.diff).toContain('old.key');
    expect(frDiff?.diff).toContain('new.key');
  });

  it('renames occurrences with property access (e.g., i18n.t)', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'I18nTest.tsx'),
      `import i18n from './i18n';
export function I18nTest() {
  return <div>{i18n.t('old.key')}</div>;
}
`
    );

    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    const summary = await renamer.rename('old.key', 'new.key', { write: true });

    expect(summary.occurrences).toBe(2); // One in App.tsx, one in I18nTest.tsx
    expect(summary.filesUpdated).toContain('src/I18nTest.tsx');
    expect(summary.filesUpdated).toContain('src/App.tsx');

    const content = await fs.readFile(path.join(tempDir, 'src', 'I18nTest.tsx'), 'utf8');
    expect(content).toContain("i18n.t('new.key')");
  });

  it('finds files in default include directories (e.g., pages/)', async () => {
    await fs.mkdir(path.join(tempDir, 'pages'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'pages', 'index.tsx'),
      `export default function Home() {
  return <div>{t('old.key')}</div>;
}
`
    );

    // Use a config with empty include to test defaults
    const configWithoutInclude = { ...baseConfig, include: [] };
    const renamer = new KeyRenamer(configWithoutInclude, { workspaceRoot: tempDir });
    const summary = await renamer.rename('old.key', 'new.key');

    expect(summary.occurrences).toBe(2); // One in App.tsx (src/), one in index.tsx (pages/)
  });

  it('renames keys with extra whitespace in source (normalization)', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'Whitespace.tsx'),
      `export function Whitespace() {
  return <div>{t('  suspicious   key   with   spaces  ')}</div>;
}
`
    );

    const renamer = new KeyRenamer(baseConfig, { workspaceRoot: tempDir });
    // The mapping uses the normalized key as "from"
    const summary = await renamer.rename('suspicious key with spaces', 'normalized-key', { write: true });

    expect(summary.occurrences).toBe(1);
    expect(summary.filesUpdated).toContain('src/Whitespace.tsx');

    const content = await fs.readFile(path.join(tempDir, 'src', 'Whitespace.tsx'), 'utf8');
    expect(content).toContain("t('normalized-key')");
  });

  it('renames keys inside Vue files and preserves quote style', async () => {
    const vueConfig = {
      ...baseConfig,
      include: ['src/**/*.{ts,tsx,vue}'],
    };

    await fs.writeFile(
      path.join(tempDir, 'src', 'Widget.vue'),
      `
<template>
  <div>old.key</div>
</template>

<script>
export default {
  data() {
    return {
      message: 'old.key'
    }
  }
}
</script>
`,
      'utf8'
    );

    const renamer = new KeyRenamer(vueConfig, { workspaceRoot: tempDir });
    const summary = await renamer.rename('old.key', 'new.key', { write: true });

    expect(summary.filesUpdated).toEqual(expect.arrayContaining(['src/App.tsx', 'src/Widget.vue']));

    const vueContents = await fs.readFile(path.join(tempDir, 'src', 'Widget.vue'), 'utf8');
    expect(vueContents).toContain(`{{ $t('new.key') }}`);

    const appContents = await fs.readFile(path.join(tempDir, 'src', 'App.tsx'), 'utf8');
    expect(appContents).toContain('new.key');

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toHaveProperty('new.key');
    expect(enContents).not.toHaveProperty('old.key');
  });
});
