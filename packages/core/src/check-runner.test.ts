import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CheckRunner } from './check-runner.js';
import { I18nConfig } from './config.js';

const baseConfig: I18nConfig = {
  version: 1,
  sourceLanguage: 'en',
  targetLanguages: ['es'],
  localesDir: 'locales',
  include: ['src/**/*.{ts,tsx}'],
  exclude: ['node_modules/**'],
  minTextLength: 1,
  translation: undefined,
  translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
  keyGeneration: { namespace: 'common', shortHashLen: 6 },
  seedTargetLocales: false,
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

const writeFile = (relativePath: string, contents: string) =>
  fs.writeFile(path.join(tempDir, relativePath), contents);

const ensureDir = (relativePath: string) =>
  fs.mkdir(path.join(tempDir, relativePath), { recursive: true });

describe('CheckRunner', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'check-runner-'));
    await ensureDir('src');
    await ensureDir('locales');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('aggregates diagnostics, sync actionable items, and suggested commands', async () => {
    await writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '1.0.0' }));
    await writeFile('locales/en.json', JSON.stringify({}, null, 2));
    await writeFile(
      'src/App.tsx',
      `import { useTranslation } from 'react-i18next';
const Component = () => {
  const { t } = useTranslation();
  return <p>{t('common.greeting')}</p>;
};
export default Component;
`
    );

    const runner = new CheckRunner(baseConfig, { workspaceRoot: tempDir });
    const summary = await runner.run();

    expect(summary.diagnostics.localeFiles.length).toBeGreaterThan(0);
    expect(summary.sync.missingKeys.map((item) => item.key)).toContain('common.greeting');
    expect(summary.actionableItems.some((item) => item.kind === 'missing-key')).toBe(true);
  expect(summary.suggestedCommands.some((cmd) => cmd.command === 'i18nsmith sync')).toBe(true);
    expect(summary.hasDrift).toBe(true);
    expect(summary.hasConflicts).toBe(false);
  });

  it('suggests seeding when target locales have fewer keys than source', async () => {
    await writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '1.0.0' }));
    // Source has 2 keys, target has 0
    await writeFile('locales/en.json', JSON.stringify({ a: 'A', b: 'B' }, null, 2));
    await writeFile('locales/es.json', JSON.stringify({}, null, 2));
    await writeFile(
      'src/App.tsx',
      `import { useTranslation } from 'react-i18next';
const Component = () => {
  const { t } = useTranslation();
  return <p>{t('a')}</p>;
};
export default Component;
`
    );

    const config: I18nConfig = {
      ...baseConfig,
      seedTargetLocales: true,
    };

    const runner = new CheckRunner(config, { workspaceRoot: tempDir });
    const summary = await runner.run();

    expect(summary.suggestedCommands.some((c) => c.command?.includes('--seed-target-locales'))).toBe(true);
  });

  it('suggests seeding when seedTargetLocales is enabled', async () => {
    await writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '1.0.0' }));
    await writeFile('locales/en.json', JSON.stringify({}, null, 2));
    await writeFile(
      'src/App.tsx',
      `import { useTranslation } from 'react-i18next';
const Component = () => {
  const { t } = useTranslation();
  return <p>{t('common.greeting')}</p>;
};
export default Component;
`
    );

  const cfg = { ...baseConfig, seedTargetLocales: true } as any as I18nConfig;
  const runner = new CheckRunner(cfg, { workspaceRoot: tempDir });
    const summary = await runner.run();

    expect(summary.sync.missingKeys.map((item) => item.key)).toContain('common.greeting');
    expect(summary.suggestedCommands.some((cmd) => cmd.command === 'i18nsmith sync --seed-target-locales')).toBe(true);
  });

  it('surfaces runtime recommendations when no adapters are detected', async () => {
    await writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '1.0.0' }));
    await writeFile('locales/en.json', JSON.stringify({ greeting: 'Hello' }, null, 2));
    await writeFile('locales/es.json', JSON.stringify({ greeting: 'Hola' }, null, 2));
    await writeFile(
      'src/App.tsx',
      `export const Component = () => <p>{t('greeting')}</p>;`
    );

    const runner = new CheckRunner(baseConfig, { workspaceRoot: tempDir });
    const summary = await runner.run();

    expect(summary.suggestedCommands.some((cmd) => cmd.command.startsWith('i18nsmith scaffold-adapter'))).toBe(true);
  });
});
