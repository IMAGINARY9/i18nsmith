/**
 * Translate command - fill missing locale entries via translation adapters
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import type { Command } from 'commander';
import {
  DEFAULT_PLACEHOLDER_FORMATS,
  PlaceholderValidator,
  loadConfig,
  TranslationService,
  TranslationPlan,
} from '@i18nsmith/core';
import type { TranslationConfig } from '@i18nsmith/core';
import { TranslatorLoadError, type TranslatorLoadOptions } from '@i18nsmith/translation';

import type { TranslateCommandOptions, TranslateSummary, ProviderSettings } from './types.js';
import { emitTranslateOutput, maybePrintEstimate } from './reporter.js';
import { handleCsvExport, handleCsvImport } from './csv-handler.js';
import { executeTranslations } from './executor.js';

// Re-export types for external use
export * from './types.js';

/**
 * Parse comma-separated locale values
 */
function collectLocales(value: string | string[], previous: string[]): string[] {
  const tokens = (Array.isArray(value) ? value : value.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
}

/**
 * Resolve provider settings from config and options
 */
function resolveProviderSettings(
  translationConfig: TranslationConfig | undefined,
  override?: string
): ProviderSettings & { loaderOptions: TranslatorLoadOptions } {
  const providerName = (override ?? translationConfig?.provider ?? 'manual').trim();
  const moduleSpecifier = translationConfig?.module;
  let secret: string | undefined;
  if (translationConfig?.secretEnvVar) {
    secret = process.env[translationConfig.secretEnvVar];
  }

  const loaderOptions: TranslatorLoadOptions = {
    provider: providerName,
    module: moduleSpecifier,
    apiKey: translationConfig?.apiKey,
    secret,
    concurrency: translationConfig?.concurrency,
    batchSize: translationConfig?.batchSize,
    config: translationConfig ? { ...translationConfig } : undefined,
  };

  return {
    name: providerName,
    loaderOptions,
  };
}

/**
 * Prompt for translation confirmation
 */
async function confirmTranslate(plan: TranslationPlan, providerName: string): Promise<boolean> {
  const { proceed } = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: 'confirm',
      name: 'proceed',
      default: false,
      message: `Translate ${plan.totalTasks} key${plan.totalTasks === 1 ? '' : 's'} (${plan.totalCharacters} chars) across ${plan.locales.length} locale${plan.locales.length === 1 ? '' : 's'} via ${providerName}?`,
    },
  ]);
  return proceed;
}

/**
 * Register the translate command
 */
export function registerTranslate(program: Command): void {
  program
    .command('translate')
    .description('Fill missing locale entries by invoking configured translation adapters')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON summary to a file')
    .option('--write', 'Write translated values to locale files (defaults to dry-run)', false)
    .option('--locales <codes...>', 'Comma-separated list of locale codes to translate', collectLocales, [])
    .option('--provider <name>', 'Override the translation provider configured in i18n.config.json')
    .option('--force', 'Retranslate keys even if a locale already has a value', false)
    .option('--estimate', 'Attempt to estimate cost when running in dry-run mode', false)
    .option('--no-skip-empty', 'Allow writing empty translator results (default skips them)')
    .option('-y, --yes', 'Skip interactive confirmation when applying translations', false)
    .option('--strict-placeholders', 'Fail if translated output has placeholder mismatches (for CI)', false)
    .option('--export <path>', 'Export missing translations to a CSV file for external translation')
    .option('--import <path>', 'Import translations from a CSV file and merge into locale files')
    .action(async (options: TranslateCommandOptions) => {
      // Handle CSV export mode
      if (options.export) {
        await handleCsvExport(options);
        return;
      }

      // Handle CSV import mode
      if (options.import) {
        await handleCsvImport(options);
        return;
      }

      console.log(
        chalk.blue(options.write ? 'Translating locale files...' : 'Planning translations (dry-run)...')
      );

      try {
        const config = await loadConfig(options.config);
        const translationService = new TranslationService(config);
        const plan = await translationService.buildPlan({
          locales: options.locales,
          force: options.force,
        });
        const placeholderValidator = new PlaceholderValidator(
          config.sync?.placeholderFormats?.length ? config.sync.placeholderFormats : DEFAULT_PLACEHOLDER_FORMATS
        );

        if (!plan.totalTasks) {
          console.log(chalk.green('✓ No missing translations detected.'));
          return;
        }

        const providerSettings = resolveProviderSettings(config.translation, options.provider);
        const summary: TranslateSummary = {
          provider: providerSettings.name,
          dryRun: !options.write,
          plan,
          locales: [],
          localeStats: [],
          totalCharacters: plan.totalCharacters,
        };

        if (!options.write) {
          if (options.estimate && providerSettings.name !== 'manual') {
            await maybePrintEstimate(plan, providerSettings);
          }

          await emitTranslateOutput(summary, options);
          return;
        }

        if (providerSettings.name === 'manual') {
          throw new Error(
            'No translation provider configured. Update "translation.provider" in i18n.config.json or pass --provider.'
          );
        }

        if (options.write && !options.yes) {
          if (!process.stdout.isTTY) {
            throw new Error('Interactive confirmation required in non-TTY environment. Re-run with --yes to proceed.');
          }
          const confirmed = await confirmTranslate(plan, providerSettings.name);
          if (!confirmed) {
            console.log(chalk.yellow('Translation aborted by user.'));
            return;
          }
        }

        const skipEmpty = options.skipEmpty !== false;
        const strictPlaceholders = options.strictPlaceholders ?? false;
        const localeResults = await executeTranslations({
          plan,
          translationService,
          provider: providerSettings,
          overwrite: options.force ?? false,
          skipEmpty,
          placeholderValidator,
          strictPlaceholders,
        });

        summary.locales = localeResults.results;
        summary.localeStats = localeResults.stats;

        // Check for placeholder issues in strict mode
        const allPlaceholderIssues = localeResults.results.flatMap((r) => r.placeholderIssues);
        if (strictPlaceholders && allPlaceholderIssues.length > 0) {
          console.error(
            chalk.red(
              `\n✗ ${allPlaceholderIssues.length} placeholder issue(s) detected in translated output:`
            )
          );
          allPlaceholderIssues.slice(0, 10).forEach((issue) => {
            console.error(
              chalk.red(
                `  • ${issue.key} (${issue.locale}): ${issue.type} placeholder${
                  issue.placeholders.length === 1 ? '' : 's'
                } ${issue.placeholders.join(', ')}`
              )
            );
          });
          if (allPlaceholderIssues.length > 10) {
            console.error(chalk.red(`  ... and ${allPlaceholderIssues.length - 10} more issues`));
          }
          process.exitCode = 1;
        }

        await emitTranslateOutput(summary, options);
      } catch (error: unknown) {
        const translatorError = error instanceof TranslatorLoadError ? error : undefined;
        const normalizedError =
          error instanceof Error
            ? error
            : new Error(typeof error === 'string' ? error : JSON.stringify(error));

        console.error(chalk.red('Translate failed:'), translatorError?.message ?? normalizedError.message);
        process.exitCode = 1;
      }
    });
}
