import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCliCommand } from './cli-utils';

const fsMocks = vi.hoisted(() => {
  return {
    existsSync: vi.fn((..._args: unknown[]) => false),
    statSync: vi.fn(() => ({ isFile: () => true })),
  };
});

vi.mock('fs', () => fsMocks);

const settings: { cliPath?: string } = {};

vi.mock('vscode', () => {
  return {
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'cliPath') {
            return settings.cliPath ?? defaultValue ?? '';
          }
          return defaultValue;
        },
      })),
    },
    extensions: {
      getExtension: vi.fn(() => undefined),
    },
  };
});

describe('resolveCliCommand', () => {
  beforeEach(() => {
    settings.cliPath = '';
    fsMocks.existsSync.mockReturnValue(false);
    fsMocks.statSync.mockReturnValue({ isFile: () => true });
  });

  it('returns npx invocation when no cliPath is configured', () => {
    const resolved = resolveCliCommand('i18nsmith sync --json');
    expect(resolved.command).toBe('npx');
    expect(resolved.args).toEqual(['i18nsmith', 'sync', '--json']);
    expect(resolved.display).toBe('npx i18nsmith sync --json');
    expect(resolved.source).toBe('npx-pass-through');
  });

  it('uses configured cliPath when provided', () => {
    settings.cliPath = '/tmp/i18nsmith/cli.js';
    const resolved = resolveCliCommand('i18nsmith check --json');
    expect(resolved.command).toBe('node');
    expect(resolved.args[0]).toBe('/tmp/i18nsmith/cli.js');
    expect(resolved.args.slice(1)).toEqual(['check', '--json']);
    expect(resolved.display).toBe('node "/tmp/i18nsmith/cli.js" check --json');
    expect(resolved.source).toBe('configured-cli');
  });

  it('rejects dangerous cliPath values and falls back to npx', () => {
    settings.cliPath = 'bad.js; rm -rf /';
    const resolved = resolveCliCommand('i18nsmith sync');
    expect(resolved.command).toBe('npx');
    expect(resolved.source).toBe('npx-pass-through');
  });

  it('uses global i18nsmith when available on PATH', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/usr/local/bin';
  fsMocks.existsSync.mockImplementation((...args: unknown[]) => args[0] === '/usr/local/bin/i18nsmith');
    const resolved = resolveCliCommand('i18nsmith check --json');
    expect(resolved.command).toBe('/usr/local/bin/i18nsmith');
    expect(resolved.args).toEqual(['check', '--json']);
    expect(resolved.source).toBe('global');
    process.env.PATH = originalPath;
  });

  it('passes through non-i18nsmith commands untouched', () => {
    const resolved = resolveCliCommand('npm run test');
    expect(resolved.command).toBe('npm');
    expect(resolved.args).toEqual(['run', 'test']);
    expect(resolved.display).toBe('npm run test');
    expect(resolved.source).toBe('external');
  });
});
