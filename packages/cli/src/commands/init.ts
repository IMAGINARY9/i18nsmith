import { Command } from 'commander';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

export function registerInitCommand(program: Command) {
  program
    .command('init')
    .description('Initialize i18nsmith configuration')
    .action(async () => {
      console.log(chalk.blue('Initializing i18nsmith configuration...'));

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'sourceLanguage',
          message: 'What is the source language?',
          default: 'en',
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
          message: 'Which files should be scanned? (glob pattern)',
          default: 'src/**/*.{ts,tsx,js,jsx}',
        },
        {
          type: 'list',
          name: 'service',
          message: 'Which translation service do you want to use?',
          choices: ['google', 'deepl', 'manual'],
          default: 'google',
        },
      ]);

      const config = {
        sourceLanguage: answers.sourceLanguage,
        targetLanguages: [], // User can add these later or we could ask
        localesDir: answers.localesDir,
        include: [answers.include],
        exclude: ['node_modules/**'],
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
