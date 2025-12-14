import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getWorkspaceConfigSnapshot, readWorkspaceConfigSnapshot } from './workspace-config';

const tempRoots: string[] = [];

async function createWorkspaceConfig(contents: Record<string, unknown> | string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-config-'));
  tempRoots.push(dir);
  const configPath = path.join(dir, 'i18n.config.json');
  const payload = typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2);
  await fs.writeFile(configPath, payload, 'utf8');
  return { dir, configPath };
}

afterEach(async () => {
  while (tempRoots.length) {
    const dir = tempRoots.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('workspace config helper', () => {
  it('returns null when config is missing', () => {
    expect(getWorkspaceConfigSnapshot(undefined)).toBeNull();
  });

  it('memoizes snapshot until file changes', async () => {
    const { dir, configPath } = await createWorkspaceConfig({ localesDir: 'locales', sourceLanguage: 'en' });

    const first = getWorkspaceConfigSnapshot(dir);
    expect(first?.localesDir).toBe('locales');

  await delay(25);
    await fs.writeFile(configPath, JSON.stringify({ localesDir: 'l10n', sourceLanguage: 'fr' }, null, 2));

    const second = getWorkspaceConfigSnapshot(dir);
    expect(second?.localesDir).toBe('l10n');
    expect(second?.sourceLanguage).toBe('fr');
  });

  it('surfaces parse errors through readWorkspaceConfigSnapshot', async () => {
    const { dir } = await createWorkspaceConfig('{ "localesDir": "oops" ');
    const result = readWorkspaceConfigSnapshot(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

});
