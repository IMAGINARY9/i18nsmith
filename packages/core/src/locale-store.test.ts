import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
});
