import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { I18nConfig } from './config.js';
import { diagnoseWorkspace } from './diagnostics.js';

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

const writePackageJson = async (contents: Record<string, unknown>) => {
  await fs.writeFile(path.join(tempDir, 'package.json'), JSON.stringify(contents, null, 2));
};

describe('diagnoseWorkspace', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostics-'));
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'locales'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('collects runtime packages, locales, and translation usage stats', async () => {
    await writePackageJson({ dependencies: { 'react-i18next': '^13.0.0' } });

    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ greeting: 'Hello' }, null, 2)
    );
    await fs.writeFile(
      path.join(tempDir, 'locales', 'es.json'),
      JSON.stringify({ greeting: 'Hola' }, null, 2)
    );

    await fs.writeFile(
      path.join(tempDir, 'src', 'Component.tsx'),
      `import { useTranslation } from 'react-i18next';
export const Component = () => {
  const { t } = useTranslation();
  return <p>{t('greeting')}</p>;
};
`
    );

    const report = await diagnoseWorkspace(baseConfig, { workspaceRoot: tempDir });

    expect(report.runtimePackages).toEqual([
      { name: 'react-i18next', version: '^13.0.0', source: 'dependencies' },
    ]);
    expect(report.localeFiles.find((entry) => entry.locale === 'en')?.keyCount).toBe(1);
    expect(report.translationUsage.hookOccurrences).toBeGreaterThan(0);
    expect(report.translationUsage.identifierOccurrences).toBeGreaterThan(0);
    expect(report.actionableItems.some((item) => item.kind === 'diagnostics-provider-missing')).toBe(true);
  });

  it('flags missing target locales and surfaces recommendations', async () => {
    await writePackageJson({ dependencies: {} });
    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ greeting: 'Hello' }, null, 2)
    );

    const report = await diagnoseWorkspace(baseConfig, { workspaceRoot: tempDir });

    const missingTargets = report.actionableItems.find((item) => item.kind === 'diagnostics-missing-target-locales');
    expect(missingTargets).toBeDefined();
    expect(missingTargets?.severity).toBe('warn');
    expect(report.recommendations.some((rec) => rec.includes('i18nsmith sync'))).toBe(true);
  });

  it('detects invalid locale JSON and reports conflicts', async () => {
    await writePackageJson({ dependencies: {} });
    await fs.writeFile(path.join(tempDir, 'locales', 'en.json'), '{ invalid');

    const report = await diagnoseWorkspace(baseConfig, { workspaceRoot: tempDir });

    const conflict = report.conflicts.find((item) => item.kind === 'invalid-locale-json');
    expect(conflict).toBeDefined();
    expect(report.actionableItems.find((item) => item.kind === 'diagnostics-invalid-locale-json')).toBeDefined();
  });
});
