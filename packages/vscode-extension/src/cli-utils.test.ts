import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCliCommand } from './cli-utils';

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
  };
});

describe('resolveCliCommand', () => {
  beforeEach(() => {
    settings.cliPath = '';
  });

  it('returns npx invocation when no cliPath is configured', () => {
    const resolved = resolveCliCommand('i18nsmith sync --json');
    expect(resolved.command).toBe('npx');
    expect(resolved.args).toEqual(['i18nsmith@latest', 'sync', '--json']);
    expect(resolved.display).toBe('npx i18nsmith@latest sync --json');
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

  it('passes through non-i18nsmith commands untouched', () => {
    const resolved = resolveCliCommand('npm run test');
    expect(resolved.command).toBe('npm');
    expect(resolved.args).toEqual(['run', 'test']);
    expect(resolved.display).toBe('npm run test');
    expect(resolved.source).toBe('external');
  });
});
