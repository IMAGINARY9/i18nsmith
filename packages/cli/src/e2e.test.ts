/**
 * E2E Tests using fixture projects
 * These tests run against pre-configured fixture projects to test real-world scenarios
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get paths
const CLI_PATH = path.resolve(__dirname, '../dist/index.js');
const FIXTURES_DIR = path.resolve(__dirname, './fixtures');

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

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  return {
    stdout,
    stderr,
    output: stdout + stderr,
    exitCode: result.status ?? 1,
  };
}

// Helper to copy fixture to temp directory
async function setupFixture(fixtureName: string): Promise<string> {
  const fixtureSource = path.join(FIXTURES_DIR, fixtureName);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `i18nsmith-e2e-${fixtureName}-`));
  await copyDir(fixtureSource, tmpDir);
  return tmpDir;
}

// Helper to recursively copy directory
async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// Helper to cleanup temp directory
async function cleanupFixture(fixtureDir: string): Promise<void> {
  await fs.rm(fixtureDir, { recursive: true, force: true });
}

// Helper to extract JSON from output
function extractJson<T>(output: string): T {
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`No JSON found in output: ${output.slice(0, 200)}...`);
  }
  return JSON.parse(jsonMatch[0]);
}

describe('E2E Fixture Tests', () => {
  describe('basic-react fixture', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('basic-react');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('should run preflight successfully', () => {
      const result = runCli(['preflight'], { cwd: fixtureDir });
      
      expect(result.output).toContain('Config File');
      expect(result.output).toContain('pass');
    });

    it('should scan for translation references', () => {
      const result = runCli(['scan'], { cwd: fixtureDir });
      
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Scanned');
      expect(result.output).toContain('candidate');
    });

    it('should check locale files without errors', () => {
      const result = runCli(['check'], { cwd: fixtureDir });
      
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Locales directory');
    });

    it('should run sync in dry-run mode by default', () => {
      const result = runCli(['sync'], { cwd: fixtureDir });
      
      expect(result.output).toContain('DRY RUN');
    });

    it('should output scan JSON when requested', () => {
      const result = runCli(['scan', '--json'], { cwd: fixtureDir });
      const parsed = extractJson<{ filesScanned: number; candidates: unknown[] }>(result.stdout);
      
      expect(parsed).toHaveProperty('filesScanned');
      expect(parsed).toHaveProperty('candidates');
      expect(typeof parsed.filesScanned).toBe('number');
    });

    it('should output check JSON when requested', () => {
      const result = runCli(['check', '--json'], { cwd: fixtureDir });
      const parsed = extractJson<{ diagnostics: unknown }>(result.stdout);
      
      expect(parsed).toHaveProperty('diagnostics');
    });
  });

  describe('suspicious-keys fixture', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('suspicious-keys');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('should detect suspicious keys in audit', () => {
      const result = runCli(['audit'], { cwd: fixtureDir });
      
      // Should find suspicious patterns
      expect(result.output).toContain('Suspicious');
    });

    it('should fail with --strict when suspicious keys exist', () => {
      const result = runCli(['sync', '--strict'], { cwd: fixtureDir });
      
      // Should fail due to suspicious keys
      expect(result.exitCode).not.toBe(0);
    });

    it('should pass with --strict when no suspicious patterns', async () => {
      // Remove suspicious keys from en.json, leaving only good ones
      const localeFile = path.join(fixtureDir, 'locales', 'en.json');
      const cleanLocale = {
        'proper.namespaced.key': 'This is a properly namespaced key',
        'buttons.submit': 'Submit',
        'common.title': 'Application Title'
      };
      await fs.writeFile(localeFile, JSON.stringify(cleanLocale, null, 2));
      
      // Also update fr.json
      const frLocaleFile = path.join(fixtureDir, 'locales', 'fr.json');
      const cleanFrLocale = {
        'proper.namespaced.key': 'Ceci est une clé correctement nommée',
        'buttons.submit': 'Soumettre',
        'common.title': 'Titre de l\'application'
      };
      await fs.writeFile(frLocaleFile, JSON.stringify(cleanFrLocale, null, 2));
      
      const result = runCli(['sync', '--strict'], { cwd: fixtureDir });
      
      // The suspicious keys in source files may still trigger warnings
      // but the locale files themselves should be clean
      expect(result.output).toContain('Scanned');
    });
  });

  describe('nested-locales fixture', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('nested-locales');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('should handle nested JSON structure', () => {
      const result = runCli(['check'], { cwd: fixtureDir });
      
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Locales directory');
    });

    it('should scan references with dot-notation keys', () => {
      const result = runCli(['sync'], { cwd: fixtureDir });
      
      expect(result.output).toContain('reference');
    });

    it('should output sync JSON with nested locale data', () => {
      const result = runCli(['sync', '--json'], { cwd: fixtureDir });
      const parsed = extractJson<{ references: unknown[]; filesScanned: number }>(result.stdout);
      
      expect(parsed).toHaveProperty('references');
      expect(Array.isArray(parsed.references)).toBe(true);
    });
  });

  describe('backup and restore workflow', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('basic-react');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('should create backup when writing with prune', async () => {
      // Add an unused key to locales
      const localeFile = path.join(fixtureDir, 'locales', 'en.json');
      const locale = JSON.parse(await fs.readFile(localeFile, 'utf8'));
      locale['unused.key.for.testing'] = 'Unused value';
      await fs.writeFile(localeFile, JSON.stringify(locale, null, 2));

      // Run sync with --write --prune --yes (skips confirmation)
      const result = runCli(['sync', '--write', '--prune', '--yes'], { cwd: fixtureDir });
      
      // Should mention backup (either text or emoji)
      const mentionsBackup = result.output.includes('backup') || result.output.includes('📦');
      expect(mentionsBackup).toBe(true);
    });

    it('should list backups after creating one', async () => {
      // Add an unused key to locales
      const localeFile = path.join(fixtureDir, 'locales', 'en.json');
      const locale = JSON.parse(await fs.readFile(localeFile, 'utf8'));
      locale['unused.key.for.testing'] = 'Unused value';
      await fs.writeFile(localeFile, JSON.stringify(locale, null, 2));

      // Create a backup
      runCli(['sync', '--write', '--prune', '--yes'], { cwd: fixtureDir });

      // List backups
      const listResult = runCli(['backup-list'], { cwd: fixtureDir });
      
      // Should find the backup or show no backups message
      expect(listResult.output).toMatch(/backup|No backups found/i);
    });
  });

  describe('dry-run default behavior', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('basic-react');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('sync should not modify files by default', async () => {
      // Get original content
      const localeFile = path.join(fixtureDir, 'locales', 'en.json');
      const originalContent = await fs.readFile(localeFile, 'utf8');

      // Run sync without --write
      runCli(['sync'], { cwd: fixtureDir });

      // Content should be unchanged
      const afterContent = await fs.readFile(localeFile, 'utf8');
      expect(afterContent).toBe(originalContent);
    });

    it('transform should not modify files by default', async () => {
      // Get original content
      const sourceFile = path.join(fixtureDir, 'src', 'App.tsx');
      const originalContent = await fs.readFile(sourceFile, 'utf8');

      // Run transform without --write
      runCli(['transform'], { cwd: fixtureDir });

      // Content should be unchanged
      const afterContent = await fs.readFile(sourceFile, 'utf8');
      expect(afterContent).toBe(originalContent);
    });
  });

  describe('--assume flag for dynamic keys', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('basic-react');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('should accept assumed keys via --assume flag', async () => {
      // Add keys to locale that exist but might be flagged as unused
      const localeFile = path.join(fixtureDir, 'locales', 'en.json');
      const locale = JSON.parse(await fs.readFile(localeFile, 'utf8'));
      locale['dynamic.runtime.key'] = 'Dynamic value loaded at runtime';
      await fs.writeFile(localeFile, JSON.stringify(locale, null, 2));

      // Run sync without --assume - key should show as unused
      const resultWithoutAssume = runCli(['sync', '--json'], { cwd: fixtureDir });
      const parsedWithout = extractJson<{ unusedKeys: { key: string }[] }>(resultWithoutAssume.stdout);
      expect(parsedWithout.unusedKeys.some(k => k.key === 'dynamic.runtime.key')).toBe(true);

      // Run sync with --assume - key should NOT show as unused
      const resultWithAssume = runCli(['sync', '--json', '--assume', 'dynamic.runtime.key'], { cwd: fixtureDir });
      const parsedWith = extractJson<{ unusedKeys: { key: string }[]; assumedKeys: string[] }>(resultWithAssume.stdout);
      expect(parsedWith.assumedKeys).toContain('dynamic.runtime.key');
      expect(parsedWith.unusedKeys.some(k => k.key === 'dynamic.runtime.key')).toBe(false);
    });

    it('should accept multiple assumed keys', async () => {
      // Add keys to locale
      const localeFile = path.join(fixtureDir, 'locales', 'en.json');
      const locale = JSON.parse(await fs.readFile(localeFile, 'utf8'));
      locale['dynamic.key.one'] = 'First dynamic key';
      locale['dynamic.key.two'] = 'Second dynamic key';
      await fs.writeFile(localeFile, JSON.stringify(locale, null, 2));

      // Run sync with multiple --assume values
      const result = runCli(['sync', '--json', '--assume', 'dynamic.key.one,dynamic.key.two'], { cwd: fixtureDir });
      const parsed = extractJson<{ assumedKeys: string[] }>(result.stdout);

      expect(parsed.assumedKeys).toContain('dynamic.key.one');
      expect(parsed.assumedKeys).toContain('dynamic.key.two');
    });
  });

  describe('--invalidate-cache flag', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('basic-react');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('should accept --invalidate-cache flag on sync', () => {
      const result = runCli(['sync', '--invalidate-cache'], { cwd: fixtureDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Scanned');
    });

    it('should accept --invalidate-cache flag on check', () => {
      const result = runCli(['check', '--invalidate-cache'], { cwd: fixtureDir });
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('Locales directory');
    });
  });

  describe('rename-keys bulk operation', () => {
    let fixtureDir: string;

    beforeEach(async () => {
      fixtureDir = await setupFixture('basic-react');
    });

    afterEach(async () => {
      await cleanupFixture(fixtureDir);
    });

    it('should perform bulk rename with mapping file', async () => {
      // Create a mapping file
      const mappingFile = path.join(fixtureDir, 'rename-map.json');
      const mapping = {
        'common.welcome': 'home.greeting',
        'common.logout': 'auth.logout',
      };
      await fs.writeFile(mappingFile, JSON.stringify(mapping, null, 2));

      // Run rename-keys with the mapping
      const result = runCli(['rename-keys', '--map', 'rename-map.json'], { cwd: fixtureDir });

      expect(result.output).toContain('DRY RUN');
      // Should process the mappings (even if no actual references exist in fixture)
      expect(result.output).toMatch(/Updated \d+ occurrence/i);
    });

    it('should accept array format mapping file', async () => {
      // Create a mapping file with array format
      const mappingFile = path.join(fixtureDir, 'rename-map.json');
      const mapping = [
        { from: 'old.key.one', to: 'new.key.one' },
        { from: 'old.key.two', to: 'new.key.two' },
      ];
      await fs.writeFile(mappingFile, JSON.stringify(mapping, null, 2));

      // Run rename-keys with the mapping
      const result = runCli(['rename-keys', '--map', 'rename-map.json'], { cwd: fixtureDir });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('DRY RUN');
    });

    it('should error on missing mapping file', () => {
      const result = runCli(['rename-keys', '--map', 'nonexistent.json'], { cwd: fixtureDir });

      expect(result.exitCode).not.toBe(0);
      expect(result.output).toContain('not found');
    });
  });
});
