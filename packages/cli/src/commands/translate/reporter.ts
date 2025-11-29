/**
 * Output formatting and reporting utilities for the translate command
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { TranslationPlan } from '@i18nsmith/core';
import { loadTranslator, type TranslatorLoadOptions } from '@i18nsmith/translation';
import type {
  TranslateSummary,
  TranslateLocaleResult,
  TranslateCommandOptions,
  ProviderSettings,
} from './types.js';

/**
 * Emit the translation output (report file, JSON, or console)
 */
export async function emitTranslateOutput(
  summary: TranslateSummary,
  options: TranslateCommandOptions
): Promise<void> {
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

/**
 * Print a summary of the translation plan
 */
export function printPlanSummary(plan: TranslationPlan): void {
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

/**
 * Print the execution summary after translations are applied
 */
export function printExecutionSummary(results: TranslateLocaleResult[]): void {
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

/**
 * Print cost estimation if available
 */
export async function maybePrintEstimate(
  plan: TranslationPlan,
  provider: ProviderSettings & { loaderOptions: TranslatorLoadOptions }
): Promise<void> {
  console.log(chalk.blue('\n📊 Cost Estimation:'));
  console.log(chalk.gray(`  Provider: ${provider.name}`));
  console.log(chalk.gray(`  Total characters: ${plan.totalCharacters.toLocaleString()}`));
  console.log(chalk.gray(`  Locales: ${plan.locales.length}`));

  try {
    const translator = await loadTranslator(provider.loaderOptions);
    if (typeof translator.estimateCost === 'function') {
      const estimate = await translator.estimateCost(plan.totalCharacters, { localeCount: plan.locales.length });
      const formattedCost = typeof estimate === 'number'
        ? `$${estimate.toFixed(4)}`
        : String(estimate);
      console.log(chalk.green(`  Estimated cost: ${formattedCost}`));
    } else {
      console.log(chalk.yellow('  Provider does not expose cost estimation.'));
      printGenericEstimate(plan);
    }
    await translator.dispose?.();
  } catch (error) {
    console.log(chalk.yellow(`  Unable to estimate via provider: ${(error as Error).message}`));
    printGenericEstimate(plan);
  }
}

/**
 * Print a generic cost estimate based on common cloud provider rates
 */
export function printGenericEstimate(plan: TranslationPlan): void {
  // Generic estimation based on common cloud provider rates (rough average)
  // Google/AWS/Azure typically charge ~$20 per million characters
  const ratePerMillion = 20;
  const charsByLocale = plan.totalCharacters;
  const totalChars = charsByLocale * plan.locales.length;
  const estimated = (totalChars / 1_000_000) * ratePerMillion;
  console.log(chalk.gray(`  Generic estimate (at ~$20/M chars): $${estimated.toFixed(4)}`));
  console.log(chalk.gray('  (Actual costs vary by provider and tier)'));
}
