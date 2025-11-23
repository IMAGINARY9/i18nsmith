import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatFileWithPrettier } from './formatting';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('formatFileWithPrettier', () => {
  it('formats files when Prettier is available', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formatting-success-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'example.tsx');
    await fs.writeFile(filePath, 'const   value="test";', 'utf8');

  const resolveConfig = vi.fn().mockResolvedValue({ singleQuote: true });
  const format = vi.fn().mockResolvedValue('const value="test";');

    await formatFileWithPrettier(filePath, async () => ({ resolveConfig, format }));

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toBe('const value="test";');
    expect(resolveConfig).toHaveBeenCalledWith(filePath);
    expect(format).toHaveBeenCalled();
  });

  it('silently skips formatting when Prettier is unavailable', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formatting-missing-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'example.tsx');
    const original = '<div>text</div>';
    await fs.writeFile(filePath, original, 'utf8');

    const missingError = Object.assign(new Error('Cannot find module \"prettier\"'), { code: 'MODULE_NOT_FOUND' });

    await formatFileWithPrettier(filePath, async () => {
      throw missingError;
    });

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toBe(original);
  });

  it('warns and continues when Prettier throws an unexpected error', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'formatting-error-'));
    tmpDirs.push(dir);
    const filePath = path.join(dir, 'example.tsx');
    const original = 'const a=1;';
    await fs.writeFile(filePath, original, 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await formatFileWithPrettier(filePath, async () => ({
      resolveConfig: vi.fn().mockResolvedValue(null),
      format: vi.fn().mockImplementation(() => {
        throw new Error('boom');
      }),
    }));

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toBe(original);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
