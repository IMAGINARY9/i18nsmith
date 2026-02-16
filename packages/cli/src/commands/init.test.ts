import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerInit, parseGlobList } from './init.js';
import fs from 'fs/promises';

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
  ensureGitignore: vi.fn().mockResolvedValue({ updated: false }),
  ProjectIntelligenceService: vi.fn().mockImplementation(() => ({
    analyze: vi.fn().mockResolvedValue({
      framework: {
        type: 'react',
        adapter: 'react-i18next',
        hookName: 'useTranslation',
        features: [],
        confidence: 0.8,
        evidence: []
      },
      locales: {
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        format: 'flat',
        existingFiles: [],
        existingKeyCount: 0,
        confidence: 0.5
      },
      filePatterns: {
        include: ['src/**/*.{ts,tsx,js,jsx}'],
        exclude: ['node_modules/**', 'dist/**'],
        sourceDirectories: ['src'],
        hasTypeScript: true,
        hasJsx: true,
        hasVue: false,
        hasSvelte: false,
        sourceFileCount: 10,
        confidence: 0.7
      },
      existingSetup: {
        hasExistingConfig: false,
        hasExistingLocales: false,
        hasI18nProvider: false,
        runtimePackages: [],
        translationUsage: {
          hookName: 'useTranslation',
          translationIdentifier: 't',
          filesWithHooks: 0,
          translationCalls: 0,
          exampleFiles: []
        }
      },
      confidence: {
        framework: 0.8,
        filePatterns: 0.7,
        existingSetup: 0.3,
        locales: 0.5,
        overall: 0.75,
        level: 'high'
      },
      warnings: [],
      recommendations: [],
      suggestedConfig: {
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        include: ['src/**/*.{ts,tsx,js,jsx}'],
        exclude: ['node_modules/**', 'dist/**'],
        translationAdapter: {
          module: 'react-i18next',
          hookName: 'useTranslation'
        },
        keyGeneration: {
          namespace: 'common',
          shortHashLen: 6
        }
      }
    })
  })),
  Scanner: {
    create: vi.fn().mockResolvedValue({
      scan: vi.fn().mockResolvedValue({
        buckets: {
          highConfidence: [
            {
              id: 'test-1',
              filePath: 'src/components/Button.tsx',
              kind: 'jsx-text',
              text: 'Hello World',
              context: 'Button component',
              position: { line: 5, column: 10 }
            }
          ],
          needsReview: [],
          skipped: []
        },
        candidates: [],
        filesScanned: 5,
        filesExamined: ['src/components/Button.tsx'],
      })
    })
  },
  KeyGenerator: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockReturnValue({
      key: 'common.button.hello-world.abc123',
      hash: 'abc123',
      preview: 'Hello World'
    })
  }))
}));

vi.mock('../utils/scaffold.js', () => ({
  scaffoldTranslationContext: vi.fn().mockResolvedValue({
    path: 'src/contexts/translation-context.tsx',
    content: '// mock content',
    written: true
  }),
  scaffoldI18next: vi.fn().mockResolvedValue({
    i18nPath: 'src/lib/i18n.ts',
    providerPath: 'src/components/i18n-provider.tsx',
    i18nResult: { path: 'src/lib/i18n.ts', content: '// i18n content', written: true },
    providerResult: { path: 'src/components/i18n-provider.tsx', content: '// provider content', written: true }
  })
}));

vi.mock('../utils/package-manager.js', () => ({
  detectPackageManager: vi.fn().mockResolvedValue('pnpm'),
  installDependencies: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../utils/pkg.js', () => ({
  hasDependency: vi.fn().mockReturnValue(false),
  readPackageJson: vi.fn().mockResolvedValue({
    dependencies: {},
    devDependencies: {}
  })
}));

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn().mockResolvedValue({
      sourceLanguage: 'en',
      adapter: 'custom',
      localesDir: 'locales',
      seedTargetLocales: false,
    }),
  },
}));

vi.mock('chalk', () => ({
  default: {
    blue: vi.fn((text) => text),
    green: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    red: vi.fn((text) => text),
    dim: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
  }
}));

vi.mock('fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('{}'),
    access: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register the init command', () => {
    const program = new Command();
    registerInit(program);
    const command = program.commands.find((cmd) => cmd.name() === 'init');
    expect(command).toBeDefined();
    expect(command?.options.some(opt => opt.flags === '--scaffold')).toBe(true);
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

  describe('non-interactive mode', () => {
    it('should seed source locale with detected keys', async () => {
      const program = new Command();
      registerInit(program);
      const command = program.commands.find((cmd) => cmd.name() === 'init')!;

      // Mock process.cwd to return a test directory
      const originalCwd = process.cwd;
      process.cwd = vi.fn().mockReturnValue('/test/project');

      // Mock fs.access to throw (config doesn't exist)
      const originalAccess = fs.access;
      vi.mocked(fs.access).mockRejectedValue(new Error('File not found'));

      try {
        // Execute command with --yes
        await (command as any).parseAsync(['--yes'], { from: 'user' });
      } finally {
        process.cwd = originalCwd;
        vi.mocked(fs.access).mockRestore();
      }

      // Should have written the seeded locale file
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        expect.stringContaining('locales/en.json'),
        expect.stringContaining('common.button.hello-world.abc123')
      );
    });
  });

  describe('interactive mode', () => {
    it('writes seedTargetLocales into config when user enables it', async () => {
      const program = new Command();
      registerInit(program);
      const command = program.commands.find((cmd) => cmd.name() === 'init')!;

      // Mock process.cwd to return a test directory
      const originalCwd = process.cwd;
      process.cwd = vi.fn().mockReturnValue('/test/project');

      // Make fs.access throw so init thinks config doesn't exist
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('File not found'));

      // Override inquirer for this run to enable seedTargetLocales
      const inquirer = await import('inquirer');
      vi.mocked(inquirer.default.prompt).mockResolvedValueOnce({
        setupMode: 'auto',
        sourceLanguage: 'en',
        localesDir: 'locales',
        seedTargetLocales: true,
      } as any);

      try {
        await (command as any).parseAsync([], { from: 'user' });
      } finally {
        process.cwd = originalCwd;
      }

      // Find the writeFile call that wrote i18n.config.json
      const wroteConfig = vi.mocked(fs.writeFile).mock.calls.find((c) => String(c[0]).endsWith('i18n.config.json'));
      expect(wroteConfig).toBeDefined();
      expect(String(wroteConfig![1])).toContain('"seedTargetLocales": true');
    });

    it('continues when user chooses Overwrite for existing assets and records mergeStrategy', async () => {
      const program = new Command();
      registerInit(program);
      const command = program.commands.find((cmd) => cmd.name() === 'init')!;

      const originalCwd = process.cwd;
      process.cwd = vi.fn().mockReturnValue('/test/project');

      // Make fs.access throw so init thinks config doesn't exist
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('File not found'));

      // Make diagnoseWorkspace report existing locale files so merge prompt appears
      const core = await import('@i18nsmith/core');
      vi.mocked(core.diagnoseWorkspace).mockResolvedValueOnce({
        localesDir: 'locales',
        localeFiles: [{ locale: 'en', missing: false, parseError: false }],
        detectedLocales: [],
        runtimePackages: [],
        providerFiles: [],
        adapterFiles: [],
        translationUsage: { hookName: 'useTranslation', translationIdentifier: 't', filesExamined: 0, hookOccurrences: 0, identifierOccurrences: 0, hookExampleFiles: [], identifierExampleFiles: [] },
        actionableItems: [],
        conflicts: [],
        recommendations: [],
      } as any);

      // Sequence of prompts: first the main answers, then the merge strategy choice
      const inquirer = await import('inquirer');
      vi.mocked(inquirer.default.prompt)
        .mockResolvedValueOnce({ setupMode: 'auto', sourceLanguage: 'en', localesDir: 'locales', seedTargetLocales: false } as any)
        .mockResolvedValueOnce({ strategy: 'overwrite' } as any);

      try {
        await (command as any).parseAsync([], { from: 'user' });
      } finally {
        process.cwd = originalCwd;
      }

      // Ensure config was written with mergeStrategy set to overwrite
      const wroteConfig = vi.mocked(fs.writeFile).mock.calls.find((c) => String(c[0]).endsWith('i18n.config.json'));
      expect(wroteConfig).toBeDefined();
      expect(String(wroteConfig![1])).toContain('"mergeStrategy": "overwrite"');
    });
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
