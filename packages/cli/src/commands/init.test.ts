import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { registerInit, parseGlobList } from './init.js';

vi.mock('@i18nsmith/core', () => ({
  diagnoseWorkspace: vi.fn().mockResolvedValue({
    localesDir: 'locales',
    localeFiles: [],
    detectedLocales: [],
    runtimePackages: [],
    providerFiles: [],
    adapterFiles: [],
    translationUsage: {
      hookName: 'useTranslation',
      translationIdentifier: 't',
      filesExamined: 0,
      hookOccurrences: 0,
      identifierOccurrences: 0,
      hookExampleFiles: [],
      identifierExampleFiles: [],
    },
    actionableItems: [],
    conflicts: [],
    recommendations: [],
  }),
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn().mockResolvedValue({
      sourceLanguage: 'en',
      adapter: 'custom',
      localesDir: 'locales',
    }),
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('init command', () => {
  it('should register the init command', () => {
    const program = new Command();
    registerInit(program);
    const command = program.commands.find((cmd) => cmd.name() === 'init');
    expect(command).toBeDefined();
  });
});

describe('parseGlobList', () => {
  it('treats brace-expanded globs as atomic tokens', () => {
    const input = 'src/**/*.{ts,tsx,js,jsx}, app/**/*.{ts,tsx}';
    expect(parseGlobList(input)).toEqual([
      'src/**/*.{ts,tsx,js,jsx}',
      'app/**/*.{ts,tsx}',
    ]);
  });

  it('handles nested braces', () => {
    const input = 'src/**/*.{ts,tsx,{spec,test}.ts}';
    expect(parseGlobList(input)).toEqual(['src/**/*.{ts,tsx,{spec,test}.ts}']);
  });

  it('splits simple comma-separated values', () => {
    const input = 'en, fr, es';
    expect(parseGlobList(input)).toEqual(['en', 'fr', 'es']);
  });

  it('handles empty input', () => {
    expect(parseGlobList('')).toEqual([]);
    expect(parseGlobList('   ')).toEqual([]);
  });

  it('trims whitespace around entries', () => {
    const input = '  src/**/*  ,  app/**/*  ';
    expect(parseGlobList(input)).toEqual(['src/**/*', 'app/**/*']);
  });
});
