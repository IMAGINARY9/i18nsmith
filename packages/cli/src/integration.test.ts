/**
 * Integration tests for CLI commands
 * These tests run the actual CLI commands against real file systems
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureCliBuilt } from './test-helpers/ensure-cli-built';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get the correct CLI path regardless of where tests are run from
// During tests, __dirname points to src/, so we go up one level to find dist/
const CLI_PATH = path.resolve(__dirname, '../dist/index.js');

// Helper to run CLI commands
function runCli(
  args: string[],
  options: { cwd?: string } = {}
): { stdout: string; stderr: string; output: string; exitCode: number } {
  // Clear known debug env vars so the test output is deterministic even when
  // developer environments set DEBUG_* flags. Preserve essential env vars.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: 'true',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };
  // Remove any DEBUG_* flags that may leak into the spawned CLI process
  delete env.DEBUG_VUE_PARSER;
  delete env.DEBUG_REFEXT;
  delete env.DEBUG_SYNC_REF;
  delete env.DEBUG_VUE_MUTATE;

  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    timeout: 30000,
    env,
  });

  // Log errors for debugging
  if (result.error) {
    console.error('CLI execution error:', result.error);
  }

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  return {
    stdout,
    stderr,
    output: stdout + stderr,
    exitCode: result.status ?? 1,
  };
}

// Helper to extract JSON from CLI output (may contain log messages before JSON)
function extractJson<T>(output: string): T {
  // Use brace-counting to find all complete top-level JSON objects in the output.
  // This correctly handles nested braces (arrays/objects inside the top-level object).
  const candidates: string[] = [];
  let i = 0;
  while (i < output.length) {
    if (output[i] === '{') {
      let depth = 0;
      let inString = false;
      let escape = false;
      let j = i;
      for (; j < output.length; j++) {
        const ch = output[j];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) { candidates.push(output.slice(i, j + 1)); break; }
        }
      }
      i = j + 1;
    } else {
      i++;
    }
  }

  if (!candidates.length) {
    throw new Error(`No JSON found in output: ${output.slice(0, 200)}...`);
  }

  // Prefer the largest candidate (most likely the top-level summary).
  candidates.sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_err) {
      // try next candidate
    }
  }
  throw new Error(`No valid JSON block found in output: ${output.slice(0, 400)}...`);
}

describe('CLI Integration Tests', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await ensureCliBuilt(CLI_PATH);
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-cli-integration-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('preflight command', () => {
    it('should fail when no config file exists', async () => {
      const result = runCli(['preflight'], { cwd: tmpDir });

      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('Config File');
    });

    it('should pass with valid config and locales', async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), '{}');
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(path.join(tmpDir, 'src', 'App.tsx'), 'export function App() { return <div>Hello</div>; }');

      const result = runCli(['preflight'], { cwd: tmpDir });

      expect(result.output).toContain('Config File');
      expect(result.output).toContain('pass');
    });

    it('should output JSON when --json flag is used', async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), '{}');
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(path.join(tmpDir, 'src', 'App.tsx'), 'export function App() {}');

      const result = runCli(['preflight', '--json'], { cwd: tmpDir });

      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty('passed');
      expect(parsed).toHaveProperty('checks');
      expect(Array.isArray(parsed.checks)).toBe(true);
    });

    it('should create missing directories with --fix', async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'i18n/locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(path.join(tmpDir, 'src', 'App.tsx'), 'export function App() {}');

      runCli(['preflight', '--fix'], { cwd: tmpDir });

      const localesDirExists = await fs.access(path.join(tmpDir, 'i18n', 'locales'))
        .then(() => true)
        .catch(() => false);
      
      expect(localesDirExists).toBe(true);
    });
  });

  describe('scan command', () => {
    beforeEach(async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr', 'de'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), '{}');
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    });

    it('should scan and find translatable strings', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `
import React from 'react';

export function App() {
  return (
    <div>
      <h1>Welcome to our app</h1>
      <p>This is a description</p>
    </div>
  );
}
`
      );

      const result = runCli(['scan'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Scanned');
    });

    it('should output JSON when --json flag is used', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );

      const result = runCli(['scan', '--json'], { cwd: tmpDir });
  const parsed = extractJson<{ filesScanned: number; candidates: unknown[] }>(result.output);

      expect(parsed).toHaveProperty('filesScanned');
      expect(parsed).toHaveProperty('candidates');
    });
  });

  describe('sync command', () => {
    beforeEach(async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(
        path.join(tmpDir, 'locales', 'en.json'),
        JSON.stringify({ 'existing.key': 'Existing Value' }, null, 2)
      );
      await fs.writeFile(
        path.join(tmpDir, 'locales', 'fr.json'),
        JSON.stringify({ 'existing.key': 'Valeur existante' }, null, 2)
      );
      await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    });

    it('should run dry-run by default', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return <div>{t('new.key')}</div>;
}
`
      );

      const result = runCli(['sync'], { cwd: tmpDir });

      expect(result.output).toContain('DRY RUN');
    });

    it('should add missing keys with --write', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return <div>{t('new.key')}</div>;
}
`
      );

      const result = runCli(['sync', '--write', '-y'], { cwd: tmpDir });
      expect(result.exitCode).toBe(0);

      const enContent = await fs.readFile(path.join(tmpDir, 'locales', 'en.json'), 'utf8');
      const enData = JSON.parse(enContent);
      expect(enData).toHaveProperty('new.key');
    });

    it('should not prune by default even with --write', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );

      runCli(['sync', '--write', '-y'], { cwd: tmpDir });

      const enContent = await fs.readFile(path.join(tmpDir, 'locales', 'en.json'), 'utf8');
      const enData = JSON.parse(enContent);
      expect(enData).toHaveProperty('existing.key');
    });

    it('should prune unused keys with --write --prune', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );

      runCli(['sync', '--write', '--prune', '-y'], { cwd: tmpDir });

      const enContent = await fs.readFile(path.join(tmpDir, 'locales', 'en.json'), 'utf8');
      const enData = JSON.parse(enContent);
      expect(enData).not.toHaveProperty('existing.key');
    });

    it('should delegate --check to the health check command', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `import { useTranslation } from 'react-i18next';
export function App() {
  const { t } = useTranslation();
  return <div>{t('existing.key')}</div>;
}`
      );

      const result = runCli(['sync', '--check'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('guided repository health check');
    });

    it('should fail via delegated check when using --check --strict and audit issues exist', async () => {
      const duplicateLocale = {
        'existing.key': 'Existing Value',
        'buttons.submit': 'Submit',
        'cta.submit': 'Submit',
      };
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), JSON.stringify(duplicateLocale, null, 2));
      await fs.writeFile(path.join(tmpDir, 'locales', 'fr.json'), JSON.stringify(duplicateLocale, null, 2));
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `import { useTranslation } from 'react-i18next';
export function App() {
  const { t } = useTranslation();
  return <div>{t('existing.key')}</div>;
}`
      );

      const result = runCli(['sync', '--check', '--strict'], { cwd: tmpDir });

      expect(result.exitCode).toBe(10);
      expect(result.output).toContain('Audit detected');
    });

    it('should create backup when pruning', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );

      runCli(['sync', '--write', '--prune', '-y'], { cwd: tmpDir });

      const backupDir = path.join(tmpDir, '.i18nsmith-backup');
      const backupExists = await fs.access(backupDir).then(() => true).catch(() => false);
      expect(backupExists).toBe(true);
    });

    it('CLI end-to-end: detects nested $t inside template object args (I18nDemo.vue)', async () => {
      // Setup Vue SFC that uses a nested $t(...) inside an interpolation object
      const vue = `
<template>
  <p v-if="name">{{ $t('common.components.i18ndemo.arg0-name.4ac48a', { arg0: $t('demo.card.greeting'), name }) }}</p>
</template>
`;

      await fs.mkdir(path.join(tmpDir, 'src', 'components'), { recursive: true });
      await fs.writeFile(path.join(tmpDir, 'src', 'components', 'I18nDemo.vue'), vue);

      const en = {
        common: { components: { i18ndemo: { 'arg0-name': '{arg0} {name}' } } },
        demo: { card: { greeting: 'Hello' } }
      };
      const es = {
        common: { components: { i18ndemo: { 'arg0-name': '{arg0} {name}' } } },
        demo: { card: { greeting: 'Hola' } }
      };

      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), JSON.stringify(en, null, 2));
      await fs.writeFile(path.join(tmpDir, 'locales', 'fr.json'), JSON.stringify(es, null, 2));

      // Update config to include .vue files for this test
      const cfgPath = path.join(tmpDir, 'i18n.config.json');
      const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
      cfg.include = ['src/**/*.vue', 'src/**/*.{ts,js,tsx}'];
      await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2));

  const result = runCli(['sync', '--json'], { cwd: tmpDir });
  expect(result.exitCode).toBe(0);

  // Sanity check: CLI output should contain the quoted key somewhere so
  // editors/CI that scan the output can detect the reference even when
  // there are additional log lines present.
  expect(result.output).toContain('"demo.card.greeting"');

      // Also try to parse JSON summary if possible and validate references.
      // If parsing fails during CI or debugging, print raw output for diagnosis.
      try {
        const parsed = extractJson<any>(result.output);
        const referenced = parsed.references.map((r: any) => r.key);
        const unused = parsed.unusedKeys.map((u: any) => u.key);

        expect(referenced).toContain('demo.card.greeting');
        expect(unused).not.toContain('demo.card.greeting');
      } catch (err) {
        // Dump output for debugging in test logs then rethrow so CI shows failure
        // (this helps capture the raw CLI output when test fails).
        // eslint-disable-next-line no-console
        console.error('CLI raw output (truncated):', result.output.slice(0, 4000));
        throw err;
      }
    });

    it('should skip backup with --no-backup', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );

      runCli(['sync', '--write', '--prune', '-y', '--no-backup'], { cwd: tmpDir });

      const backupDir = path.join(tmpDir, '.i18nsmith-backup');
      const backupExists = await fs.access(backupDir).then(() => true).catch(() => false);
      expect(backupExists).toBe(false);
    });
  });

  describe('backup commands', () => {
    beforeEach(async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(
        path.join(tmpDir, 'locales', 'en.json'),
        JSON.stringify({ 'original.key': 'Original' }, null, 2)
      );
      await fs.mkdir(path.join(tmpDir, 'src'));
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );
    });

    it('should list no backups when none exist', async () => {
      const result = runCli(['backup-list'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('No backups found');
    });

    it('should list backups after sync creates one', async () => {
      runCli(['sync', '--write', '--prune', '-y'], { cwd: tmpDir });

      const result = runCli(['backup-list'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Found');
      expect(result.output).toContain('backup');
    });
  });

  describe('transform command', () => {
    beforeEach(async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
        translationAdapter: {
          module: 'react-i18next',
          hookName: 'useTranslation',
          translationIdentifier: 't',
        },
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), '{}');
      await fs.mkdir(path.join(tmpDir, 'src'));
    });

    it('should run dry-run by default', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello World</div>; }`
      );

      const result = runCli(['transform'], { cwd: tmpDir });

      expect(result.output).toContain('Planning transform (dry-run)');
      expect(result.exitCode).toBe(0);
    });

    it('should output JSON with --json flag', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );

      const result = runCli(['transform', '--json'], { cwd: tmpDir });
      expect(result.output).toContain('Planning transform (dry-run)');
      expect(result.exitCode).toBe(0);
    });

    it('extraction should not include structural opening punctuation (Items ({count}) case)', async () => {
      const content = `export function App() {
  const count = 5;
  const items = ['a','b'];
  return (
    <>
      <p>Items ({count}): {items.join(', ')}</p>
      <p>{'Items (' + count + ')'}</p>
    </>
  );
}`;

      await fs.writeFile(path.join(tmpDir, 'src', 'App.tsx'), content);

      const result = runCli(['transform', '--json'], { cwd: tmpDir });
      expect(result.exitCode).toBe(0);
      const parsed = extractJson<any>(result.output);
      const candidates = parsed.candidates || [];

      // No candidate text should include the structural '(' token before the placeholder
      const hasBadText = candidates.some((c: any) => typeof c.text === 'string' && c.text.includes('Items ('));
      expect(hasBadText).toBe(false);

      // Find the Items-related candidate and assert its suggestedKey is derived from the static "Items"
      const itemsCandidate = candidates.find((c: any) => typeof c.text === 'string' && /Items/.test(c.text));
      expect(itemsCandidate).toBeDefined();
      expect(itemsCandidate.text).not.toContain('(');
      if (itemsCandidate.interpolation) {
        expect(itemsCandidate.interpolation.template).not.toMatch(/Items \(/);
      }
    });
  });

  describe('check command', () => {
    beforeEach(async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), JSON.stringify({ 'hello': 'Hello' }, null, 2));
      await fs.writeFile(path.join(tmpDir, 'locales', 'fr.json'), JSON.stringify({ 'hello': 'Bonjour' }, null, 2));
      await fs.mkdir(path.join(tmpDir, 'src'));
    });

    it('should run health check successfully', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return <div>{t('hello')}</div>;
}
`
      );

      const result = runCli(['check'], { cwd: tmpDir });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Locales directory');
    });

    it('should output JSON with --json flag', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  return <div>{t('hello')}</div>;
}
`
      );

      const result = runCli(['check', '--json'], { cwd: tmpDir });
  const parsed = extractJson<{ diagnostics: unknown; sync: unknown }>(result.output);

      expect(parsed).toHaveProperty('diagnostics');
      expect(parsed).toHaveProperty('sync');
    });

    it('should surface locale audit results and fail with --audit-strict', async () => {
      const duplicateLocale = {
        'hello': 'Hello',
        'buttons.submit': 'Submit',
        'cta.submit': 'Submit',
      };
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), JSON.stringify(duplicateLocale, null, 2));
      await fs.writeFile(path.join(tmpDir, 'locales', 'fr.json'), JSON.stringify(duplicateLocale, null, 2));
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `import { useTranslation } from 'react-i18next';
export function App() {
  const { t } = useTranslation();
  return <div>{t('hello')}</div>;
}`
      );

      const result = runCli(['check', '--audit', '--audit-strict'], { cwd: tmpDir });

      expect(result.exitCode).toBe(10);
      expect(result.output).toContain('Locale quality audit');
    });

    it('should include audit payload in JSON output when --audit is set', async () => {
      const duplicateLocale = {
        'hello': 'Hello',
        'buttons.submit': 'Submit',
        'cta.submit': 'Submit',
      };
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), JSON.stringify(duplicateLocale, null, 2));
      await fs.writeFile(path.join(tmpDir, 'locales', 'fr.json'), JSON.stringify(duplicateLocale, null, 2));
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `import { useTranslation } from 'react-i18next';
export function App() {
  const { t } = useTranslation();
  return <div>{t('hello')}</div>;
}`
      );

      const result = runCli(['check', '--audit', '--json'], { cwd: tmpDir });
  const parsed = extractJson<{ audit?: { totalQualityIssues: number } }>(result.output);

      expect(parsed).toHaveProperty('audit');
      expect(parsed.audit?.totalQualityIssues ?? 0).toBeGreaterThan(0);
    });
  });
});
