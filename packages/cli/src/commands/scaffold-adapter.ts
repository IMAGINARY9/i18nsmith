import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import path from 'path';
import { promises as fs } from 'fs';
import { scaffoldTranslationContext, scaffoldI18next } from '../utils/scaffold.js';
import { readPackageJson, hasDependency } from '../utils/pkg.js';
import { detectPackageManager, installDependencies } from '../utils/package-manager';

interface ScaffoldCommandOptions {
  type?: 'custom' | 'react-i18next';
  sourceLanguage?: string;
  path?: string;
  i18nPath?: string;
  providerPath?: string;
  localesDir?: string;
  force?: boolean;
  installDeps?: boolean;
}

interface ScaffoldAnswers {
  type: 'custom' | 'react-i18next';
  sourceLanguage: string;
  localesDir: string;
  force: boolean;
  filePath: string;
  i18nPath: string;
  providerPath: string;
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
    .option('--install-deps', 'Automatically install adapter dependencies when missing', false)
    .action(async (options: ScaffoldCommandOptions) => {
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
        if (answers.type === 'custom') {
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
        } else if (answers.type === 'react-i18next') {
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

            if (options.installDeps) {
              try {
                const manager = await detectPackageManager();
                console.log(chalk.blue(`\nInstalling dependencies with ${manager}...`));
                await installDependencies(manager, missingDeps);
                console.log(chalk.green('Dependencies installed successfully.'));
              } catch (error) {
                console.error(chalk.red('Failed to install dependencies automatically:'), (error as Error).message);
                console.log(chalk.blue('You can install them manually:'));
                console.log(chalk.cyan('  pnpm add react-i18next i18next'));
              }
            } else {
              console.log(chalk.blue('Install them with:'));
              console.log(chalk.cyan('  pnpm add react-i18next i18next'));
            }
          }

          console.log(chalk.blue('\nWrap your app with the provider (e.g. Next.js providers.tsx):'));
          console.log(chalk.cyan(`import { I18nProvider } from '${answers.providerPath.replace(/\\\\/g, '/').replace(/\.tsx?$/, '')}';`));
          console.log(chalk.cyan('<I18nProvider>{children}</I18nProvider>'));

          const injectionResult = await maybeInjectProvider(providerPath);
          if (injectionResult.status === 'injected') {
            console.log(chalk.green(`\nUpdated ${injectionResult.file} to wrap <I18nProvider>.`));
          } else if (injectionResult.status === 'skipped') {
            console.log(chalk.yellow(`\nProvider file ${injectionResult.file} already uses I18nProvider. Skipping injection.`));
          } else if (injectionResult.status === 'failed') {
            console.log(chalk.red(`\nCould not automatically inject provider into ${injectionResult.file}. Edit manually to wrap your layout.`));
          } else {
            console.log(chalk.gray('\nNo Next.js provider file detected for automatic injection.')); 
          }
        }
      } catch (error) {
        console.error(chalk.red('Failed to scaffold adapter:'), (error as Error).message);
      }
    });
}

async function fileExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function toRelativeImport(from: string, to: string) {
  let relative = path.relative(from, to).replace(/\\/g, '/');
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative.replace(/\.(ts|tsx|js|jsx)$/i, '');
}

function insertImport(source: string, statement: string) {
  const importRegex = /^(import[^;]+;\s*)+/m;
  const match = source.match(importRegex);
  if (match) {
    const idx = match.index! + match[0].length;
    return `${source.slice(0, idx)}${statement}\n${source.slice(idx)}`;
  }
  return `${statement}\n${source}`;
}

async function maybeInjectProvider(providerComponentPath: string) {
  const workspaceRoot = process.cwd();
  const candidates = ['app/providers.tsx', 'app/providers.ts', 'app/providers.jsx', 'app/providers.js', 'src/app/providers.tsx', 'src/app/providers.ts', 'src/app/providers.jsx', 'src/app/providers.js'];
  const providerAbsolute = path.resolve(providerComponentPath);

  for (const candidate of candidates) {
    const absolute = path.resolve(workspaceRoot, candidate);
    if (!(await fileExists(absolute))) {
      continue;
    }

    const contents = await fs.readFile(absolute, 'utf8');
    if (contents.includes('I18nProvider')) {
      return { status: 'skipped' as const, file: candidate };
    }

    const importPath = toRelativeImport(path.dirname(absolute), providerAbsolute);
    const newImport = `import { I18nProvider } from '${importPath}';\n`;
    const withImport = insertImport(contents, newImport);
    if (!withImport.includes('{children}')) {
      return { status: 'failed' as const, file: candidate };
    }
    const wrapped = withImport.replace('{children}', '<I18nProvider>{children}</I18nProvider>');
    await fs.writeFile(absolute, wrapped, 'utf8');
    return { status: 'injected' as const, file: candidate };
  }

  return { status: 'not-found' as const };
}
