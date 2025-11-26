import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { registerScaffoldAdapter } from './scaffold-adapter';

vi.mock('@i18nsmith/core', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    version: 1,
    sourceLanguage: 'en',
    targetLanguages: ['es'],
    localesDir: 'locales',
    include: ['src/**/*.{ts,tsx}'],
    exclude: [],
    minTextLength: 1,
    translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
    keyGeneration: { namespace: 'common', shortHashLen: 6 },
    seedTargetLocales: false,
    sync: {
      translationIdentifier: 't',
      validateInterpolations: false,
      placeholderFormats: ['doubleCurly', 'percentCurly', 'percentSymbol'],
      emptyValuePolicy: 'warn',
      emptyValueMarkers: ['todo'],
      dynamicKeyAssumptions: [],
    },
  }),
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
      type: 'custom',
      sourceLanguage: 'en',
      localesDir: 'locales',
      filePath: 'src/contexts/translation-context.tsx',
      force: false,
    }),
  },
}));

vi.mock('../utils/scaffold.js', () => ({
  scaffoldTranslationContext: vi.fn().mockResolvedValue('src/contexts/translation-context.tsx'),
  scaffoldI18next: vi.fn().mockResolvedValue({
    i18nPath: 'src/lib/i18n.ts',
    providerPath: 'src/components/i18n-provider.tsx',
  }),
}));

vi.mock('../utils/pkg.js', () => ({
  readPackageJson: vi.fn().mockResolvedValue({}),
  hasDependency: vi.fn().mockReturnValue(false),
}));

describe('scaffold-adapter command', () => {
  it('should register the scaffold-adapter command', () => {
    const program = new Command();
    registerScaffoldAdapter(program);
    const command = program.commands.find((cmd) => cmd.name() === 'scaffold-adapter');
    expect(command).toBeDefined();
  });
});
