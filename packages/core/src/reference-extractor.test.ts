import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it, afterEach } from 'vitest';
import { Project } from 'ts-morph';
import { ReferenceExtractor } from './reference-extractor.js';
import type { I18nConfig } from './config.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('ReferenceExtractor', () => {
  it('extracts literal key references from source files', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ref-extractor-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const filePath = path.join(srcDir, 'Component.tsx');
    await fs.writeFile(
      filePath,
      `
      import { useTranslation } from 'react-i18next';
      export function Component() {
        const { t } = useTranslation();
        return (
          <div>
            <p>{t('common.greeting')}</p>
            <p>{t('common.farewell')}</p>
          </div>
        );
      }
    `,
      'utf8'
    );

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir!, 'locales'),
      include: ['src/**/*.tsx'],
    };

    const extractor = new ReferenceExtractor(config, {
      workspaceRoot: tempDir,
    });

    const result = await extractor.extract({ invalidateCache: true });

    expect(result.filesScanned).toBe(1);
    expect(result.references).toHaveLength(2);
    expect(result.keySet.has('common.greeting')).toBe(true);
    expect(result.keySet.has('common.farewell')).toBe(true);
    expect(result.dynamicKeyWarnings).toHaveLength(0);
  });

  it('detects dynamic key patterns and reports warnings', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ref-extractor-dynamic-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const filePath = path.join(srcDir, 'Dynamic.tsx');
    await fs.writeFile(
      filePath,
      `
      import { useTranslation } from 'react-i18next';
      export function Dynamic({ key }) {
        const { t } = useTranslation();
        return (
          <div>
            <p>{t(\`common.\${key}\`)}</p>
            <p>{t('prefix.' + key)}</p>
            <p>{t(key)}</p>
          </div>
        );
      }
    `,
      'utf8'
    );

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir!, 'locales'),
      include: ['src/**/*.tsx'],
    };

    const extractor = new ReferenceExtractor(config, {
      workspaceRoot: tempDir,
    });

    const result = await extractor.extract({ invalidateCache: true });

    expect(result.references).toHaveLength(0);
    expect(result.dynamicKeyWarnings).toHaveLength(3);

    const reasons = result.dynamicKeyWarnings.map((w) => w.reason);
    expect(reasons).toContain('template');
    expect(reasons).toContain('binary');
    expect(reasons).toContain('expression');
  });

  it('extracts references from a single source file', () => {
    const config: Partial<I18nConfig> = {
      sourceLanguage: 'en',
      targetLanguages: [],
    };

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `
      const { t } = useTranslation();
      const a = t('key.one');
      const b = t('key.two');
    `,
      { overwrite: true }
    );

    const extractor = new ReferenceExtractor(config as I18nConfig, {
      workspaceRoot: '/tmp',
      project,
    });

    const result = extractor.extractFromFile(sourceFile);

    expect(result.references).toHaveLength(2);
    expect(result.references[0].key).toBe('key.one');
    expect(result.references[1].key).toBe('key.two');
  });

  it('respects custom translation identifier', () => {
    const config: Partial<I18nConfig> = {
      sourceLanguage: 'en',
      targetLanguages: [],
      translationAdapter: {
        module: 'custom-i18n',
        hookName: 'translate',
      },
    };

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    const sourceFile = project.createSourceFile(
      'test.tsx',
      `
      const a = t('should.not.match');
      const b = translate('should.match');
    `,
      { overwrite: true }
    );

    const extractor = new ReferenceExtractor(config as I18nConfig, {
      workspaceRoot: '/tmp',
      project,
    });

    const result = extractor.extractFromFile(sourceFile);

    expect(result.references).toHaveLength(1);
    expect(result.references[0].key).toBe('should.match');
  });

  it('includes assumed keys in result set', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ref-extractor-assumed-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(path.join(srcDir, 'Empty.tsx'), '// empty file', 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir!, 'locales'),
      include: ['src/**/*.tsx'],
    };

    const extractor = new ReferenceExtractor(config, {
      workspaceRoot: tempDir,
    });

    const assumedKeys = new Set(['assumed.key.one', 'assumed.key.two']);
    const result = await extractor.extract({ invalidateCache: true, assumedKeys });

    expect(result.keySet.has('assumed.key.one')).toBe(true);
    expect(result.keySet.has('assumed.key.two')).toBe(true);
    expect(result.referencesByKey.has('assumed.key.one')).toBe(true);
  });

  it('extracts $t() from bound attributes (:attr) in Vue SFC templates', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ref-extractor-vue-bound-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    await fs.writeFile(
      path.join(srcDir, 'Input.vue'),
      `
<template>
  <div>
    <input :placeholder="$t('form.placeholder.name')" :aria-label="$t('form.aria.name')" />
    <p v-if="show">{{ $t('form.hint') }}</p>
  </div>
</template>
`,
      'utf8'
    );

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir!, 'locales'),
      include: ['src/**/*.vue'],
    };

    const extractor = new ReferenceExtractor(config, { workspaceRoot: tempDir });
    const result = await extractor.extract({ invalidateCache: true });

    const keys = result.references.map((r) => r.key);
    // All three $t() calls — two in bound attributes, one in mustache — must be found
    expect(keys).toContain('form.placeholder.name');
    expect(keys).toContain('form.aria.name');
    expect(keys).toContain('form.hint');
    // None should be reported as missing references
    expect(result.dynamicKeyWarnings).toHaveLength(0);
  });
});
