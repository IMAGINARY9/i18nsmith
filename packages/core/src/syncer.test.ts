import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nConfig } from './config.js';
import { Syncer } from './syncer.js';
import { ReferenceExtractor } from './reference-extractor.js';
import { getCachePath } from './cache-utils.js';

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
  sync: {
    translationIdentifier: 't',
    validateInterpolations: false,
    placeholderFormats: ['doubleCurly', 'percentCurly', 'percentSymbol'],
    emptyValuePolicy: 'warn',
    emptyValueMarkers: ['todo', 'tbd', 'fixme', 'pending', '???'],
    dynamicKeyAssumptions: [],
  },
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
    const kinds = summary.actionableItems.map((item) => item.kind);
    expect(kinds).toContain('missing-key');
    expect(kinds).toContain('unused-key');

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toHaveProperty('unused.key');
    expect(enContents).not.toHaveProperty('new.key');
  });

  it('mergeStrategy keep-source seeds missing keys without overwriting existing values', async () => {
    await writeFixtures();
    const syncer = new Syncer(
      {
        ...baseConfig,
        seedTargetLocales: false,
        mergeStrategy: 'keep-source',
        sync: {
          ...baseConfig.sync,
          seedValue: '[TODO]',
        },
      },
      { workspaceRoot: tempDir }
    );

    await syncer.run({ write: true });

    const targetLocale = JSON.parse(
      await fs.readFile(path.join(tempDir, 'locales', 'es.json'), 'utf8')
    );

    expect(targetLocale['existing.key']).toBe('Existente');
    expect(targetLocale['new.key']).toBe('[TODO]');
  });

  it('mergeStrategy overwrite replaces target values with seed values', async () => {
    await writeFixtures();
    const syncer = new Syncer(
      {
        ...baseConfig,
        seedTargetLocales: false,
        mergeStrategy: 'overwrite',
        sync: {
          ...baseConfig.sync,
          seedValue: '[TODO]',
        },
      },
      { workspaceRoot: tempDir }
    );

    await syncer.run({ write: true });

    const targetLocale = JSON.parse(
      await fs.readFile(path.join(tempDir, 'locales', 'es.json'), 'utf8')
    );

    expect(targetLocale['existing.key']).toBe('[TODO]');
    expect(targetLocale['new.key']).toBe('[TODO]');
  });

  it('applies fixes when run with write flag', async () => {
    await writeFixtures();
    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });

    const summary = await syncer.run({ write: true, prune: true });

    expect(summary.localeStats).not.toHaveLength(0);

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toMatchObject({
      'existing.key': 'Existing Text',
      'new.key': 'Key',
    });
    expect(enContents).not.toHaveProperty('unused.key');

    const esContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'es.json'), 'utf8'));
    expect(esContents).toMatchObject({
      'existing.key': 'Existente',
      'new.key': '',
    });
  });

  it('preserves unused keys when prune is not set', async () => {
    await writeFixtures();
    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });

    // Run with write: true but without prune: true
    const summary = await syncer.run({ write: true });

    // Should still report unused keys
    expect(summary.unusedKeys.some((u) => u.key === 'unused.key')).toBe(true);

    // But should NOT remove them from locale files
    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toHaveProperty('unused.key');

    // Should still add new keys
    expect(enContents).toHaveProperty('new.key');
  });

  it('preserves extractor-discovered references through the full sync pipeline (end-to-end)', async () => {
    // Create a Vue SFC with a nested $t(...) used as an interpolation parameter
    const vue = `
<template>
  <p v-if="name">{{ $t('common.components.i18ndemo.arg0-name.4ac48a', { arg0: $t('demo.card.greeting'), name }) }}</p>
</template>
`;

    await fs.mkdir(path.join(tempDir, 'src', 'components'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'src', 'components', 'I18nDemo.vue'), vue);

    // Locales already include the nested key — sync should *not* mark it as unused
    const en = {
      common: { components: { i18ndemo: { 'arg0-name': '{arg0} {name}' } } },
      demo: { card: { greeting: 'Hello' } },
    };
    const fr = JSON.parse(JSON.stringify(en));

    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), JSON.stringify(en, null, 2));
    await fs.writeFile(path.join(tempDir, 'locales', 'fr.json'), JSON.stringify(fr, null, 2));

    // Use a config that includes .vue files so both extractor and syncer see them
    const cfg: I18nConfig = {
      ...baseConfig,
      include: ['src/**/*.vue', 'src/**/*.{ts,tsx,js,jsx}'],
    };

    const extractor = new ReferenceExtractor(cfg, { workspaceRoot: tempDir });
    const extracted = await extractor.extract({ invalidateCache: true });
    const extractedKeys = new Set(extracted.references.map((r) => r.key));

    const syncer = new Syncer(cfg, { workspaceRoot: tempDir });
    const summary = await syncer.run({ invalidateCache: true });
    const summaryRefKeys = new Set(summary.references.map((r) => r.key));

    // Every key discovered by the file-level extractor must appear in the
    // SyncSummary.references (invariant across the pipeline).
    for (const k of extractedKeys) {
      expect(summaryRefKeys.has(k)).toBe(true);
    }

    // Sanity: the nested interpolation key must *not* be listed as unused.
    const unused = summary.unusedKeys.map((u) => u.key);
    expect(unused).not.toContain('demo.card.greeting');
  });

  it('skips auto-writing suspicious keys by default', async () => {
    const keyWithSpaces = 'When to Use Categorized View:';
    await fs.writeFile(
      path.join(tempDir, 'src', 'Suspicious.tsx'),
      `import { useTranslation } from 'react-i18next';

const Suspicious = () => {
  const { t } = useTranslation();
  return <p>{t('${keyWithSpaces}')}</p>;
};

export default Suspicious;
`
    );

    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), '{}');
    await fs.writeFile(path.join(tempDir, 'locales', 'es.json'), '{}');

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const summary = await syncer.run({ write: true });

    const missing = summary.missingKeys.find((entry) => entry.key === keyWithSpaces);
    expect(missing?.suspicious).toBe(true);
    expect(summary.actionableItems.some((item) => item.kind === 'suspicious-keys')).toBe(true);

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).not.toHaveProperty(keyWithSpaces);
  });

  it('honors suspicious key policy overrides', async () => {
    const keyWithSpaces = 'When to Use Smart Search View:';
    await fs.writeFile(
      path.join(tempDir, 'src', 'SuspiciousAllow.tsx'),
      `import { useTranslation } from 'react-i18next';

const SuspiciousAllow = () => {
  const { t } = useTranslation();
  return <p>{t('${keyWithSpaces}')}</p>;
};

export default SuspiciousAllow;
`
    );

    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), '{}');
    await fs.writeFile(path.join(tempDir, 'locales', 'es.json'), '{}');

    const config: I18nConfig = {
      ...baseConfig,
      sync: {
        ...baseConfig.sync!,
        suspiciousKeyPolicy: 'allow',
      },
    };

    const syncer = new Syncer(config, { workspaceRoot: tempDir });
    await syncer.run({ write: true });

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toHaveProperty(keyWithSpaces);
  });

  it('treats single-word keys without namespace as suspicious', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'SingleWord.tsx'),
      `import { useTranslation } from 'react-i18next';

const SingleWord = () => {
  const { t } = useTranslation();
  return <p>{t('Found')}</p>;
};

export default SingleWord;
`
    );

    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), '{}');
    await fs.writeFile(path.join(tempDir, 'locales', 'es.json'), '{}');

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const summary = await syncer.run({ write: true });

    const missing = summary.missingKeys.find((entry) => entry.key === 'Found');
    expect(missing?.suspicious).toBe(true);

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).not.toHaveProperty('Found');
  });

  it('treats sentence-like keys with punctuation or articles as suspicious', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'SentenceKeys.tsx'),
      `import { useTranslation } from 'react-i18next';

const SentenceKeys = () => {
  const { t } = useTranslation();
  return (
    <>
      <p>{t('When to Use Categorized View:')}</p>
      <p>{t('HowToGetStarted')}</p>
      <p>{t('TheQuickBrownFox')}</p>
      <p>{t('normal.valid.key')}</p>
    </>
  );
};

export default SentenceKeys;
`
    );

    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), '{}');
    await fs.writeFile(path.join(tempDir, 'locales', 'es.json'), '{}');

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const summary = await syncer.run({ write: true });

    // Keys with colons at the end should be suspicious
    const colonKey = summary.missingKeys.find((e) => e.key === 'When to Use Categorized View:');
    expect(colonKey?.suspicious).toBe(true);

    // Keys with common articles like "The" should be suspicious
    const theKey = summary.missingKeys.find((e) => e.key === 'TheQuickBrownFox');
    expect(theKey?.suspicious).toBe(true);

    // Keys with "To" (article/preposition) should be suspicious
    const toKey = summary.missingKeys.find((e) => e.key === 'HowToGetStarted');
    expect(toKey?.suspicious).toBe(true);

    // Normal dotted keys should NOT be suspicious
    const normalKey = summary.missingKeys.find((e) => e.key === 'normal.valid.key');
    expect(normalKey?.suspicious).toBe(false);

    // Suspicious keys should NOT be written
    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).not.toHaveProperty('When to Use Categorized View:');
    expect(enContents).not.toHaveProperty('TheQuickBrownFox');
    expect(enContents).toHaveProperty('normal.valid.key');
  });

  it('seeds missing keys using fallback literals from code (t(key) || "literal")', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'Fallback.tsx'),
      `import { useTranslation } from 'react-i18next';

const Fallback = () => {
  const { t } = useTranslation();
  return <div>{t('form.email_address') || 'Email Address'}</div>;
};

export default Fallback;
`
    );

    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), '{}');

    const syncer = new Syncer(
      {
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: path.join(tempDir, 'locales'),
        include: ['src/**/*.tsx'],
      } as I18nConfig,
      { workspaceRoot: tempDir }
    );

    await syncer.run({ write: true });

    const enContents = JSON.parse(
      await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8')
    ) as Record<string, string>;

    expect(enContents['form.email_address']).toBe('Email Address');
  });

  it('reports placeholder mismatches when interpolation validation is enabled', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'Greeting.tsx'),
      `import { useTranslation } from 'react-i18next';

const Greeting = ({ name }: { name: string }) => {
  const { t } = useTranslation();
  return <span>{t('greeting', { name })}</span>;
};

export default Greeting;
`
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ greeting: 'Hello {{name}}' }, null, 2)
    );
    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify({ greeting: 'Hola' }, null, 2)
    );

    const syncer = new Syncer(
      {
        ...baseConfig,
        sync: {
          ...baseConfig.sync!,
          validateInterpolations: true,
        },
      },
      { workspaceRoot: tempDir }
    );

    const summary = await syncer.run();

    expect(summary.validation.interpolations).toBe(true);
    expect(summary.placeholderIssues).toHaveLength(1);
    expect(summary.placeholderIssues[0]).toMatchObject({
      key: 'greeting',
      locale: 'es',
      missing: ['name'],
    });
  });

  it('flags empty locale values based on policy', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'Status.tsx'),
      `import { useTranslation } from 'react-i18next';

export const Status = () => {
  const { t } = useTranslation();
  return <p>{t('status.ready')}</p>;
};
`
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ 'status.ready': 'Ready' }, null, 2)
    );
    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify({ 'status.ready': '' }, null, 2)
    );

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const summary = await syncer.run({ emptyValuePolicy: 'fail' });

    expect(summary.validation.emptyValuePolicy).toBe('fail');
    expect(summary.emptyValueViolations).toHaveLength(1);
    expect(summary.emptyValueViolations[0]).toMatchObject({
      key: 'status.ready',
      locale: 'es',
      reason: 'empty',
    });
  });

  it('reports dynamic key warnings and honors assumed keys', async () => {
    const dynamicComponent = [
      "import { useTranslation } from 'react-i18next';",
      '',
      'const Errors = ({ code }: { code: number }) => {',
      '  const { t } = useTranslation();',
      '  return <span>{t(`errors.${code}`)}</span>;',
      '};',
      '',
      'export default Errors;',
      '',
    ].join('\n');

    await fs.writeFile(path.join(tempDir, 'src', 'Errors.tsx'), dynamicComponent);

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ 'errors.404': 'Not found' }, null, 2)
    );
    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify({ 'errors.404': 'No encontrado' }, null, 2)
    );

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const summary = await syncer.run({ assumedKeys: ['errors.404'] });

    expect(summary.dynamicKeyWarnings).toHaveLength(1);
    expect(summary.assumedKeys).toContain('errors.404');
    expect(summary.unusedKeys).toHaveLength(0);
  });

  it('treats dynamic key globs as assumed keys for unused analysis', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'Shell.tsx'),
      `export const Shell = () => <div>noop</div>;`
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ 'relativeTime.minutes': '1 minute', 'relativeTime.hours': '1 hour' }, null, 2)
    );

    const config: I18nConfig = {
      ...baseConfig,
      sync: {
        ...baseConfig.sync!,
        dynamicKeyGlobs: ['relativeTime.*'],
      },
    };

    const syncer = new Syncer(config, { workspaceRoot: tempDir });
    const summary = await syncer.run();

    expect(summary.unusedKeys).toEqual([]);
    expect(summary.assumedKeys).toEqual([]);
  });

  it('applies selection filters for missing and unused keys', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'Selective.tsx'),
      `import { useTranslation } from 'react-i18next';

const Selective = () => {
  const { t } = useTranslation();
  return (
    <>
      <div>{t('existing.key')}</div>
      <span>{t('new.key')}</span>
      <span>{t('extra.key')}</span>
    </>
  );
};

export default Selective;
`
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify(
        {
          'existing.key': 'Existing Text',
          'unused.one': 'One',
          'unused.two': 'Two',
        },
        null,
        2
      )
    );

    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify(
        {
          'existing.key': 'Existente',
          'unused.one': 'Uno',
          'unused.two': 'Dos',
        },
        null,
        2
      )
    );

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    await syncer.run({
      write: true,
      selection: {
        missing: ['new.key'],
        unused: ['unused.one'],
      },
    });

    const enContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'en.json'), 'utf8'));
    expect(enContents).toMatchObject({
      'existing.key': 'Existing Text',
      'new.key': 'Key',
    });
    expect(enContents).not.toHaveProperty('extra.key');
    expect(enContents).not.toHaveProperty('unused.one');
    expect(enContents).toHaveProperty('unused.two');

    const esContents = JSON.parse(await fs.readFile(path.join(tempDir, 'locales', 'es.json'), 'utf8'));
    expect(esContents).toHaveProperty('new.key');
    expect(esContents).not.toHaveProperty('extra.key');
    expect(esContents).not.toHaveProperty('unused.one');
    expect(esContents).toHaveProperty('unused.two');
  });

  it('limits analysis scope when target files are provided', async () => {
    const alphaPath = path.join(tempDir, 'src', 'Alpha.tsx');
    const betaPath = path.join(tempDir, 'src', 'Beta.tsx');
    const componentTemplate = (key: string) => `import { useTranslation } from 'react-i18next';

const Component = () => {
  const { t } = useTranslation();
  return <span>{t('${key}')}</span>;
};

export default Component;
`;

    await fs.writeFile(alphaPath, componentTemplate('alpha.only'));
    await fs.writeFile(betaPath, componentTemplate('beta.only'));

    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), JSON.stringify({}, null, 2));
    await fs.writeFile(path.join(tempDir, 'locales', 'es.json'), JSON.stringify({}, null, 2));

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });

    const scoped = await syncer.run({ targets: ['src/Beta.tsx'] });

    expect(scoped.filesScanned).toBe(1);
    expect(scoped.missingKeys.map((item) => item.key)).toEqual(['beta.only']);
    expect(scoped.references.every((ref) => ref.filePath.endsWith('src/Beta.tsx'))).toBe(true);
    expect(scoped.unusedKeys).toEqual([]);
  });

  it('caches translation references and honors explicit invalidation', async () => {
    await writeFixtures();
    const cachePath = getCachePath(tempDir, 'sync');

    const initial = new Syncer(baseConfig, { workspaceRoot: tempDir });
    await initial.run();
    const stats = await fs.stat(cachePath);
    expect(stats.isFile()).toBe(true);

    const cachedSyncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const cachedProject = (cachedSyncer as any).project;
    const cachedSpy = vi.spyOn(cachedProject, 'addSourceFileAtPath');
    await cachedSyncer.run();
    expect(cachedSpy).not.toHaveBeenCalled();
    cachedSpy.mockRestore();

    const invalidatedSyncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const invalidatedProject = (invalidatedSyncer as any).project;
    const invalidateSpy = vi.spyOn(invalidatedProject, 'addSourceFileAtPath');
    await invalidatedSyncer.run({ invalidateCache: true });
    expect(invalidateSpy.mock.calls.length).toBeGreaterThan(0);
    invalidateSpy.mockRestore();
  });

  it('expands dynamic key patterns and reports coverage', async () => {
    const dynamicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'syncer-dynamic-expand-'));
    await fs.mkdir(path.join(dynamicDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(dynamicDir, 'locales'), { recursive: true });
    await fs.writeFile(path.join(dynamicDir, 'locales', 'en.json'), JSON.stringify({ 'workingHours.monday': 'Mon' }, null, 2));
    await fs.writeFile(path.join(dynamicDir, 'locales', 'es.json'), JSON.stringify({}, null, 2));

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['es'],
      localesDir: path.join(dynamicDir, 'locales'),
      include: ['src/**/*.tsx'],
      dynamicKeys: {
        expand: {
          'workingHours.*': ['monday', 'tuesday'],
        },
      },
    };

    const syncer = new Syncer(config, { workspaceRoot: dynamicDir });
    const summary = await syncer.run({ write: false });

    const coverage = summary.dynamicKeyCoverage.find((entry) => entry.pattern === 'workingHours.*');
    expect(coverage?.expandedKeys).toEqual(['workingHours.monday', 'workingHours.tuesday']);
    expect(coverage?.missingByLocale.en).toEqual(['workingHours.tuesday']);
    expect(coverage?.missingByLocale.es).toEqual(['workingHours.monday', 'workingHours.tuesday']);
  });

  it('detects key-equals-value patterns in locale files during post-sync audit', async () => {
    await fs.writeFile(
      path.join(tempDir, 'src', 'KeyValue.tsx'),
      `import { useTranslation } from 'react-i18next';
const Component = () => {
  const { t } = useTranslation();
  return <p>{t('save')}</p>;
};`,
      'utf8'
    );

    // Create locale file with key === value pattern
    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
  JSON.stringify({ save: 'save' }, null, 2)
    );
    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify({}, null, 2)
    );

    const syncer = new Syncer(baseConfig, { workspaceRoot: tempDir });
    const result = await syncer.run();

    const keyEqualsValueWarnings = result.suspiciousKeys.filter(
      (w) => w.reason === 'key-equals-value'
    );
    expect(keyEqualsValueWarnings.length).toBeGreaterThan(0);
  expect(keyEqualsValueWarnings[0].key).toBe('save');
  });
});
