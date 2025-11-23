import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

interface InitAnswers {
  sourceLanguage: string;
  targetLanguages: string;
  localesDir: string;
  include: string;
  exclude: string;
  service: 'google' | 'deepl' | 'manual';
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
          type: 'list',
          name: 'service',
          message: 'Which translation service do you want to use?',
          choices: ['google', 'deepl', 'manual'],
          default: 'google',
        },
      ]);

      const parseList = (value: string) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);

      const config = {
        sourceLanguage: answers.sourceLanguage,
        targetLanguages: parseList(answers.targetLanguages),
        localesDir: answers.localesDir,
        include: parseList(answers.include),
        exclude: parseList(answers.exclude),
        translation: {
          service: answers.service,
        },
      };

      const configPath = path.join(process.cwd(), 'i18n.config.json');
      
      try {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`\nConfiguration created at ${configPath}`));
      } catch (error) {
        console.error(chalk.red('Failed to write configuration file:'), error);
      }
    });
}
