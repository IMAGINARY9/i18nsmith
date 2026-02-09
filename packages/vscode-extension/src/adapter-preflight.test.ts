import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/fake/project' } }],
  },
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import * as fs from 'fs';
// Import AFTER mocks are set up
import { runAdapterPreflightCheck } from './utils/adapter-preflight';

const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>;

describe('Adapter preflight utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns missing deps when vue-eslint-parser is not available', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('i18n.config.json')) return true;
      if (p.includes('node_modules/vue-eslint-parser')) return false;
      if (p.endsWith('package.json')) return true;
      if (p.includes('pnpm-lock.yaml')) return false;
      if (p.includes('yarn.lock')) return false;
      return false;
    });

    mockReadFileSync.mockImplementation((p: string) => {
      if (String(p).endsWith('i18n.config.json')) {
        return JSON.stringify({ include: ['src/**/*.vue'] });
      }
      if (String(p).endsWith('package.json')) {
        return JSON.stringify({ dependencies: {}, devDependencies: {} });
      }
      throw new Error('not found');
    });

    const missing = runAdapterPreflightCheck();
    expect(missing).toHaveLength(1);
    expect(missing[0].adapter).toBe('vue');
    expect(missing[0].dependency).toBe('vue-eslint-parser');
    expect(missing[0].installHint).toContain('vue-eslint-parser');
  });

  it('returns empty when vue-eslint-parser is in package.json', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('i18n.config.json')) return true;
      if (p.includes('node_modules/vue-eslint-parser')) return false;
      if (p.endsWith('package.json')) return true;
      return false;
    });

    mockReadFileSync.mockImplementation((p: string) => {
      if (String(p).endsWith('i18n.config.json')) {
        return JSON.stringify({ include: ['src/**/*.vue'] });
      }
      if (String(p).endsWith('package.json')) {
        return JSON.stringify({ devDependencies: { 'vue-eslint-parser': '^10.0.0' } });
      }
      throw new Error('not found');
    });

    const missing = runAdapterPreflightCheck();
    expect(missing).toHaveLength(0);
  });

  it('returns empty when no Vue files in config includes', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('i18n.config.json')) return true;
      return false;
    });

    mockReadFileSync.mockImplementation((p: string) => {
      if (String(p).endsWith('i18n.config.json')) {
        return JSON.stringify({ include: ['src/**/*.{ts,tsx}'] });
      }
      throw new Error('not found');
    });

    const missing = runAdapterPreflightCheck();
    expect(missing).toHaveLength(0);
  });

  it('returns empty when config file is missing', () => {
    mockExistsSync.mockReturnValue(false);

    const missing = runAdapterPreflightCheck();
    expect(missing).toHaveLength(0);
  });

  it('uses pnpm install hint when pnpm-lock.yaml exists', () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('i18n.config.json')) return true;
      if (p.includes('node_modules/vue-eslint-parser')) return false;
      if (p.endsWith('package.json')) return true;
      if (p.includes('pnpm-lock.yaml')) return true;
      return false;
    });

    mockReadFileSync.mockImplementation((p: string) => {
      if (String(p).endsWith('i18n.config.json')) {
        return JSON.stringify({ include: ['src/**/*.vue'] });
      }
      if (String(p).endsWith('package.json')) {
        return JSON.stringify({ dependencies: {}, devDependencies: {} });
      }
      throw new Error('not found');
    });

    const missing = runAdapterPreflightCheck();
    expect(missing).toHaveLength(1);
    expect(missing[0].installHint).toContain('pnpm add -D');
  });
});
