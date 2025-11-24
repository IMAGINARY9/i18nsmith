import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { scaffoldTranslationContext } from '../utils/scaffold.js';

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
          await scaffoldTranslationContext(answers.scaffoldAdapterPath, answers.sourceLanguage);
          console.log(chalk.green(`Translation context scaffolded at ${answers.scaffoldAdapterPath}`));
        }
      } catch (error) {
        console.error(chalk.red('Failed to write configuration file:'), error);
      }
    });
}

