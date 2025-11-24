import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'path';
import chalk from 'chalk';
import { scaffoldTranslationContext } from '../utils/scaffold.js';

interface ScaffoldAnswers {
  sourceLanguage: string;
  filePath: string;
}

export function registerScaffoldAdapter(program: Command) {
  program
    .command('scaffold-adapter')
    .description('Scaffold a lightweight translation context file')
    .option('-l, --source-language <lang>', 'Source language code', 'en')
    .option('-p, --path <path>', 'Path to scaffold the file', 'src/contexts/translation-context.tsx')
    .action(async (options: { sourceLanguage?: string; path?: string }) => {
      console.log(chalk.blue('Scaffolding translation adapter...'));

      const answers = await inquirer.prompt<ScaffoldAnswers>([
        {
          type: 'input',
          name: 'sourceLanguage',
          message: 'Source language code',
          default: options.sourceLanguage || 'en',
        },
        {
          type: 'input',
          name: 'filePath',
          message: 'Path to scaffold the translation context file',
          default: options.path || 'src/contexts/translation-context.tsx',
        },
      ]);

      try {
        await scaffoldTranslationContext(answers.filePath, answers.sourceLanguage);
        console.log(chalk.green(`Translation context scaffolded at ${answers.filePath}`));
        console.log(chalk.blue('Update your i18n.config.json to point to this file:'));
        console.log(`{
  "translationAdapter": {
    "module": "${answers.filePath.replace(/\.tsx?$/, '')}",
    "hookName": "useTranslation"
  }
}`);
      } catch (error) {
        console.error(chalk.red('Failed to scaffold adapter:'), error);
      }
    });
}
