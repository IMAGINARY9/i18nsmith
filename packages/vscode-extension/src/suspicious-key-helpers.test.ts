import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildSuspiciousKeySuggestion } from './suspicious-key-helpers';

describe('buildSuspiciousKeySuggestion', () => {
  it('uses the relative file path to build scoped suggestions', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-suspicious-'));
    try {
      const configPath = path.join(tempDir, 'i18n.config.json');
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            keyGeneration: {
              namespace: 'common',
              shortHashLen: 6,
            },
          },
          null,
          2
        )
      );

      const filePath = path.join(tempDir, 'src/app/activity/AddToFavorites.tsx');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'export const Component = () => null;');

      const suggestion = buildSuspiciousKeySuggestion(
        'activity.addToFavorites',
        tempDir,
        filePath
      );

      expect(suggestion.startsWith('common.app.activity.addtofavorites')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
