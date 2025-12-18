import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { diagnoseWorkspace, loadConfig } from '@i18nsmith/core';
import { scaffoldTranslationContext, scaffoldI18next } from '../utils/scaffold.js';
import { readPackageJson, hasDependency } from '../utils/pkg.js';
import { detectPackageManager, installDependencies } from '../utils/package-manager.js';
import { maybeInjectProvider } from '../utils/provider-injector.js';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface ScaffoldCommandOptions {
  type?: 'custom' | 'react-i18next';
  sourceLanguage?: string;
  path?: string;
  i18nPath?: string;
  providerPath?: string;
  localesDir?: string;
  force?: boolean;
  installDeps?: boolean;
  dryRun?: boolean;
  skipIfDetected?: boolean;
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
    .option('--dry-run', 'Preview provider injection changes without modifying files', false)
    .option('--no-skip-if-detected', 'Force scaffolding even if existing adapters/providers are detected')
    .action(
      withErrorHandling(async (options: ScaffoldCommandOptions) => {
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

      if ((options.skipIfDetected ?? true) && !options.force && !answers.force) {
        const detection = await detectExistingRuntime();
        if (detection) {
          console.log(
            chalk.yellow(
              `Existing i18n runtime detected (${detection}). Skipping scaffold. Use --no-skip-if-detected or --force to override.`
            )
          );
          return;
        }
      }

      try {
        const dryRun = Boolean(options.dryRun);

        if (answers.type === 'custom') {
          const result = await scaffoldTranslationContext(answers.filePath, answers.sourceLanguage, {
            localesDir: answers.localesDir,
            force: answers.force,
            dryRun,
          });

          if (dryRun) {
            console.log(chalk.blue('\n📋 DRY RUN - No files were modified\n'));
            console.log(chalk.cyan(`Would create: ${result.path}`));
            console.log(chalk.gray('─'.repeat(60)));
            console.log(result.content);
            console.log(chalk.gray('─'.repeat(60)));
          } else {
            console.log(chalk.green(`Translation context scaffolded at ${result.path}`));
          }

          console.log(chalk.blue('\nUpdate your i18n.config.json:'));
          console.log(`{
  "translationAdapter": {
    "module": "${answers.filePath.replace(/\\\\/g, '/').replace(/\.tsx?$/, '')}",
    "hookName": "useTranslation"
  }
}`);
        } else if (answers.type === 'react-i18next') {
          const { i18nPath, providerPath, i18nResult, providerResult } = await scaffoldI18next(
            answers.i18nPath,
            answers.providerPath,
            answers.sourceLanguage,
            answers.localesDir,
            { force: answers.force, dryRun }
          );

          if (dryRun) {
            console.log(chalk.blue('\n📋 DRY RUN - No files were modified\n'));
            console.log(chalk.cyan(`Would create: ${i18nResult.path}`));
            console.log(chalk.gray('─'.repeat(60)));
            console.log(i18nResult.content);
            console.log(chalk.gray('─'.repeat(60)));
            console.log(chalk.cyan(`\nWould create: ${providerResult.path}`));
            console.log(chalk.gray('─'.repeat(60)));
            console.log(providerResult.content);
            console.log(chalk.gray('─'.repeat(60)));
          } else {
            console.log(chalk.green('\nScaffolded react-i18next runtime:'));
            console.log(chalk.green(`  • ${i18nPath}`));
            console.log(chalk.green(`  • ${providerPath}`));
          }

          const pkg = await readPackageJson();
          const missingDeps = ['react-i18next', 'i18next'].filter((dep) => !hasDependency(pkg, dep));
          if (missingDeps.length) {
            console.log(chalk.yellow('\nDependencies missing:'));
            missingDeps.forEach((dep) => console.log(chalk.yellow(`  • ${dep}`)));

            if (dryRun) {
              console.log(chalk.blue('\nIn write mode, install them with:'));
              console.log(chalk.cyan('  pnpm add react-i18next i18next'));
            } else if (options.installDeps) {
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

          const injectionResult = await maybeInjectProvider({
            providerComponentPath: providerPath,
            dryRun: Boolean(options.dryRun),
          });

          if (injectionResult.status === 'injected') {
            console.log(chalk.green(`\nUpdated ${injectionResult.file} to wrap <I18nProvider>.`));
          } else if (injectionResult.status === 'preview') {
            console.log(
              chalk.blue(`\nProvider dry-run for ${injectionResult.file}: changes previewed below (no files modified).`)
            );
            console.log(injectionResult.diff.trimEnd());
          } else if (injectionResult.status === 'skipped') {
            console.log(
              chalk.yellow(`\nProvider file ${injectionResult.file} already uses I18nProvider. Skipping injection.`)
            );
          } else if (injectionResult.status === 'failed') {
            console.log(
              chalk.red(
                `\nCould not safely inject I18nProvider into ${injectionResult.file}: ${injectionResult.reason}\n` +
                  'Please manually wrap your layout or providers file with <I18nProvider> and rerun.'
              )
            );
          } else {
            console.log(chalk.gray('\nNo Next.js provider file detected for automatic injection.'));
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CliError(`Failed to scaffold adapter: ${message}`);
      }
    })
    );
}

async function detectExistingRuntime(): Promise<string | null> {
  try {
    const config = await loadConfig();
    const report = await diagnoseWorkspace(config);
    type AdapterInfo = (typeof report.adapterFiles)[number];
    type ProviderInfo = (typeof report.providerFiles)[number];

    if (report.adapterFiles.length) {
      return report.adapterFiles.map((adapter: AdapterInfo) => adapter.path).join(', ');
    }
    const provider = report.providerFiles.find((entry: ProviderInfo) => entry.hasI18nProvider);
    if (provider) {
      return provider.relativePath;
    }
  } catch (error) {
    if ((error as Error).message?.includes('Config file not found')) {
      return null;
    }
    console.warn(chalk.gray(`Skipping adapter detection: ${(error as Error).message}`));
  }
  return null;
}
