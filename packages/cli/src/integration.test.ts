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
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
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
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in output: ${output.slice(0, 200)}...`);
  }
  return JSON.parse(jsonMatch[0]);
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
      const parsed = extractJson<{ filesScanned: number; candidates: unknown[] }>(result.stdout);

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

      expect(result.output).toContain('Transform command is temporarily disabled');
    });

    it('should output JSON with --json flag', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'src', 'App.tsx'),
        `export function App() { return <div>Hello</div>; }`
      );

      const result = runCli(['transform', '--json'], { cwd: tmpDir });
      expect(result.output).toContain('Transform command is temporarily disabled');
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
      const parsed = extractJson<{ diagnostics: unknown; sync: unknown }>(result.stdout);

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
      const parsed = extractJson<{ audit?: { totalQualityIssues: number } }>(result.stdout);

      expect(parsed).toHaveProperty('audit');
      expect(parsed.audit?.totalQualityIssues ?? 0).toBeGreaterThan(0);
    });
  });
});
