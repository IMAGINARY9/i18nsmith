import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureGitignore, checkGitignore, I18NSMITH_GITIGNORE_ENTRIES } from './gitignore.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('gitignore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-gitignore-test-'));
    // Create a .git directory to simulate a git repo
    await fs.mkdir(path.join(tmpDir, '.git'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('ensureGitignore', () => {
    it('should create .gitignore if it does not exist', async () => {
      const result = await ensureGitignore(tmpDir);

      expect(result.updated).toBe(true);
      expect(result.added).toContain('.i18nsmith/');
      expect(result.added).toContain('.i18nsmith-backup/');

      const content = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('.i18nsmith/');
      expect(content).toContain('.i18nsmith-backup/');
      expect(content).toContain('# i18nsmith artifacts');
    });

    it('should add missing entries to existing .gitignore', async () => {
      await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\n.env\n');

      const result = await ensureGitignore(tmpDir);

      expect(result.updated).toBe(true);
      expect(result.added).toContain('.i18nsmith/');

      const content = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('.env');
      expect(content).toContain('.i18nsmith/');
      expect(content).toContain('.i18nsmith-backup/');
    });

    it('should not duplicate existing entries', async () => {
      await fs.writeFile(
        path.join(tmpDir, '.gitignore'),
        'node_modules/\n.i18nsmith/\n.i18nsmith-backup/\n'
      );

      const result = await ensureGitignore(tmpDir);

      expect(result.updated).toBe(false);
      expect(result.added).toHaveLength(0);
    });

    it('should detect entries without trailing slash', async () => {
      await fs.writeFile(
        path.join(tmpDir, '.gitignore'),
        '.i18nsmith\n.i18nsmith-backup\n'
      );

      const result = await ensureGitignore(tmpDir);

      expect(result.updated).toBe(false);
      expect(result.added).toHaveLength(0);
    });

    it('should skip if not a git repository', async () => {
      await fs.rm(path.join(tmpDir, '.git'), { recursive: true });

      const result = await ensureGitignore(tmpDir);

      expect(result.updated).toBe(false);
      expect(result.added).toHaveLength(0);
    });
  });

  describe('checkGitignore', () => {
    it('should return missing entries', async () => {
      await fs.writeFile(path.join(tmpDir, '.gitignore'), 'node_modules/\n');

      const missing = await checkGitignore(tmpDir);

      expect(missing).toContain('.i18nsmith/');
      expect(missing).toContain('.i18nsmith-backup/');
    });

    it('should return empty array when all entries present', async () => {
      await fs.writeFile(
        path.join(tmpDir, '.gitignore'),
        '.i18nsmith/\n.i18nsmith-backup/\n'
      );

      const missing = await checkGitignore(tmpDir);

      expect(missing).toHaveLength(0);
    });

    it('should return empty array for non-git repos', async () => {
      await fs.rm(path.join(tmpDir, '.git'), { recursive: true });

      const missing = await checkGitignore(tmpDir);

      expect(missing).toHaveLength(0);
    });
  });
});
