import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  loadReferenceCache,
  saveReferenceCache,
  type ReferenceCacheFile,
} from './reference-cache.js';

describe('sync reference cache - parserSignature handling', () => {
  it('invalidates when parserSignature differs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-test-'));
    const cachePath = path.join(tmpDir, 'sync-references.json');
    const cacheDir = tmpDir;

    const entries = {
      'src/foo.vue': {
        fingerprint: { mtimeMs: 1, size: 2 },
        references: [],
        dynamicKeyWarnings: [],
      },
    };

    // Save with signature 'sig-A'
    await saveReferenceCache(cachePath, cacheDir, 't', entries, { parserSignature: 'sig-A' });

    // Load with a different signature -> should be invalidated
    const loadedDifferent = await loadReferenceCache(cachePath, 't', { parserSignature: 'sig-B' });
    expect(loadedDifferent).toBeUndefined();

    // Load with the same signature -> should return the cache
    const loadedSame = await loadReferenceCache(cachePath, 't', { parserSignature: 'sig-A' });
    expect(loadedSame).toBeDefined();
    expect((loadedSame as ReferenceCacheFile).files['src/foo.vue']).toBeDefined();

    await fs.rm(cachePath, { force: true }).catch(() => {});
  });
});
