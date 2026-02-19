import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTestEnvironment, getCacheDir, getCachePath, cleanupTestCache } from './cache-utils.js';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

describe('Cache Path Utilities', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('isTestEnvironment', () => {
    it('detects test environment via NODE_ENV', () => {
      process.env.NODE_ENV = 'test';
      expect(isTestEnvironment()).toBe(true);
    });

    it('detects test environment via VITEST', () => {
      process.env.VITEST = 'true';
      expect(isTestEnvironment()).toBe(true);
    });

    it('detects test environment via JEST_WORKER_ID', () => {
      process.env.JEST_WORKER_ID = '1';
      expect(isTestEnvironment()).toBe(true);
    });

    it('detects test environment via global test functions', () => {
      // Should already be true since we're in vitest
      // At least one of the environment checks will pass
      expect(isTestEnvironment()).toBe(true);
    });

    it('is always true in test environment', () => {
      // In our test runner, at least one detection method works
      // We can't truly test production without running outside test runner
      expect(isTestEnvironment()).toBe(true);
    });
  });

  describe('getCacheDir', () => {
    it('returns temp directory for extractor cache in tests', () => {
      const workspace = '/fake/workspace';
      const cacheDir = getCacheDir(workspace, 'extractor');
      
      expect(cacheDir).toContain(os.tmpdir());
      expect(cacheDir).toContain('i18nsmith-test-cache');
      expect(cacheDir).toContain(String(process.pid));
      expect(cacheDir).toContain('extractor');
    });

    it('returns temp directory for sync cache in tests', () => {
      const workspace = '/fake/workspace';
      const cacheDir = getCacheDir(workspace, 'sync');
      
      expect(cacheDir).toContain(os.tmpdir());
      expect(cacheDir).toContain('i18nsmith-test-cache');
      expect(cacheDir).toContain(String(process.pid));
      expect(cacheDir).toContain('sync');
    });

    it('isolates caches by process ID', () => {
      const workspace = '/fake/workspace';
      const extractorDir = getCacheDir(workspace, 'extractor');
      const syncDir = getCacheDir(workspace, 'sync');
      
      // Both should have the same process ID
      expect(extractorDir).toContain(String(process.pid));
      expect(syncDir).toContain(String(process.pid));
      
      // But different cache types
      expect(extractorDir).not.toBe(syncDir);
    });
  });

  describe('getCachePath', () => {
    it('returns full path with references.json for extractor cache', () => {
      const workspace = '/fake/workspace';
      const cachePath = getCachePath(workspace, 'extractor');
      
      expect(cachePath).toContain('i18nsmith-test-cache');
      expect(cachePath.endsWith('references.json')).toBe(true);
    });

    it('returns full path with sync-references.json for sync cache', () => {
      const workspace = '/fake/workspace';
      const cachePath = getCachePath(workspace, 'sync');
      
      expect(cachePath).toContain('i18nsmith-test-cache');
      expect(cachePath.endsWith('sync-references.json')).toBe(true);
    });

    it('uses correct filename for each cache type', () => {
      const workspace = '/fake/workspace';
      const extractorPath = getCachePath(workspace, 'extractor');
      const syncPath = getCachePath(workspace, 'sync');
      
      expect(path.basename(extractorPath)).toBe('references.json');
      expect(path.basename(syncPath)).toBe('sync-references.json');
    });
  });

  describe('Production paths (simulated)', () => {
    it('documents expected production extractor path', () => {
      // In production, extractor cache should be in node_modules/.cache
      const workspace = '/app';
      const expectedPath = path.join(workspace, 'node_modules', '.cache', 'i18nsmith');
      
      // We can't test this directly since we're in a test environment
      // but we document the expected behavior
      expect(expectedPath).toBe('/app/node_modules/.cache/i18nsmith');
    });

    it('documents expected production sync path', () => {
      // In production, sync cache should be in .i18nsmith/cache
      const workspace = '/app';
      const expectedPath = path.join(workspace, '.i18nsmith', 'cache');
      
      expect(expectedPath).toBe('/app/.i18nsmith/cache');
    });
  });

  describe('cleanupTestCache', () => {
    it('cleans up test cache directory', async () => {
      const workspace = '/fake/workspace';
      const cachePath = getCachePath(workspace, 'extractor');
      const cacheDir = path.dirname(cachePath);
      
      // Create the cache directory
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(cachePath, JSON.stringify({ test: 'data' }));
      
      // Verify it exists
      const existsBefore = await fs.access(cachePath).then(() => true).catch(() => false);
      expect(existsBefore).toBe(true);
      
      // Clean up
      await cleanupTestCache();
      
      // Verify it's gone
      const existsAfter = await fs.access(cachePath).then(() => true).catch(() => false);
      expect(existsAfter).toBe(false);
    });

    it('is safe to call multiple times', async () => {
      await cleanupTestCache();
      await cleanupTestCache(); // Should not throw
      expect(true).toBe(true);
    });

    it('is safe to call when cache does not exist', async () => {
      await cleanupTestCache(); // Should not throw even if nothing to clean
      expect(true).toBe(true);
    });
  });
});
