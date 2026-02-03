import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { diagnoseWorkspace, I18nConfig, TranslationConfig, ensureGitignore, ProjectIntelligenceService, type ProjectIntelligence, type SuggestedConfig } from '@i18nsmith/core';
import { scaffoldTranslationContext, scaffoldI18next } from '../utils/scaffold.js';
import { hasDependency, readPackageJson } from '../utils/pkg.js';
import { CliError, withErrorHandling } from '../utils/errors.js';

/**
 * Parse a comma-separated list of glob patterns, respecting brace expansions.
 * Brace-expanded globs like `src/**\/*.{ts,tsx}` are kept as a single token.
 */
export function parseGlobList(value: string): string[] {
  const result: string[] = [];
  let current = '';
  let braceDepth = 0;

  for (const char of value) {
    if (char === '{') {
      braceDepth++;
      current += char;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      current += char;
    } else if (char === ',' && braceDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) result.push(trimmed);
      current = '';
    } else {
      current += char;
    }
  }

  const trimmed = current.trim();
  if (trimmed) result.push(trimmed);
  return result;
}

interface InitCommandOptions {
  merge?: boolean;
  yes?: boolean;
  template?: string;
}

interface InitAnswers {
  setupMode?: 'auto' | 'template' | 'manual';
  template?: string;
  confirmAuto?: boolean;
  sourceLanguage: string;
  targetLanguages: string;
  localesDir: string;
  include: string;
  exclude: string;
  minTextLength: string;
  service: 'google' | 'deepl' | 'manual';
  translationSecretEnvVar?: string;
  adapterPreset: 'react-i18next' | 'custom';
  customAdapterModule?: string;
  customAdapterHook?: string;
  scaffoldAdapter: boolean;
  scaffoldAdapterPath?: string;
  scaffoldReactRuntime?: boolean;
  reactI18nPath?: string;
  reactProviderPath?: string;
  keyNamespace: string;
  shortHashLen: string;
  seedTargetLocales: boolean;
}

/**
 * Run project intelligence detection to gather smart defaults.
 */
async function detectProjectIntelligence(workspaceRoot: string): Promise<ProjectIntelligence | null> {
  try {
    const service = new ProjectIntelligenceService();
    const result = await service.analyze({ workspaceRoot });
    return result;
  } catch {
    return null;
  }
}

/**
 * Run init in non-interactive mode with sensible defaults.
 * Uses ProjectIntelligenceService for smart detection.
 */
async function runNonInteractiveInit(commandOptions: InitCommandOptions): Promise<void> {
  const workspaceRoot = process.cwd();
  const configPath = path.join(workspaceRoot, 'i18n.config.json');

  // Check if config already exists
  try {
    await fs.access(configPath);
    if (!commandOptions.merge) {
      console.log(chalk.yellow('Config file already exists. Use --merge to update existing config.'));
      console.log(chalk.dim(`  ${configPath}`));
      return;
    }
  } catch {
    // Config doesn't exist, proceed
  }

  console.log(chalk.blue('🔍 Detecting project configuration...'));

  // Use ProjectIntelligenceService for detection
  const intelligence = await detectProjectIntelligence(workspaceRoot);

  let suggestedConfig: SuggestedConfig;

  if (intelligence) {
    const { framework, locales, filePatterns, confidence } = intelligence;
    
    // Report detection results
    if (framework.type !== 'unknown') {
      console.log(chalk.green(`  ✓ Framework: ${framework.type}`));
    }
    if (framework.adapter) {
      console.log(chalk.green(`  ✓ i18n Adapter: ${framework.adapter}`));
    }
    if (locales.existingFiles.length > 0) {
      const langs = [locales.sourceLanguage, ...locales.targetLanguages].filter(Boolean);
      console.log(chalk.green(`  ✓ Locales: ${langs.join(', ')}`));
    }
    if (filePatterns.sourceDirectories.length > 0) {
      console.log(chalk.green(`  ✓ Source directories: ${filePatterns.sourceDirectories.slice(0, 3).join(', ')}${filePatterns.sourceDirectories.length > 3 ? '...' : ''}`));
    }

    // Use template if specified, otherwise use detected config
    if (commandOptions.template) {
      const service = new ProjectIntelligenceService();
      suggestedConfig = service.applyTemplate(commandOptions.template, intelligence);
      console.log(chalk.green(`  ✓ Template: ${commandOptions.template}`));
    } else {
      suggestedConfig = intelligence.suggestedConfig;
    }

    // Report confidence
    const confidencePercent = Math.round(intelligence.confidence.overall * 100);
    const confidenceColor = intelligence.confidence.level === 'high' ? chalk.green : intelligence.confidence.level === 'medium' ? chalk.yellow : chalk.red;
    console.log(confidenceColor(`  Detection confidence: ${confidencePercent}% (${intelligence.confidence.level})`));
  } else {
    // Fallback when detection fails
    if (commandOptions.template) {
      const service = new ProjectIntelligenceService();
      // Create minimal intelligence for template application
      const minimalIntelligence: ProjectIntelligence = {
        framework: { 
          type: 'unknown', 
          adapter: 'react-i18next', 
          hookName: 'useTranslation',
          features: [],
          confidence: 0,
          evidence: []
        },
        locales: { 
          sourceLanguage: 'en', 
          targetLanguages: [], 
          localesDir: 'locales', 
          format: 'flat',
          existingFiles: [],
          existingKeyCount: 0,
          confidence: 0
        },
        filePatterns: { 
          include: ['**/*.{ts,tsx,js,jsx}'], 
          exclude: ['node_modules/**', 'dist/**'],
          sourceDirectories: [],
          hasTypeScript: false,
          hasJsx: false,
          hasVue: false,
          hasSvelte: false,
          sourceFileCount: 0,
          confidence: 0
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
          framework: 0,
          filePatterns: 0,
          existingSetup: 0,
          locales: 0,
          overall: 0, 
          level: 'low'
        },
        warnings: [],
        recommendations: [],
        suggestedConfig: {
          sourceLanguage: 'en',
          targetLanguages: [],
          localesDir: 'locales',
          include: ['**/*.{ts,tsx,js,jsx}'],
          exclude: ['node_modules/**', 'dist/**'],
          translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
          keyGeneration: { namespace: 'common', shortHashLen: 6 },
        },
      };
      suggestedConfig = service.applyTemplate(commandOptions.template, minimalIntelligence);
      console.log(chalk.green(`  ✓ Template: ${commandOptions.template}`));
    } else {
      suggestedConfig = {
        sourceLanguage: 'en',
        targetLanguages: [],
        localesDir: 'locales',
        include: ['**/*.{ts,tsx,js,jsx}'],
        exclude: ['node_modules/**', 'dist/**'],
        translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
        keyGeneration: { namespace: 'common', shortHashLen: 6 },
      };
    }
  }

  // Build config from suggested values
  const config: I18nConfig = {
    version: 1 as const,
    sourceLanguage: suggestedConfig.sourceLanguage,
    targetLanguages: suggestedConfig.targetLanguages,
    localesDir: suggestedConfig.localesDir,
    include: suggestedConfig.include,
    exclude: suggestedConfig.exclude,
    minTextLength: 1,
    translation: { provider: 'manual' },
    translationAdapter: {
      module: suggestedConfig.translationAdapter.module,
      hookName: suggestedConfig.translationAdapter.hookName,
    },
    keyGeneration: suggestedConfig.keyGeneration,
    seedTargetLocales: false,
  };

  try {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green(`\n✓ Configuration created at ${configPath}`));
    console.log(chalk.dim('  Source language: ' + config.sourceLanguage));
    if (config.targetLanguages.length > 0) {
      console.log(chalk.dim('  Target languages: ' + config.targetLanguages.join(', ')));
    }
    console.log(chalk.dim('  Adapter: ' + (config.translationAdapter?.module ?? 'react-i18next')));

    // Ensure .gitignore has i18nsmith artifacts
    const gitignoreResult = await ensureGitignore(workspaceRoot);
    if (gitignoreResult.updated) {
      console.log(chalk.green(`✓ Updated .gitignore with i18nsmith artifacts`));
    }

    console.log(chalk.blue('\nRun "i18nsmith check" to verify your setup.'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Failed to write configuration file: ${message}`);
  }
}

export function registerInit(program: Command) {
  program
    .command('init')
    .description('Initialize i18nsmith configuration')
    .option('--merge', 'Merge with existing locales/runtimes when detected', false)
    .option('-y, --yes', 'Skip prompts and use defaults (non-interactive mode)', false)
    .option('--template <template>', 'Use a preset template (react, next-app, next-pages, vue3, nuxt3, svelte, minimal)', undefined)
    .action(
      withErrorHandling(async (commandOptions: InitCommandOptions) => {
        console.log(chalk.blue('Initializing i18nsmith configuration...'));

        // Non-interactive mode with sensible defaults
        if (commandOptions.yes) {
          await runNonInteractiveInit(commandOptions);
          return;
        }

      const workspaceRoot = process.cwd();
      let config: I18nConfig | undefined;

      // Detect project intelligence early to use for suggestions
      const intelligence = await detectProjectIntelligence(workspaceRoot);
      const suggestedValues = intelligence?.suggestedConfig;

      const answers = await inquirer.prompt<InitAnswers>([
        {
          type: 'list',
          name: 'setupMode',
          message: 'How would you like to set up i18nsmith?',
          choices: [
            { name: 'Auto-detect (recommended) - Analyze your project and suggest optimal configuration', value: 'auto' },
            { name: 'Use template - Choose from popular framework presets', value: 'template' },
            { name: 'Manual setup - Configure everything manually', value: 'manual' },
          ],
          default: 'auto',
        },
        {
          type: 'list',
          name: 'template',
          message: 'Which template matches your project?',
          when: (answers) => answers.setupMode === 'template',
          choices: [
            { name: 'React with react-i18next', value: 'react' },
            { name: 'Next.js App Router', value: 'next-app' },
            { name: 'Next.js Pages Router', value: 'next-pages' },
            { name: 'Vue 3 with vue-i18n', value: 'vue3' },
            { name: 'Nuxt 3', value: 'nuxt3' },
            { name: 'Svelte/SvelteKit', value: 'svelte' },
            { name: 'Minimal setup', value: 'minimal' },
          ],
          default: 'react',
        },

        // Manual Configuration Questions with Smart Suggestions
        {
          type: 'input',
          name: 'sourceLanguage',
          message: 'What is the source language?',
          when: (answers) => answers.setupMode === 'manual',
          default: suggestedValues?.sourceLanguage || 'en',
        },
        {
          type: 'input',
          name: 'targetLanguages',
          message: 'Which target languages do you need? (comma separated)',
          when: (answers) => answers.setupMode === 'manual',
          default: suggestedValues?.targetLanguages?.join(', ') || 'fr',
        },
        {
          type: 'input',
          name: 'localesDir',
          message: 'Where should locale files be stored?',
          when: (answers) => answers.setupMode === 'manual',
          default: suggestedValues?.localesDir || 'locales',
        },
        {
          type: 'input',
          name: 'include',
          message: 'Which files should be scanned? (comma separated glob patterns)',
          when: (answers) => answers.setupMode === 'manual',
          default: suggestedValues?.include?.join(', ') || 'src/**/*.{ts,tsx,js,jsx}, app/**/*.{ts,tsx,js,jsx}, pages/**/*.{ts,tsx,js,jsx}, components/**/*.{ts,tsx,js,jsx}',
        },
        {
          type: 'input',
          name: 'exclude',
          message: 'Which files should be excluded? (comma separated glob patterns)',
          when: (answers) => answers.setupMode === 'manual',
          default: suggestedValues?.exclude?.join(', ') || 'node_modules/**,**/*.test.*',
        },
        {
          type: 'input',
          name: 'minTextLength',
          message: 'Minimum length for translatable text?',
          when: (answers) => answers.setupMode === 'manual',
          default: '1',
          validate: (input) => {
            const num = parseInt(input, 10);
            return !isNaN(num) && num >= 0 ? true : 'Please enter a non-negative number';
          },
        },
        {
          type: 'list',
          name: 'service',
          message: 'Which translation service do you want to use?',
          when: (answers) => answers.setupMode === 'manual',
          choices: ['google', 'deepl', 'manual'],
          default: 'google',
        },
        {
          type: 'input',
          name: 'translationSecretEnvVar',
          message: 'Name of the environment variable containing your translation API key',
          when: (answers) => answers.setupMode === 'manual' && answers.service !== 'manual',
          default: (answers: InitAnswers) =>
            answers.service === 'deepl' ? 'DEEPL_API_KEY' : 'GOOGLE_TRANSLATE_API_KEY',
        },
        {
          type: 'list',
          name: 'adapterPreset',
          message: 'How should transformed components access translations?',
          when: (answers) => answers.setupMode === 'manual',
          choices: [
            { name: 'react-i18next (default)', value: 'react-i18next' },
            { name: 'vue-i18n', value: 'vue-i18n' },
            { name: 'svelte-i18n', value: 'svelte-i18n' },
            { name: 'next-intl', value: 'next-intl' },
            { name: 'Custom hook/module', value: 'custom' },
          ],
          default: suggestedValues?.translationAdapter?.module || 'react-i18next',
        },
        {
          type: 'input',
          name: 'customAdapterModule',
          message: 'Provide the module specifier for your translation hook (e.g. "@/contexts/translation-context")',
          when: (answers) => answers.setupMode === 'manual' && answers.adapterPreset === 'custom',
          validate: (input) => (input && input.trim().length > 0 ? true : 'Module specifier cannot be empty'),
        },
        {
          type: 'input',
          name: 'customAdapterHook',
          message: 'Name of the hook/function to import (default: useTranslation)',
          when: (answers) => answers.setupMode === 'manual' && answers.adapterPreset === 'custom',
          default: 'useTranslation',
        },
        {
          type: 'input',
          name: 'keyNamespace',
          message: 'Namespace prefix for generated keys',
          when: (answers) => answers.setupMode === 'manual',
          default: suggestedValues?.keyGeneration?.namespace || 'common',
        },
        {
          type: 'input',
          name: 'shortHashLen',
          message: 'Length of short hash suffix for keys',
          when: (answers) => answers.setupMode === 'manual',
          default: suggestedValues?.keyGeneration?.shortHashLen?.toString() || '6',
          validate: (input) => {
            const num = parseInt(input, 10);
            return !isNaN(num) && num > 0 ? true : 'Please enter a positive number';
          },
        },
      ]);


      if (answers.setupMode === 'auto') {
        if (!intelligence) {
          console.log(chalk.yellow('Could not analyze project. Please use Manual setup.'));
          return;
        } else {
          const { framework, locales, filePatterns, confidence } = intelligence;
          
          // Report detection results
          if (framework.type !== 'unknown') {
            console.log(chalk.green(`  ✓ Framework: ${framework.type}`));
          }
          if (framework.adapter) {
            console.log(chalk.green(`  ✓ i18n Adapter: ${framework.adapter}`));
          }
          if (locales.existingFiles.length > 0) {
            const langs = [locales.sourceLanguage, ...locales.targetLanguages].filter(Boolean);
            console.log(chalk.green(`  ✓ Locales: ${langs.join(', ')}`));
          }
          
          const confidencePercent = Math.round(confidence.overall * 100);
          const confidenceColor = confidence.level === 'high' ? chalk.green : confidence.level === 'medium' ? chalk.yellow : chalk.red;
          console.log(confidenceColor(`  Detection confidence: ${confidencePercent}% (${confidence.level})`));

          // Create config from intelligence
          config = {
            version: 1 as const,
            sourceLanguage: locales.sourceLanguage || 'en',
            targetLanguages: locales.targetLanguages,
            localesDir: locales.localesDir || 'locales',
            include: filePatterns.include,
            exclude: filePatterns.exclude,
            minTextLength: 1,
            translation: { provider: 'manual' },
            translationAdapter: {
              module: framework.adapter || 'react-i18next',
              hookName: framework.hookName || 'useTranslation',
            },
            keyGeneration: {
              namespace: 'common',
              shortHashLen: 6,
            },
            seedTargetLocales: false,
          };
        }
      }

      if (answers.setupMode === 'template') {
        // Use template
        console.log(chalk.blue(`📋 Applying ${answers.template} template...`));
        const service = new ProjectIntelligenceService();
        // Uses pre-detected intelligence from outer scope
        const suggestedConfig = service.applyTemplate(answers.template!, intelligence || {
          framework: { type: 'unknown', adapter: 'react-i18next', hookName: 'useTranslation', features: [], confidence: 0, evidence: [] },
          locales: { sourceLanguage: 'en', targetLanguages: [], localesDir: 'locales', format: 'flat', existingFiles: [], existingKeyCount: 0, confidence: 0 },
          filePatterns: { include: ['**/*.{ts,tsx,js,jsx}'], exclude: ['node_modules/**', 'dist/**'], sourceDirectories: [], hasTypeScript: false, hasJsx: false, hasVue: false, hasSvelte: false, sourceFileCount: 0, confidence: 0 },
          existingSetup: { hasExistingConfig: false, hasExistingLocales: false, hasI18nProvider: false, runtimePackages: [], translationUsage: { hookName: 'useTranslation', translationIdentifier: 't', filesWithHooks: 0, translationCalls: 0, exampleFiles: [] } },
          confidence: { framework: 0, filePatterns: 0, existingSetup: 0, locales: 0, overall: 0, level: 'low' },
          warnings: [],
          recommendations: [],
          suggestedConfig: {
            sourceLanguage: 'en',
            targetLanguages: [],
            localesDir: 'locales',
            include: ['**/*.{ts,tsx,js,jsx}'],
            exclude: ['node_modules/**', 'dist/**'],
            translationAdapter: { module: 'react-i18next', hookName: 'useTranslation' },
            keyGeneration: { namespace: 'common', shortHashLen: 6 }
          },
        });

        config = {
          version: 1 as const,
          ...suggestedConfig,
          minTextLength: 1,
          translation: { provider: 'manual' },
          seedTargetLocales: false,
        };
      }

      if (answers.setupMode === 'manual' || !config) {
        // Manual setup - use the existing prompts
        console.log(chalk.blue('🔧 Manual configuration...'));
        
        const adapterModule =
          answers.adapterPreset === 'custom'
            ? answers.customAdapterModule?.trim()
            : 'react-i18next';
        const adapterHook =
          answers.adapterPreset === 'custom'
            ? (answers.customAdapterHook?.trim() || 'useTranslation')
            : 'useTranslation';

        const translationConfig: TranslationConfig =
          answers.service === 'manual'
            ? { provider: 'manual' }
            : {
                provider: answers.service,
                secretEnvVar: answers.translationSecretEnvVar?.trim() || undefined,
                concurrency: 5,
              };

        config = {
          version: 1 as const,
          sourceLanguage: answers.sourceLanguage,
          targetLanguages: parseGlobList(answers.targetLanguages),
          localesDir: answers.localesDir,
          include: parseGlobList(answers.include),
          exclude: parseGlobList(answers.exclude),
          minTextLength: parseInt(answers.minTextLength, 10),
          translation: translationConfig,
          translationAdapter: {
            module: adapterModule ?? 'react-i18next',
            hookName: adapterHook,
          },
          keyGeneration: {
            namespace: answers.keyNamespace,
            shortHashLen: parseInt(answers.shortHashLen, 10),
          },
          seedTargetLocales: answers.seedTargetLocales,
        };
      }

      const mergeDecision = await maybePromptMergeStrategy(config, workspaceRoot, Boolean(commandOptions.merge));
      if (mergeDecision?.aborted) {
        console.log(chalk.yellow('Aborting init to avoid overwriting existing i18n assets. Re-run with --merge to bypass.'));
        return;
      }

      const configPath = path.join(workspaceRoot, 'i18n.config.json');

      try {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`\nConfiguration created at ${configPath}`));

        // Ensure .gitignore has i18nsmith artifacts
        const gitignoreResult = await ensureGitignore(workspaceRoot);
        if (gitignoreResult.updated) {
          console.log(chalk.green(`Updated .gitignore with i18nsmith artifacts`));
        }

        if (answers.scaffoldAdapter && answers.scaffoldAdapterPath) {
          try {
            await scaffoldTranslationContext(answers.scaffoldAdapterPath, answers.sourceLanguage, {
              localesDir: answers.localesDir,
            });
            console.log(chalk.green(`Translation context scaffolded at ${answers.scaffoldAdapterPath}`));
          } catch (error) {
            console.warn(chalk.yellow(`Skipping adapter scaffold: ${(error as Error).message}`));
          }
        }

        if (
          answers.adapterPreset === 'react-i18next' &&
          answers.scaffoldReactRuntime &&
          answers.reactI18nPath &&
          answers.reactProviderPath
        ) {
          try {
            await scaffoldI18next(
              answers.reactI18nPath,
              answers.reactProviderPath,
              answers.sourceLanguage,
              answers.localesDir
            );
            console.log(chalk.green('react-i18next runtime scaffolded:'));
            console.log(chalk.green(`  • ${answers.reactI18nPath}`));
              console.log(chalk.green(`  • ${answers.reactProviderPath}`));
              console.log(chalk.blue('\nWrap your app with the provider (e.g. Next.js providers.tsx):'));
              console.log(
                chalk.cyan(
                  `import { I18nProvider } from '${answers.reactProviderPath.replace(/\\/g, '/').replace(/\.tsx?$/, '')}';\n<I18nProvider>{children}</I18nProvider>`
                )
              );
            } catch (error) {
              console.warn(chalk.yellow(`Skipping i18next scaffold: ${(error as Error).message}`));
            }
          }

          if (answers.adapterPreset === 'react-i18next') {
            const pkg = await readPackageJson();
            const missingDeps = ['react-i18next', 'i18next'].filter((dep) => !hasDependency(pkg, dep));
            if (missingDeps.length) {
              console.log(chalk.yellow('\nDependencies missing for react-i18next adapter:'));
              missingDeps.forEach((dep) => console.log(chalk.yellow(`  • ${dep}`)));
              console.log(chalk.blue('Install them with:'));
              console.log(chalk.cyan('  pnpm add react-i18next i18next'));
            }
          }

          if (mergeDecision?.strategy) {
            console.log(
              chalk.blue(
                `Merge strategy selected: ${mergeDecision.strategy}. Use this when running i18nsmith sync or diagnose to reconcile locales.`
              )
            );
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Failed to write configuration file: ${message}`);
        }
      })
    );
}

type MergeStrategy = 'keep-source' | 'overwrite' | 'interactive';

interface MergeDecision {
  strategy: MergeStrategy | null;
  aborted: boolean;
}

async function maybePromptMergeStrategy(
  config: I18nConfig,
  workspaceRoot: string,
  mergeRequested: boolean
): Promise<MergeDecision | null> {
  try {
    const report = await diagnoseWorkspace(config, { workspaceRoot });
    type LocaleInsight = (typeof report.localeFiles)[number];
    type ProviderInsight = (typeof report.providerFiles)[number];
    const existingLocales = report.localeFiles.filter((entry: LocaleInsight) => !entry.missing && !entry.parseError);
    const hasRuntime =
      report.adapterFiles.length > 0 || report.providerFiles.some((provider: ProviderInsight) => provider.hasI18nProvider);

    if (!existingLocales.length && !hasRuntime) {
      return { strategy: null, aborted: false };
    }

    console.log(chalk.yellow('\nExisting i18n assets detected:'));
    if (existingLocales.length) {
  const localeList = existingLocales.map((entry: LocaleInsight) => entry.locale).join(', ');
      console.log(`  • Locales: ${localeList}`);
    }
    if (hasRuntime) {
      console.log('  • Runtime files already present.');
    }
    if (report.conflicts.length) {
      for (const conflict of report.conflicts) {
        console.log(chalk.red(`  • ${conflict.message}`));
      }
    }

    if (!mergeRequested) {
      const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Merge with the existing setup instead of overwriting?',
          default: true,
        },
      ]);
      if (!proceed) {
        return { strategy: null, aborted: true };
      }
    }

    const { strategy } = await inquirer.prompt<{ strategy: MergeStrategy }>([
      {
        type: 'list',
        name: 'strategy',
        message: 'Choose a merge strategy for existing locale keys',
        choices: [
          { name: 'Keep source values (append new keys only)', value: 'keep-source' },
          { name: 'Overwrite with placeholders (backup first)', value: 'overwrite' },
          { name: 'Interactive review during sync', value: 'interactive' },
        ],
        default: 'keep-source',
      },
    ]);

    return { strategy, aborted: false };
  } catch (error) {
    console.warn(chalk.gray(`Skipping merge diagnostics: ${(error as Error).message}`));
    return { strategy: null, aborted: false };
  }
}

