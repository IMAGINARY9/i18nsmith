import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { registerInit } from './init';

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
