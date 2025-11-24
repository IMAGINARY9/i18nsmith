import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { scaffoldTranslationContext, scaffoldI18next } from '../utils/scaffold.js';

async function readPackageJson() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  try {
    const content = await fs.readFile(pkgPath, 'utf8');
    return JSON.parse(content) as Record<string, any>;
  } catch {
    return undefined;
  }
}

function hasDependency(pkg: Record<string, any> | undefined, dep: string) {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]);
}

interface InitAnswers {
  sourceLanguage: string;
  targetLanguages: string;
  localesDir: string;
  include: string;
  exclude: string;
  minTextLength: string;
  service: 'google' | 'deepl' | 'manual';
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

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Initialize i18nsmith configuration')
    .action(async () => {
      console.log(chalk.blue('Initializing i18nsmith configuration...'));

      const answers = await inquirer.prompt<InitAnswers>([
        {
          type: 'input',
          name: 'sourceLanguage',
          message: 'What is the source language?',
          default: 'en',
        },
        {
          type: 'input',
          name: 'targetLanguages',
          message: 'Which target languages do you need? (comma separated)',
          default: 'fr',
        },
        {
          type: 'input',
          name: 'localesDir',
          message: 'Where should locale files be stored?',
          default: 'locales',
        },
        {
          type: 'input',
          name: 'include',
          message: 'Which files should be scanned? (comma separated glob patterns)',
          default: 'src/**/*.{ts,tsx,js,jsx}',
        },
        {
          type: 'input',
          name: 'exclude',
          message: 'Which files should be excluded? (comma separated glob patterns)',
          default: 'node_modules/**,**/*.test.*',
        },
        {
          type: 'input',
          name: 'minTextLength',
          message: 'Minimum length for translatable text?',
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
          choices: ['google', 'deepl', 'manual'],
          default: 'google',
        },
        {
          type: 'list',
          name: 'adapterPreset',
          message: 'How should transformed components access translations?',
          choices: [
            { name: 'react-i18next (default)', value: 'react-i18next' },
            { name: 'Custom hook/module', value: 'custom' },
          ],
          default: 'react-i18next',
        },
        {
          type: 'input',
          name: 'customAdapterModule',
          message: 'Provide the module specifier for your translation hook (e.g. "@/contexts/translation-context")',
          when: (answers) => answers.adapterPreset === 'custom',
          validate: (input) => (input && input.trim().length > 0 ? true : 'Module specifier cannot be empty'),
        },
        {
          type: 'input',
          name: 'customAdapterHook',
          message: 'Name of the hook/function to import (default: useTranslation)',
          when: (answers) => answers.adapterPreset === 'custom',
          default: 'useTranslation',
        },
        {
          type: 'confirm',
          name: 'scaffoldAdapter',
          message: 'Scaffold a lightweight translation context file?',
          when: (answers) => answers.adapterPreset === 'custom',
          default: true,
        },
        {
          type: 'input',
          name: 'scaffoldAdapterPath',
          message: 'Path to scaffold the translation context file (relative to project root)',
          when: (answers) => answers.scaffoldAdapter,
          default: 'src/contexts/translation-context.tsx',
        },
        {
          type: 'confirm',
          name: 'scaffoldReactRuntime',
          message: 'Scaffold i18next initializer and provider?',
          when: (answers) => answers.adapterPreset === 'react-i18next',
          default: true,
        },
        {
          type: 'input',
          name: 'reactI18nPath',
          message: 'Path for i18next initializer (e.g. src/lib/i18n.ts)',
          when: (answers) => answers.scaffoldReactRuntime,
          default: 'src/lib/i18n.ts',
        },
        {
          type: 'input',
          name: 'reactProviderPath',
          message: 'Path for I18nProvider component (e.g. src/components/i18n-provider.tsx)',
          when: (answers) => answers.scaffoldReactRuntime,
          default: 'src/components/i18n-provider.tsx',
        },
        {
          type: 'input',
          name: 'keyNamespace',
          message: 'Namespace prefix for generated keys',
          default: 'common',
        },
        {
          type: 'input',
          name: 'shortHashLen',
          message: 'Length of short hash suffix for keys',
          default: '6',
          validate: (input) => {
            const num = parseInt(input, 10);
            return !isNaN(num) && num > 0 ? true : 'Please enter a positive number';
          },
        },
        {
          type: 'confirm',
          name: 'seedTargetLocales',
          message: 'Seed target locale files with empty values?',
          default: false,
        },
      ]);

      const parseList = (value: string) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);

      const adapterModule =
        answers.adapterPreset === 'custom'
          ? answers.customAdapterModule?.trim()
          : 'react-i18next';
      const adapterHook =
        answers.adapterPreset === 'custom'
          ? (answers.customAdapterHook?.trim() || 'useTranslation')
          : 'useTranslation';

      const config = {
        sourceLanguage: answers.sourceLanguage,
        targetLanguages: parseList(answers.targetLanguages),
        localesDir: answers.localesDir,
        include: parseList(answers.include),
        exclude: parseList(answers.exclude),
        minTextLength: parseInt(answers.minTextLength, 10),
        translation: {
          service: answers.service,
        },
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

      const configPath = path.join(process.cwd(), 'i18n.config.json');
      
      try {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`\nConfiguration created at ${configPath}`));

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
      } catch (error) {
        console.error(chalk.red('Failed to write configuration file:'), error);
      }
    });
}

