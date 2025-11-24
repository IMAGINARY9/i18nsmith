import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeLocaleDiffPatches, printLocaleDiffs } from './diff-utils';

describe('diff-utils', () => {
  it('writes patch files for provided diffs', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-test-'));
    const diffs = [
      { locale: 'en', path: '/locales/en.json', diff: '--- a\n+++ b\n+"hello": "Hello"', added: ['hello'], updated: [], removed: [] },
      { locale: 'fr', path: '/locales/fr.json', diff: '--- a\n+++ b\n+"hello": "Bonjour"', added: ['hello'], updated: [], removed: [] },
    ];

    await writeLocaleDiffPatches(diffs as any, tmp);

    const files = await fs.readdir(tmp);
    expect(files.length).toBe(2);

    const enContent = await fs.readFile(path.join(tmp, 'en.patch'), 'utf8');
    expect(enContent).toContain('Hello');

    // cleanup
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('prints diffs without throwing', () => {
    const diffs = [
      { locale: 'en', path: '/locales/en.json', diff: '--- a\n+++ b\n+"hello": "Hello"', added: [], updated: [], removed: [] },
    ];

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => printLocaleDiffs(diffs as any)).not.toThrow();
    spy.mockRestore();
  });
});
