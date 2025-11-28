import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createBackup, listBackups, restoreBackup } from './backup.js';

describe('Backup', () => {
  let tempDir: string;
  let localesDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-backup-test-'));
    localesDir = path.join(tempDir, 'locales');
    await fs.mkdir(localesDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('createBackup', () => {
    it('creates backup of locale files', async () => {
      // Create some locale files
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ hello: 'Hello' }, null, 2)
      );
      await fs.writeFile(
        path.join(localesDir, 'es.json'),
        JSON.stringify({ hello: 'Hola' }, null, 2)
      );

      const result = await createBackup(localesDir, tempDir);

      expect(result).not.toBeNull();
      expect(result!.files).toContain('en.json');
      expect(result!.files).toContain('es.json');
      expect(result!.files).toHaveLength(2);

      // Verify backup files exist
      const backupEnContent = await fs.readFile(
        path.join(result!.backupPath, 'en.json'),
        'utf8'
      );
      expect(JSON.parse(backupEnContent)).toEqual({ hello: 'Hello' });

      // Verify manifest exists
      const manifestPath = path.join(result!.backupPath, 'manifest.json');
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      expect(manifest.files).toHaveLength(2);
      expect(manifest.version).toBe(1);
    });

    it('returns null when no locale files exist', async () => {
      const result = await createBackup(localesDir, tempDir);
      expect(result).toBeNull();
    });

    it('returns null when locales directory does not exist', async () => {
      const result = await createBackup(path.join(tempDir, 'nonexistent'), tempDir);
      expect(result).toBeNull();
    });

    it('uses custom backup directory', async () => {
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ key: 'value' })
      );

      const result = await createBackup(localesDir, tempDir, {
        backupDir: 'custom-backups',
      });

      expect(result).not.toBeNull();
      expect(result!.backupPath).toContain('custom-backups');
    });

    it('records command in manifest', async () => {
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ key: 'value' })
      );

      const result = await createBackup(localesDir, tempDir, {}, 'sync --write --prune');

      const manifest = JSON.parse(
        await fs.readFile(path.join(result!.backupPath, 'manifest.json'), 'utf8')
      );
      expect(manifest.command).toBe('sync --write --prune');
    });

    it('prunes old backups beyond maxBackups', async () => {
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ key: 'value' })
      );

      // Create 3 backups with maxBackups=2
      await createBackup(localesDir, tempDir, { maxBackups: 2 });
      await new Promise((resolve) => setTimeout(resolve, 1100)); // Wait for different timestamp
      await createBackup(localesDir, tempDir, { maxBackups: 2 });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await createBackup(localesDir, tempDir, { maxBackups: 2 });

      const backups = await listBackups(tempDir);
      expect(backups).toHaveLength(2);
    });
  });

  describe('listBackups', () => {
    it('lists all available backups', async () => {
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ key: 'value' })
      );

      await createBackup(localesDir, tempDir);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await createBackup(localesDir, tempDir);

      const backups = await listBackups(tempDir);

      expect(backups).toHaveLength(2);
      expect(backups[0].fileCount).toBe(1);
      expect(backups[0].createdAt).toBeDefined();
    });

    it('returns empty array when no backups exist', async () => {
      const backups = await listBackups(tempDir);
      expect(backups).toEqual([]);
    });

    it('returns backups sorted newest first', async () => {
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ key: 'value' })
      );

      const backup1 = await createBackup(localesDir, tempDir);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const backup2 = await createBackup(localesDir, tempDir);

      const backups = await listBackups(tempDir);

      expect(backups[0].timestamp).toBe(backup2!.timestamp);
      expect(backups[1].timestamp).toBe(backup1!.timestamp);
    });
  });

  describe('restoreBackup', () => {
    it('restores locale files from backup', async () => {
      // Create initial locale files
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ original: 'Original value' }, null, 2)
      );

      // Create backup
      const backup = await createBackup(localesDir, tempDir);
      expect(backup).not.toBeNull();

      // Modify locale files (simulating destructive operation)
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ modified: 'Modified value' }, null, 2)
      );

      // Verify files were modified
      const modifiedContent = JSON.parse(
        await fs.readFile(path.join(localesDir, 'en.json'), 'utf8')
      );
      expect(modifiedContent).toEqual({ modified: 'Modified value' });

      // Restore from backup
      const result = await restoreBackup(backup!.backupPath, tempDir);

      expect(result.restored).toContain('locales/en.json');

      // Verify files were restored
      const restoredContent = JSON.parse(
        await fs.readFile(path.join(localesDir, 'en.json'), 'utf8')
      );
      expect(restoredContent).toEqual({ original: 'Original value' });
    });

    it('creates directories if they were deleted', async () => {
      await fs.writeFile(
        path.join(localesDir, 'en.json'),
        JSON.stringify({ key: 'value' })
      );

      const backup = await createBackup(localesDir, tempDir);

      // Delete the locales directory entirely
      await fs.rm(localesDir, { recursive: true });

      // Restore should recreate the directory
      await restoreBackup(backup!.backupPath, tempDir);

      const exists = await fs.access(path.join(localesDir, 'en.json'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });
});
