import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mockSpawn = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: Parameters<typeof mockSpawn>) => mockSpawn(...args),
}));

async function writePreviewFixture(args: string[]): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-test-'));
  const previewPath = path.join(tempDir, 'sync-preview.json');
  const payload = {
    type: 'sync-preview',
    version: 1,
    command: 'i18nsmith sync --preview-output tmp.json',
    args,
    timestamp: new Date().toISOString(),
    summary: { missingKeys: [], unusedKeys: [] },
  };
  await fs.writeFile(previewPath, JSON.stringify(payload, null, 2), 'utf8');
  return previewPath;
}

function mockSuccessfulSpawn() {
  mockSpawn.mockImplementation(() => {
    const child = {
      on(event: string, handler: (code?: number) => void) {
        if (event === 'exit') {
          setImmediate(() => handler(0));
        }
        return child;
      },
    } as unknown as ReturnType<typeof mockSpawn>;
    return child;
  });
}

describe('applyPreviewFile', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockSuccessfulSpawn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replays preview with --write and extra args (selection + prune)', async () => {
    const previewPath = await writePreviewFixture([
      'sync',
      '--target',
      'src/app/**',
      '--preview-output',
      'tmp.json',
    ]);
    const selectionFile = path.join(path.dirname(previewPath), 'selection.json');

    const { applyPreviewFile } = await import('./preview.js');

    await applyPreviewFile('sync', previewPath, ['--selection-file', selectionFile, '--prune']);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, spawnedArgs] = mockSpawn.mock.calls[0];
    const [, ...forwardedArgs] = spawnedArgs as string[];
    expect(forwardedArgs).toEqual([
      'sync',
      '--target',
      'src/app/**',
      '--write',
      '--selection-file',
      selectionFile,
      '--prune',
    ]);
  });

  it('does not duplicate --write when already present in preview args', async () => {
    const previewPath = await writePreviewFixture(['sync', '--write', '--json']);
    const { applyPreviewFile } = await import('./preview.js');

    await applyPreviewFile('sync', previewPath);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, spawnedArgs] = mockSpawn.mock.calls[0];
    const [, ...forwardedArgs] = spawnedArgs as string[];
    expect(forwardedArgs).toEqual(['sync', '--write', '--json']);
  });
});
