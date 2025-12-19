
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ensureCliBuilt } from './test-helpers/ensure-cli-built';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.resolve(__dirname, '../dist/index.js');
const FIXTURES_DIR = path.resolve(__dirname, './fixtures');

function runCli(
  args: string[],
  options: { cwd?: string } = {}
): { stdout: string; stderr: string; output: string; exitCode: number } {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: (result.stdout ?? '') + (result.stderr ?? ''),
    exitCode: result.status ?? 1,
  };
}

async function setupFixture(fixtureName: string): Promise<string> {
  const fixtureSource = path.join(FIXTURES_DIR, fixtureName);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `i18nsmith-e2e-${fixtureName}-`));
  await fs.cp(fixtureSource, tmpDir, { recursive: true });
  return tmpDir;
}

async function cleanupFixture(fixtureDir: string): Promise<void> {
  await fs.rm(fixtureDir, { recursive: true, force: true });
}

describe('Rename Suspicious Keys E2E', () => {
  let tmpDir: string;

  beforeAll(async () => {
    await ensureCliBuilt(CLI_PATH);
  });

  afterEach(async () => {
    if (tmpDir) {
      await cleanupFixture(tmpDir);
    }
  });

  it('should generate rename diffs when running sync with auto-rename and preview output', async () => {
    tmpDir = await setupFixture('suspicious-keys');
    const previewPath = path.join(tmpDir, 'preview.json');

    const { output, exitCode } = runCli(
      ['sync', '--diff', '--auto-rename-suspicious', '--preview-output', previewPath],
      { cwd: tmpDir }
    );

    expect(exitCode).toBe(0);
    expect(output).toContain('Preview written to');

    const previewContent = await fs.readFile(previewPath, 'utf8');
    const preview = JSON.parse(previewContent);

    expect(preview.summary).toBeDefined();
    expect(preview.summary.suspiciousKeys.length).toBeGreaterThan(0);
    
    // Check for renameDiffs
    expect(preview.summary.renameDiffs).toBeDefined();
    expect(preview.summary.renameDiffs.length).toBeGreaterThan(0);
    
    // Check for localeDiffs
    expect(preview.summary.localeDiffs).toBeDefined();
    expect(preview.summary.localeDiffs.length).toBeGreaterThan(0);

    // Verify specific rename proposal
    const renameDiff = preview.summary.renameDiffs.find((d: any) => d.relativePath.includes('BadKeys.tsx'));
    expect(renameDiff).toBeDefined();
    // console.log('Actual diff:', renameDiff.diff);
    expect(renameDiff.diff).toContain('-      <h1>{t(\'Hello World\')}</h1>');
    // Key generation includes hash and file slug
    expect(renameDiff.diff).toMatch(/\+      <h1>{t\('common\.badkeys\.hello-world\.[a-f0-9]+'\)}<\/h1>/); 
  });

  it('should handle existing keys that are suspicious (key-equals-value or contains-spaces)', async () => {
    // This covers the user's specific scenario: key exists in locale but is suspicious
    tmpDir = await setupFixture('suspicious-keys');
    const previewPath = path.join(tmpDir, 'preview.json');

    // "Hello World" exists in en.json and is suspicious
    const { output, exitCode } = runCli(
      ['sync', '--diff', '--auto-rename-suspicious', '--preview-output', previewPath],
      { cwd: tmpDir }
    );

    expect(exitCode).toBe(0);
    
    const preview = JSON.parse(await fs.readFile(previewPath, 'utf8'));
    
    // Verify "Hello World" is in suspiciousKeys
    const helloWorldSuspicious = preview.summary.suspiciousKeys.find((k: any) => k.key === 'Hello World');
    expect(helloWorldSuspicious).toBeDefined();
    // It might be 'contains-spaces' or 'key-equals-value' depending on priority
    expect(['key-equals-value', 'contains-spaces']).toContain(helloWorldSuspicious.reason);

    // Verify it has a rename diff
    const renameDiff = preview.summary.renameDiffs.find((d: any) => d.relativePath.includes('BadKeys.tsx'));
    expect(renameDiff).toBeDefined();
  });
});
