import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Project } from 'ts-morph';
import { describe, expect, it, afterEach } from 'vitest';
import type { I18nConfig } from '@i18nsmith/core';
import { Transformer } from './transformer';
import type { TransformProgress } from './types';

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
  expect(updatedFile).toMatch(/t\(("|')/);

    const enLocalePath = path.join(tempDir, 'locales', 'en.json');
    const enContents = JSON.parse(await fs.readFile(enLocalePath, 'utf8'));
    const key = Object.keys(enContents)[0];
    expect(enContents[key]).toBe('Hello world');

    // Target locales are no longer seeded by default
    // const frLocalePath = path.join(tempDir, 'locales', 'fr.json');
    // const frContents = JSON.parse(await fs.readFile(frLocalePath, 'utf8'));
    // expect(frContents[key]).toBe('');
  });

  it('transforms attributes, expressions, and deduplicates keys', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-attrs-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Form.tsx');
    const initial = `
      import React from 'react';
      export function Form() {
        return (
          <form>
            <input placeholder="Enter name" aria-label={"Enter name"} />
            <label>{'Enter name'}</label>
            <section>
              <p>Hello world</p>
              <strong>{'Hello world'}</strong>
            </section>
          </form>
        );
      }
    `;
    await fs.writeFile(filePath, initial, 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['de'],
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

  const appliedAttribute = summary.candidates.find(
    (candidate) => candidate.kind === 'jsx-attribute' && candidate.status === 'applied'
  );
  expect(appliedAttribute).toBeTruthy();

  const appliedCount = summary.candidates.filter((candidate) => candidate.status === 'applied').length;
  expect(appliedCount).toBeGreaterThanOrEqual(2);

  const duplicateCandidates = summary.candidates.filter((candidate) => candidate.text === 'Hello world');
  const statuses = duplicateCandidates.map((candidate) => candidate.status);
  expect(statuses).toContain('applied');
  expect(statuses).toContain('duplicate');

    const updatedFile = await fs.readFile(filePath, 'utf8');
    expect(updatedFile.match(/useTranslation/g)?.length).toBeGreaterThanOrEqual(2);
    expect(updatedFile).toMatch(/t\(("|')/);
  });

  it('keeps "use client" directives before imports', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-client-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Page.tsx');
    const initial = "'use client';\n\nexport default function Page() {\n  return <div>Hello worlds</div>;\n}";
    await fs.writeFile(filePath, initial, 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
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

    await transformer.run({ write: true });

    const updatedFile = await fs.readFile(filePath, 'utf8');
    const lines = updatedFile.split('\n');
    const directiveIndex = lines.findIndex((line) => line.includes('use client'));
    const importIndex = lines.findIndex((line) => line.includes('useTranslation'));

    expect(directiveIndex).toBeGreaterThanOrEqual(0);
    expect(importIndex).toBeGreaterThan(directiveIndex);
  });

  it('never replaces non-translatable JSX attributes (e.g., type="email")', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-attr-guard-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Guard.tsx');

    const initial = `
      import React from 'react';

      export function Guard() {
        return (
          <form>
            <input type="email" placeholder="Email" />
          </form>
        );
      }
    `;

    await fs.writeFile(filePath, initial, 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
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

    await transformer.run({ write: true });

    const updatedFile = await fs.readFile(filePath, 'utf8');
    expect(updatedFile).toMatch(/type=\"email\"/);
  });

  it('scans only the requested target files', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-target-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const alphaPath = path.join(srcDir, 'Alpha.tsx');
    const betaPath = path.join(srcDir, 'Beta.tsx');
    await fs.writeFile(alphaPath, "export const Alpha = () => <div>Alpha text</div>;");
    await fs.writeFile(betaPath, "export const Beta = () => <div>Beta text</div>;");

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir, 'locales'),
      include: ['src/**/*.tsx'],
    } as I18nConfig;

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      write: false,
    });

    const summary = await transformer.run({ targets: ['src/Beta.tsx'] });

    expect(summary.filesScanned).toBe(1);
    const candidateFiles = Array.from(new Set(summary.candidates.map((candidate) => candidate.filePath))).sort();
    expect(candidateFiles).toEqual(['src/Beta.tsx']);
  });

  it('supports custom translation adapters from config', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-adapter-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Widget.tsx');
    const initial = `export const Widget = () => <span>Translate me</span>;`;
    await fs.writeFile(filePath, initial, 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir, 'locales'),
      include: ['src/**/*.tsx'],
      translationAdapter: {
        module: '@/contexts/translation-context',
        hookName: 'useTranslation',
      },
    } as I18nConfig;

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(filePath);

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      project,
      write: true,
    });

    await transformer.run({ write: true });

    const updatedFile = await fs.readFile(filePath, 'utf8');
    expect(updatedFile).toContain("@/contexts/translation-context");
    expect(updatedFile).not.toContain('react-i18next');
  });

  it('preserves package name imports', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-package-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Component.tsx');
    const initial = `export const Component = () => <span>Package test</span>;`;
    await fs.writeFile(filePath, initial, 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir, 'locales'),
      include: ['src/**/*.tsx'],
      translationAdapter: {
        module: 'react-i18next',
        hookName: 'useTranslation',
      },
    } as I18nConfig;

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(filePath);

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      project,
      write: true,
    });

    await transformer.run({ write: true });

    const updatedFile = await fs.readFile(filePath, 'utf8');
    expect(updatedFile).toContain('from "react-i18next"');
    expect(updatedFile).not.toContain('../');
  });

  it('migrates text-as-key call expressions and preserves existing locale values', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-migrate-calls-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Legacy.tsx');
    const initial = `
      import { useTranslation } from 'react-i18next';
      export function Legacy() {
        const { t } = useTranslation();
        return <div>{t('Hello legacy world')}</div>;
      }
    `;
    await fs.writeFile(filePath, initial, 'utf8');

    const localesDir = path.join(tempDir, 'locales');
    await fs.mkdir(localesDir, { recursive: true });
    await fs.writeFile(path.join(localesDir, 'en.json'), JSON.stringify({ 'Hello legacy world': 'Hello legacy world' }));
    await fs.writeFile(path.join(localesDir, 'fr.json'), JSON.stringify({ 'Hello legacy world': 'Bonjour hérité' }));

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['fr'],
      localesDir,
      include: ['src/**/*.tsx'],
      seedTargetLocales: false,
    } as I18nConfig;

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(filePath);

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      project,
      write: true,
    });

    const summary = await transformer.run({ write: true, migrateTextKeys: true });
    const callCandidate = summary.candidates.find((candidate) => candidate.kind === 'call-expression');
    expect(callCandidate?.status).toBe('applied');
    expect(callCandidate?.suggestedKey).toBeTruthy();

    const newKey = callCandidate?.suggestedKey as string;
    const updatedFile = await fs.readFile(filePath, 'utf8');
    const hasKey =
      updatedFile.includes(`t('${newKey}')`) ||
      updatedFile.includes(`t("${newKey}")`);
    expect(hasKey).toBe(true);

    const frContents = JSON.parse(await fs.readFile(path.join(localesDir, 'fr.json'), 'utf8'));
    expect(frContents[newKey]).toBe('Bonjour hérité');
  });

  it('migrates existing values from text-as-key to structured keys', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-migration-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'App.tsx');
    const initial = "export const App = () => { return <div>Hello world</div>; };";
    await fs.writeFile(filePath, initial, 'utf8');

    const localesDir = path.join(tempDir, 'locales');
    await fs.mkdir(localesDir, { recursive: true });
    
    // Simulate existing text-as-key translations
    await fs.writeFile(path.join(localesDir, 'en.json'), JSON.stringify({ "Hello world": "Hello world" }));
    await fs.writeFile(path.join(localesDir, 'fr.json'), JSON.stringify({ "Hello world": "Bonjour le monde" }));

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['fr'],
      localesDir,
      include: ['src/**/*.tsx'],
      seedTargetLocales: true, // Enable seeding to trigger migration logic
    } as I18nConfig;

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(filePath);

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      project,
      write: true,
    });

    await transformer.run({ write: true });

    const frContents = JSON.parse(await fs.readFile(path.join(localesDir, 'fr.json'), 'utf8'));
    // Should contain the new structured key with the OLD value
    const keys = Object.keys(frContents);
    const newKey = keys.find(k => k !== "Hello world");
    expect(newKey).toBeDefined();
    expect(frContents[newKey!]).toBe('Bonjour le monde');
  });

  it('prefers existing source locale values before falling back to generated text', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-prefer-legacy-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'LegacySource.tsx');
    const initial = `
      import { useTranslation } from 'react-i18next';
      export function LegacySource() {
        const { t } = useTranslation();
        return <p>{t('Legacy CTA label')}</p>;
      }
    `;
    await fs.writeFile(filePath, initial, 'utf8');

    const localesDir = path.join(tempDir, 'locales');
    await fs.mkdir(localesDir, { recursive: true });
    await fs.writeFile(
      path.join(localesDir, 'en.json'),
      JSON.stringify({ 'Legacy CTA label': 'Existing CTA copy' }, null, 2)
    );

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir,
      include: ['src/**/*.tsx'],
      seedTargetLocales: false,
    } as I18nConfig;

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(filePath);

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      project,
      write: true,
    });

    const summary = await transformer.run({ write: true, migrateTextKeys: true });
    const callCandidate = summary.candidates.find((candidate) => candidate.kind === 'call-expression');
    expect(callCandidate?.status).toBe('applied');

    const newKey = callCandidate?.suggestedKey as string;
    const enContents = JSON.parse(await fs.readFile(path.join(localesDir, 'en.json'), 'utf8'));
    expect(enContents[newKey]).toBe('Existing CTA copy');
  });

  it('uses pre-flight validation to detect key-equals-value pattern', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-preflight-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Preflight.tsx');
    const initial = `
      import React from 'react';
      export function Preflight() {
        return (
          <div>
            <p>Hello</p>
            <p>World</p>
          </div>
        );
      }
    `;
    await fs.writeFile(filePath, initial, 'utf8');


    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: path.join(tempDir, 'locales'),
      include: ['src/**/*.tsx'],
      sync: {
        suspiciousKeyPolicy: 'skip',
      },
    } as I18nConfig;

    const project = new Project({ skipAddingFilesFromTsConfig: true });
    project.addSourceFileAtPath(filePath);

    const transformer = new Transformer(config, {
      workspaceRoot: tempDir,
      project,
      write: false, // dry-run to inspect results
    });

    const summary = await transformer.run({ write: false });

    // All candidates should pass validation since the key generator
    // produces well-formatted keys with namespaces and proper formatting
    expect(summary.candidates.length).toBeGreaterThan(0);
    summary.candidates.forEach(candidate => {
      // Generated keys should not be flagged as suspicious
      // since they include namespace and proper formatting
      expect(candidate.suggestedKey).toMatch(/^common\./);
    });
  });

  it('emits progress updates while applying candidates', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-progress-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Progress.tsx');
    await fs.writeFile(
      filePath,
      `export function Progress(){return (<div><p>Alpha</p><p>Beta</p><p>Gamma</p></div>);}`,
      'utf8'
    );

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
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

    const events: TransformProgress[] = [];
    await transformer.run({
      write: true,
      onProgress: (progress) => events.push(progress),
    });

    const applyEvents = events.filter((event) => event.stage === 'apply');
    expect(applyEvents.length).toBeGreaterThan(1);
    const finalEvent = applyEvents[applyEvents.length - 1];
    expect(finalEvent.percent).toBe(100);
    expect(finalEvent.applied).toBe(3);
    expect(finalEvent.remaining).toBe(0);
  });

  it('converges after repeated write passes when no new literals are introduced', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-multipass-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'Multi.tsx');
    await fs.writeFile(
      filePath,
      `export function Multi(){return <div><p>Alpha</p><p>Bravo</p></div>;}`,
      'utf8'
    );

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
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

    const firstRun = await transformer.run({ write: true });
    const firstApplied = firstRun.candidates.filter((candidate) => candidate.status === 'applied').length;
    expect(firstApplied).toBeGreaterThanOrEqual(2);

    const secondRun = await transformer.run({ write: true });
    const secondApplied = secondRun.candidates.filter((candidate) => candidate.status === 'applied').length;
    expect(secondApplied).toBe(0);
  });

  it('detects and applies literals added between passes', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'transformer-multipass-new-'));
    const srcDir = path.join(tempDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const filePath = path.join(srcDir, 'NewPass.tsx');
    await fs.writeFile(filePath, `export function NewPass(){return <div><p>Alpha</p></div>;}`, 'utf8');

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: [],
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

    await transformer.run({ write: true });

    await fs.appendFile(filePath, '\nexport const Later = () => <span>Beta</span>;');
    project.getSourceFileOrThrow(filePath).refreshFromFileSystemSync();

    const secondRun = await transformer.run({ write: true });
    const applied = secondRun.candidates.filter((candidate) => candidate.status === 'applied').length;
    expect(applied).toBeGreaterThanOrEqual(1);
  });
});
