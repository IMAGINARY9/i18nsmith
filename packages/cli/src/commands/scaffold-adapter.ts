import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import { promises as fs } from 'fs';
import { scaffoldTranslationContext, scaffoldI18next } from '../utils/scaffold.js';

interface ScaffoldAnswers {
  type: 'custom' | 'react-i18next';
  sourceLanguage: string;
  filePath?: string;
  i18nPath?: string;
  providerPath?: string;
  localesDir: string;
  force?: boolean;
}

async function readPackageJson() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  try {
    const content = await fs.readFile(pkgPath, 'utf8');
    return JSON.parse(content) as Record<string, any>;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    console.warn('Unable to read package.json for dependency checks.');
    return undefined;
  }
}

function hasDependency(pkg: Record<string, any> | undefined, dep: string) {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]);
}

export function registerScaffoldAdapter(program: Command) {
  program
    .command('scaffold-adapter')
    .description('Scaffold translation adapter files')
    .option('-t, --type <type>', 'Adapter type: custom or react-i18next')
    .option('-l, --source-language <lang>', 'Source language code', 'en')
    .option('-p, --path <path>', 'Path for custom adapter file', 'src/contexts/translation-context.tsx')
    .option('--i18n-path <path>', 'Path for react-i18next initializer', 'src/lib/i18n.ts')
    .option('--provider-path <path>', 'Path for I18nProvider component', 'src/components/i18n-provider.tsx')
    .option('--locales-dir <dir>', 'Locales directory relative to project root', 'locales')
    .option('-f, --force', 'Overwrite files if they already exist', false)
    .action(async (options: {
      type?: string;
      sourceLanguage?: string;
      path?: string;
      i18nPath?: string;
      providerPath?: string;
      localesDir?: string;
      force?: boolean;
    }) => {
      console.log(chalk.blue('Scaffolding translation resources...'));

      const answers = await inquirer.prompt<ScaffoldAnswers>([
        {
          type: 'list',
          name: 'type',
          message: 'Choose adapter type',
          choices: [
            { name: 'Custom context (zero dependencies)', value: 'custom' },
            { name: 'react-i18next (standard)', value: 'react-i18next' },
          ],
          default: options.type || 'custom',
        },
        {
          type: 'input',
          name: 'sourceLanguage',
          message: 'Source language code',
          default: options.sourceLanguage || 'en',
        },
        {
          type: 'input',
          name: 'localesDir',
          message: 'Locales directory (relative to project root)',
          default: options.localesDir || 'locales',
        },
        {
          type: 'input',
          name: 'filePath',
          message: 'Path to scaffold translation context file',
          default: options.path || 'src/contexts/translation-context.tsx',
          when: (answers) => answers.type === 'custom',
        },
        {
          type: 'input',
          name: 'i18nPath',
          message: 'Path for i18next initializer (i18n.ts)',
          default: options.i18nPath || 'src/lib/i18n.ts',
          when: (answers) => answers.type === 'react-i18next',
        },
        {
          type: 'input',
          name: 'providerPath',
          message: 'Path for I18nProvider component',
          default: options.providerPath || 'src/components/i18n-provider.tsx',
          when: (answers) => answers.type === 'react-i18next',
        },
        {
          type: 'confirm',
          name: 'force',
          message: 'Overwrite files if they exist?',
          default: Boolean(options.force),
        },
      ]);

      try {
        if (answers.type === 'custom' && answers.filePath) {
          const target = await scaffoldTranslationContext(answers.filePath, answers.sourceLanguage, {
            localesDir: answers.localesDir,
            force: answers.force,
          });
          console.log(chalk.green(`Translation context scaffolded at ${target}`));
          console.log(chalk.blue('\nUpdate your i18n.config.json:'));
          console.log(`{
  "translationAdapter": {
    "module": "${answers.filePath.replace(/\\\\/g, '/').replace(/\.tsx?$/, '')}",
    "hookName": "useTranslation"
  }
}`);
        } else if (answers.type === 'react-i18next' && answers.i18nPath && answers.providerPath) {
          const { i18nPath, providerPath } = await scaffoldI18next(
            answers.i18nPath,
            answers.providerPath,
            answers.sourceLanguage,
            answers.localesDir,
            { force: answers.force }
          );

          console.log(chalk.green('\nScaffolded react-i18next runtime:'));
          console.log(chalk.green(`  • ${i18nPath}`));
          console.log(chalk.green(`  • ${providerPath}`));

          const pkg = await readPackageJson();
          const missingDeps = ['react-i18next', 'i18next'].filter((dep) => !hasDependency(pkg, dep));
          if (missingDeps.length) {
            console.log(chalk.yellow('\nDependencies missing:')); 
            missingDeps.forEach((dep) => console.log(chalk.yellow(`  • ${dep}`)));
            console.log(chalk.blue('Install them with:'));
            console.log(chalk.cyan('  pnpm add react-i18next i18next'));
          }

          console.log(chalk.blue('\nWrap your app with the provider (e.g. Next.js providers.tsx):'));
          console.log(chalk.cyan(`import { I18nProvider } from '${answers.providerPath.replace(/\\\\/g, '/').replace(/\.tsx?$/, '')}';`));
          console.log(chalk.cyan('<I18nProvider>{children}</I18nProvider>'));
        }
      } catch (error) {
        console.error(chalk.red('Failed to scaffold adapter:'), (error as Error).message);
      }
    });
}
