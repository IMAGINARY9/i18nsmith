import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig, TranslationPlan, TranslationService } from '@i18nsmith/core';
import type { TranslationConfig, TranslationLocalePlan, TranslationWriteSummary } from '@i18nsmith/core';
import {
  loadTranslator,
  type Translator,
  type TranslatorLoadOptions,
  TranslatorLoadError,
} from '@i18nsmith/translation';
import pLimit from 'p-limit';
import pRetry from 'p-retry';

interface TranslateCommandOptions {
  config?: string;
  json?: boolean;
  report?: string;
  write?: boolean;
  locales?: string[];
  provider?: string;
  force?: boolean;
  estimate?: boolean;
  skipEmpty?: boolean;
}

interface TranslateLocaleResult extends TranslationWriteSummary {
  characters: number;
}

interface TranslateSummary {
  provider: string;
  dryRun: boolean;
  plan: TranslationPlan;
  locales: TranslateLocaleResult[];
  localeStats: Awaited<ReturnType<TranslationService['flush']>>;
  totalCharacters: number;
}

export function registerTranslate(program: Command) {
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
    .action(async (options: TranslateCommandOptions) => {
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

        const skipEmpty = options.skipEmpty !== false;
        const localeResults = await executeTranslations({
          plan,
          translationService,
          provider: providerSettings,
          overwrite: options.force ?? false,
          skipEmpty,
        });

        summary.locales = localeResults.results;
        summary.localeStats = localeResults.stats;

        await emitTranslateOutput(summary, options);
      } catch (error) {
        const translatorError = error instanceof TranslatorLoadError ? error : undefined;
        const err = translatorError
          ?? (error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error'));
        console.error(chalk.red('Translate failed:'), translatorError?.message ?? err.message);
        process.exitCode = 1;
      }
    });
}

function collectLocales(value: string | string[], previous: string[]): string[] {
  const tokens = (Array.isArray(value) ? value : value.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
}

async function emitTranslateOutput(summary: TranslateSummary, options: TranslateCommandOptions) {
  if (options.report) {
    const outputPath = path.resolve(process.cwd(), options.report);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
    console.log(chalk.green(`Translate report written to ${outputPath}`));
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printPlanSummary(summary.plan);

  if (!summary.dryRun) {
    printExecutionSummary(summary.locales);
    const mutations = summary.localeStats.reduce(
      (total, stat) => total + stat.added.length + stat.updated.length,
      0
    );
    if (mutations === 0) {
      console.log(chalk.yellow('No locale files were updated. Translator may have skipped all entries.'));
    }
  } else {
    console.log(chalk.yellow('Run again with --write to apply translations.'));
  }
}

function printPlanSummary(plan: TranslationPlan) {
  console.log(
    chalk.green(
      `Source locale ${plan.sourceLocale}; ${plan.totalTasks} missing entr${plan.totalTasks === 1 ? 'y' : 'ies'} across ${plan.locales.length} locale${plan.locales.length === 1 ? '' : 's'}.`
    )
  );

  if (!plan.locales.length) {
    console.log(chalk.green('All configured locales are up to date.'));
    return;
  }

  plan.locales.forEach((localePlan) => {
    const reuseCount = localePlan.tasks.filter((task) => task.reusedValue).length;
    const reuseMessage = reuseCount > 0 ? chalk.gray(` (${reuseCount} reusable)`) : '';
    console.log(
      `  • ${localePlan.locale}: ${localePlan.tasks.length} key${
        localePlan.tasks.length === 1 ? '' : 's'
      } (${localePlan.totalCharacters} chars)${reuseMessage}`
    );
  });
}

function printExecutionSummary(results: TranslateLocaleResult[]) {
  if (!results.length) {
    console.log(chalk.yellow('No translations were written.'));
    return;
  }

  console.log(chalk.blue('\nTranslation results:'));
  results.forEach((result) => {
    console.log(
      `  • ${result.locale}: ${result.written} written, ${result.skipped} skipped, ${result.emptySkipped} empty (${result.characters} chars)`
    );
  });
}

async function maybePrintEstimate(plan: TranslationPlan, provider: ProviderSettings) {
  try {
    const translator = await loadTranslator(provider.loaderOptions);
    if (typeof translator.estimateCost === 'function') {
      const estimate = await translator.estimateCost(plan.totalCharacters, { localeCount: plan.locales.length });
      console.log(chalk.gray(`Estimated cost: ${estimate}`));
    } else {
      console.log(chalk.gray('Provider does not expose cost estimation.'));
    }
    await translator.dispose?.();
  } catch (error) {
    console.log(chalk.yellow(`Unable to estimate translation cost: ${(error as Error).message}`));
  }
}

interface ProviderSettings {
  name: string;
  loaderOptions: TranslatorLoadOptions;
}

function resolveProviderSettings(
  translationConfig: TranslationConfig | undefined,
  override?: string
): ProviderSettings {
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

async function executeTranslations(input: {
  plan: TranslationPlan;
  translationService: TranslationService;
  provider: ProviderSettings;
  overwrite: boolean;
  skipEmpty: boolean;
}): Promise<{ results: TranslateLocaleResult[]; stats: Awaited<ReturnType<TranslationService['flush']>> }> {
  const translator = await loadTranslator(input.provider.loaderOptions);
  const results: TranslateLocaleResult[] = [];
  const limit = pLimit(input.provider.loaderOptions.concurrency ?? 4);

  try {
    const translationPromises = input.plan.locales.map((localePlan) =>
      limit(async () => {
        const updates = await translateLocalePlan(
          translator,
          localePlan,
          input.plan.sourceLocale,
          input.provider.loaderOptions.batchSize ?? 25
        );
        const writeSummary = await input.translationService.writeTranslations(localePlan.locale, updates, {
          overwrite: input.overwrite,
          skipEmpty: input.skipEmpty,
        });
        results.push({
          ...writeSummary,
          characters: localePlan.totalCharacters,
        });
      })
    );

    await Promise.all(translationPromises);

    const stats = await input.translationService.flush();
    // Sort results to match the plan's locale order for consistent output
    results.sort((a, b) => {
      const aIndex = input.plan.locales.findIndex((p) => p.locale === a.locale);
      const bIndex = input.plan.locales.findIndex((p) => p.locale === b.locale);
      return aIndex - bIndex;
    });
    return { results, stats };
  } finally {
    await translator.dispose?.();
  }
}

async function translateLocalePlan(
  translator: Translator,
  localePlan: TranslationLocalePlan,
  sourceLocale: string,
  batchSize: number
) {
  const updates: { key: string; value: string }[] = [];
  for (const chunk of chunkTasks(localePlan.tasks, batchSize)) {
    const textsToTranslate = chunk.map((task) => task.sourceValue);
    const translationMap = new Map<string, string>();

    // Pre-fill with reused values
    chunk.forEach((task) => {
      if (task.reusedValue) {
        translationMap.set(task.key, task.reusedValue.value);
      }
    });

    const tasksRequiringTranslation = chunk.filter((task) => !task.reusedValue);
    if (tasksRequiringTranslation.length > 0) {
      const sourceTexts = tasksRequiringTranslation.map((task) => task.sourceValue);
      const translated = await pRetry(() => translator.translate(sourceTexts, sourceLocale, localePlan.locale), {
        retries: 3,
        onFailedAttempt: (error) => {
          console.log(
            chalk.yellow(
              `Attempt ${error.attemptNumber} failed translating ${localePlan.locale}. There are ${error.retriesLeft} retries left.`
            )
          );
        },
      });

      if (!Array.isArray(translated) || translated.length !== sourceTexts.length) {
        throw new Error(
          `Translator returned ${translated.length} result(s) for ${sourceTexts.length} input(s) while translating ${localePlan.locale}.`
        );
      }

      tasksRequiringTranslation.forEach((task, index) => {
        translationMap.set(task.key, translated[index] ?? '');
      });
    }

    chunk.forEach((task) => {
      updates.push({ key: task.key, value: translationMap.get(task.key) ?? '' });
    });
  }

  return updates;
}

function chunkTasks<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
