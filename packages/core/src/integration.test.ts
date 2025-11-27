/**
 * Integration Test Suite
 *
 * End-to-end tests simulating real project structures and workflows.
 * These tests verify the system works correctly in realistic scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Syncer } from './syncer.js';
import { LocaleStore } from './locale-store.js';
import { I18nConfig } from './config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Integration', () => {
  let tempDir: string;
  let srcDir: string;
  let localesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-integration-'));
    srcDir = path.join(tempDir, 'src');
    localesDir = path.join(tempDir, 'locales');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(localesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Next.js App Router Project
  // ─────────────────────────────────────────────────────────────────────────────
  describe('Next.js App Router project', () => {
    it('scans and syncs page components correctly', async () => {
      // Create a realistic Next.js app router structure
      const pageContent = `
'use client';

import { useTranslation } from 'next-i18next';

export default function LoginPage() {
  const { t } = useTranslation('auth');

  return (
    <div>
      <h1>{t('auth.login.title')}</h1>
      <p>{t('auth.login.subtitle')}</p>
      <button>{t('common.submit')}</button>
    </div>
  );
}
`;
      await fs.writeFile(path.join(srcDir, 'page.tsx'), pageContent);

      // Create initial locale file
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          'auth.login.title': 'Welcome Back',
          'common.submit': 'Submit',
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: ['de'],
        localesDir: 'locales',
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      const summary = await syncer.run({ write: true });

      expect(summary.filesScanned).toBe(1);
      expect(summary.references.length).toBe(3);

      // Should detect the missing key
      const missingKeys = summary.missingKeys.map(m => m.key);
      expect(missingKeys).toContain('auth.login.subtitle');
    });

    it('handles layout components with shared translations', async () => {
      // Layout component with common translations
      const layoutContent = `
import { useTranslation } from 'next-i18next';

export default function RootLayout({ children }) {
  const { t } = useTranslation();

  return (
    <html>
      <body>
        <nav>
          <a href="/">{t('nav.home')}</a>
          <a href="/about">{t('nav.about')}</a>
        </nav>
        {children}
        <footer>{t('common.copyright')}</footer>
      </body>
    </html>
  );
}
`;
      await fs.writeFile(path.join(srcDir, 'layout.tsx'), layoutContent);
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({}, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      const summary = await syncer.run({ write: true });

      expect(summary.references.length).toBe(3);
      expect(summary.missingKeys.map(m => m.key)).toContain('nav.home');
      expect(summary.missingKeys.map(m => m.key)).toContain('nav.about');
      expect(summary.missingKeys.map(m => m.key)).toContain('common.copyright');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Existing Translation Preservation
  // ─────────────────────────────────────────────────────────────────────────────
  describe('preserves existing translations during migration', () => {
    it('keeps existing translations when adding new keys (retainLocales: true)', async () => {
      // Create source with t() calls
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.save'); const y = t('common.cancel');`
      );

      // Pre-existing translations
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          'common.save': 'Save',
          'common.delete': 'Delete', // Unused but should be preserved
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        sync: { retainLocales: true }, // Explicitly preserve unused keys
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      const summary = await syncer.run({ write: true });

      // Read back the locale file
      const content = await fs.readFile(path.join(localesDir, 'en.json'), 'utf8');
      const data = JSON.parse(content);

      // Existing translation preserved
      expect(data['common.save']).toBe('Save');
      // Unused key shows up in summary but NOT removed (retainLocales: true)
      expect(summary.unusedKeys.map(u => u.key)).toContain('common.delete');
      expect(data['common.delete']).toBe('Delete');
      // New key added
      expect(data['common.cancel']).toBeDefined();
    });

    it('prunes unused keys when retainLocales is false', async () => {
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.save');`
      );

      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          'common.save': 'Save',
          'common.unused': 'This should be removed',
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        sync: { retainLocales: false },
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      await syncer.run({ write: true });

      const content = await fs.readFile(path.join(localesDir, 'en.json'), 'utf8');
      const data = JSON.parse(content);

      expect(data['common.save']).toBe('Save');
      expect(data['common.unused']).toBeUndefined();
    });

    it('prunes unused keys when explicitly selected', async () => {
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.save');`
      );

      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          'common.save': 'Save',
          'common.unused': 'This should be removed',
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        sync: { retainLocales: true }, // Even with retain, selection overrides
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      // Explicitly select the unused key for removal
      await syncer.run({
        write: true,
        selection: { unused: ['common.unused'] },
      });

      const content = await fs.readFile(path.join(localesDir, 'en.json'), 'utf8');
      const data = JSON.parse(content);

      expect(data['common.save']).toBe('Save');
      expect(data['common.unused']).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Mixed Nested/Flat Locale Files
  // ─────────────────────────────────────────────────────────────────────────────
  describe('handles mixed nested/flat locale files', () => {
    it('preserves nested format on nested input', async () => {
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.buttons.save'); const y = t('common.buttons.cancel');`
      );

      // Nested structure
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          common: {
            buttons: {
              save: 'Save',
            },
          },
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        locales: { format: 'auto' },
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      await syncer.run({ write: true });

      const content = await fs.readFile(path.join(localesDir, 'en.json'), 'utf8');
      const data = JSON.parse(content);

      // Should maintain nested structure
      expect(data.common.buttons.save).toBe('Save');
      expect(data.common.buttons.cancel).toBeDefined();
    });

    it('flattens when format=flat is specified', async () => {
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.save'); const y = t('common.cancel');`
      );

      // Start with nested
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          common: { save: 'Save' },
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        locales: { format: 'flat' },
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      await syncer.run({ write: true });

      const content = await fs.readFile(path.join(localesDir, 'en.json'), 'utf8');
      const data = JSON.parse(content);

      // Should be flat
      expect(data['common.save']).toBe('Save');
      expect(data['common.cancel']).toBeDefined();
      expect(data.common).toBeUndefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Dynamic Key Globs
  // ─────────────────────────────────────────────────────────────────────────────
  describe('respects dynamicKeyGlobs for runtime keys', () => {
    it('does not flag dynamic keys matching glob patterns as unused', async () => {
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.save');`
      );

      // Has keys that might seem unused but are loaded dynamically
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          'common.save': 'Save',
          'errors.e001': 'Error 001',
          'errors.e002': 'Error 002',
          'errors.e003': 'Error 003',
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        sync: {
          dynamicKeyGlobs: ['errors.*'],
        },
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      const summary = await syncer.run({ write: true });

      // Keys matching dynamicKeyGlobs should not appear as unused
      const unusedKeyNames = summary.unusedKeys.map(u => u.key);
      expect(unusedKeyNames).not.toContain('errors.e001');
      expect(unusedKeyNames).not.toContain('errors.e002');
      expect(unusedKeyNames).not.toContain('errors.e003');
    });

    it('still reports non-matching keys as unused', async () => {
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.save');`
      );

      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({
          'common.save': 'Save',
          'common.unused': 'This is unused',
          'errors.e001': 'Keep me',
        }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        sync: {
          dynamicKeyGlobs: ['errors.*'],
        },
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      const summary = await syncer.run({ write: false });

      const unusedKeyNames = summary.unusedKeys.map(u => u.key);
      expect(unusedKeyNames).toContain('common.unused');
      expect(unusedKeyNames).not.toContain('errors.e001');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Multi-locale Sync
  // ─────────────────────────────────────────────────────────────────────────────
  describe('multi-locale synchronization', () => {
    it('reports references from multiple locales in summary', async () => {
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.greeting');`
      );

      // Source locale
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ 'common.greeting': 'Hello' }, null, 2)
      );

      // Target locale with existing translation
      await fs.writeFile(
        path.join(localesDir, 'de.json'),
        JSON.stringify({ 'common.greeting': 'Hallo' }, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: ['de'],
        localesDir: 'locales',
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      const summary = await syncer.run({ write: true });

      // Verify the key was detected
      expect(summary.references.length).toBe(1);
      expect(summary.references[0].key).toBe('common.greeting');

      // Verify both locales are preserved
      const en = JSON.parse(await fs.readFile(path.join(localesDir, 'en.json'), 'utf8'));
      const de = JSON.parse(await fs.readFile(path.join(localesDir, 'de.json'), 'utf8'));

      expect(en['common.greeting']).toBe('Hello');
      expect(de['common.greeting']).toBe('Hallo');
    });

    it('seeds missing keys to target locales when seedTargetLocales is true', async () => {
      // Key in code but NOT in source locale - this is what seedTargetLocales handles
      await fs.writeFile(
        path.join(srcDir, 'app.tsx'),
        `const x = t('common.save');`
      );

      // Source locale is empty - key is "missing"
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({}, null, 2)
      );

      // Target is also empty
      await fs.writeFile(
        path.join(localesDir, 'de.json'),
        JSON.stringify({}, null, 2)
      );

      const config: I18nConfig = {
        include: ['src/**/*.tsx'],
        sourceLanguage: 'en',
        targetLanguages: ['de'],
        localesDir: 'locales',
        seedTargetLocales: true,
      };

      const syncer = new Syncer(config, { workspaceRoot: tempDir });
      await syncer.run({ write: true });

      const en = JSON.parse(await fs.readFile(path.join(localesDir, 'en.json'), 'utf8'));
      const de = JSON.parse(await fs.readFile(path.join(localesDir, 'de.json'), 'utf8'));

      // Source should get the key with placeholder value
      expect('common.save' in en).toBe(true);
      // Target should also get the key (seeded with empty value)
      expect('common.save' in de).toBe(true);
      expect(de['common.save']).toBe('');
    });
  });
});
