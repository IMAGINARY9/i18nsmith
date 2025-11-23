import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleStore } from './locale-store';

let tempDir: string;

describe('LocaleStore', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'locale-store-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('writes sorted locale files atomically', async () => {
    const store = new LocaleStore(tempDir);
    await store.upsert('en', 'common.auto.app.title.aaaa1111', 'Hello');
    await store.upsert('en', 'common.auto.app.subtitle.bbbb2222', 'World');
    const stats = await store.flush();

    expect(stats[0].added).toHaveLength(2);

    const file = path.join(tempDir, 'en.json');
    const contents = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(Object.keys(contents)).toEqual([
      'common.auto.app.subtitle.bbbb2222',
      'common.auto.app.title.aaaa1111',
    ]);

    const filesOnDisk = await fs.readdir(tempDir);
    const tempFiles = filesOnDisk.filter((name) => name.endsWith('.tmp'));
    expect(tempFiles).toHaveLength(0);
  });

  it('tracks updates separately from additions', async () => {
    const store = new LocaleStore(tempDir);
    await store.upsert('en', 'key', 'Hello');
    await store.flush();

    await store.upsert('en', 'key', 'Hello translated');
    const stats = await store.flush();

    expect(stats[0].added).toHaveLength(0);
    expect(stats[0].updated).toEqual(['key']);
  });

  it('overwrites existing files using temp rename', async () => {
    const store = new LocaleStore(tempDir);
    await store.upsert('en', 'key', 'v1');
    await store.flush();

    await store.upsert('en', 'key', 'v2');
    await store.flush();

    const file = path.join(tempDir, 'en.json');
    const contents = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(contents.key).toBe('v2');
  });

  it('retries rename on transient filesystem errors and removes temp files', async () => {
    const store = new LocaleStore(tempDir);
    await store.upsert('en', 'key', 'value');

    const originalRename = fs.rename;
    const renameSpy = vi.spyOn(fs, 'rename');
    let attempts = 0;
    renameSpy.mockImplementation(async (...args: Parameters<typeof originalRename>) => {
      attempts += 1;
      if (attempts === 1) {
        const err = new Error('exists') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      }
      return originalRename(...args);
    });

    const stats = await store.flush();

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(stats[0].added).toEqual(['key']);

    const diskFiles = await fs.readdir(tempDir);
    expect(diskFiles.some((name) => name.endsWith('.tmp'))).toBe(false);

    renameSpy.mockRestore();
  });

  it('cleans up temp files when rename ultimately fails', async () => {
    const store = new LocaleStore(tempDir);
    await store.upsert('en', 'key', 'value');

    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async () => {
      const err = new Error('boom') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    await expect(store.flush()).rejects.toThrow('boom');

    const files = await fs.readdir(tempDir);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(files.includes('en.json')).toBe(false);

    renameSpy.mockRestore();
  });
});
