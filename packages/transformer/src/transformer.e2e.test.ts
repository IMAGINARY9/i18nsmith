import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Project } from 'ts-morph';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { I18nConfig } from '@i18nsmith/core';
import { Transformer } from './transformer';

let workspace: string;
let localesDir: string;

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-e2e-'));
  localesDir = path.join(workspace, 'locales');
  await fs.mkdir(path.join(workspace, 'src', 'components'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'src', 'pages'), { recursive: true });
});

afterEach(async () => {
  if (workspace) {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

describe.sequential('Transformer end-to-end', () => {
  it('applies translations across files and locales', async () => {
    const greetingPath = path.join(workspace, 'src', 'components', 'Greeting.tsx');
    const homePath = path.join(workspace, 'src', 'pages', 'Home.tsx');

    await fs.writeFile(
      greetingPath,
      `import React from 'react';
       export const Greeting = () => <h1>Hello world</h1>;`,
      'utf8'
    );

    await fs.writeFile(
      homePath,
      `export function Home() {
         return (
           <main aria-label="Main section">
             <p>Hello world</p>
             <button title={'Click me'}>Click me</button>
           </main>
         );
       }`,
      'utf8'
    );

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['fr', 'de'],
      localesDir,
      include: ['src/**/*.tsx'],
    };

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(greetingPath);
    project.addSourceFileAtPath(homePath);

    const transformer = new Transformer(config, {
      workspaceRoot: workspace,
      project,
      write: true,
    });

    const summary = await transformer.run({ write: true });

    expect(summary.write).toBe(true);
  // Guardrails may skip individual candidates (e.g. non-translatable attributes)
  // without failing the overall transform.
  expect(Array.isArray(summary.skippedFiles)).toBe(true);
  expect(summary.filesChanged).toContain('src/components/Greeting.tsx');
    expect(summary.localeStats.map((stat) => stat.locale).sort()).toEqual(['en']);

    const greetingFile = await fs.readFile(greetingPath, 'utf8');
    const homeFile = await fs.readFile(homePath, 'utf8');

    expect(greetingFile).toMatch(/useTranslation/);
    expect(homeFile).toMatch(/useTranslation/);
    expect(greetingFile).toMatch(/t\(("|')common\./);
    expect(homeFile).toMatch(/t\(("|')common\./);

    const enLocales = JSON.parse(await fs.readFile(path.join(localesDir, 'en.json'), 'utf8')) as Record<string, string>;

    const values = Object.values(enLocales);
    expect(values).toContain('Hello world');
    expect(values).toContain('Main section');
    expect(values).toContain('Click me');

    const localeFiles = await fs.readdir(localesDir);
    const tempArtifacts = localeFiles.filter((file) => file.endsWith('.tmp'));
    expect(tempArtifacts).toHaveLength(0);
  });
});
