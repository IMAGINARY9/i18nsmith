import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { Command } from 'commander';
import {
  DEFAULT_PLACEHOLDER_FORMATS,
  PlaceholderValidator,
  loadConfig,
  TranslationPlan,
  TranslationService,
} from '@i18nsmith/core';
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
  yes?: boolean;
  strictPlaceholders?: boolean;
  export?: string;
  import?: string;
}

interface TranslateLocaleResult extends TranslationWriteSummary {
  characters: number;
  placeholderIssues: PlaceholderIssue[];
}

interface PlaceholderIssue {
  key: string;
  locale: string;
  type: 'missing' | 'extra';
  placeholders: string[];
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

function printGenericEstimate(plan: TranslationPlan) {
  // Generic estimation based on common cloud provider rates (rough average)
  // Google/AWS/Azure typically charge ~$20 per million characters
  const ratePerMillion = 20;
  const charsByLocale = plan.totalCharacters;
  const totalChars = charsByLocale * plan.locales.length;
  const estimated = (totalChars / 1_000_000) * ratePerMillion;
  console.log(chalk.gray(`  Generic estimate (at ~$20/M chars): $${estimated.toFixed(4)}`));
  console.log(chalk.gray('  (Actual costs vary by provider and tier)'));
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

async function executeTranslations(input: {
  plan: TranslationPlan;
  translationService: TranslationService;
  provider: ProviderSettings;
  overwrite: boolean;
  skipEmpty: boolean;
  placeholderValidator: PlaceholderValidator;
  strictPlaceholders: boolean;
}): Promise<{ results: TranslateLocaleResult[]; stats: Awaited<ReturnType<TranslationService['flush']>> }> {
  const translator = await loadTranslator(input.provider.loaderOptions);
  const results: TranslateLocaleResult[] = [];
  const limit = pLimit(input.provider.loaderOptions.concurrency ?? 4);

  try {
    const translationPromises = input.plan.locales.map((localePlan) =>
      limit(async () => {
        const { updates, placeholderIssues } = await translateLocalePlan(
          translator,
          localePlan,
          input.plan.sourceLocale,
          input.provider.loaderOptions.batchSize ?? 25,
          input.placeholderValidator,
          input.strictPlaceholders
        );
        const writeSummary = await input.translationService.writeTranslations(localePlan.locale, updates, {
          overwrite: input.overwrite,
          skipEmpty: input.skipEmpty,
        });
        results.push({
          ...writeSummary,
          characters: localePlan.totalCharacters,
          placeholderIssues,
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
  batchSize: number,
  placeholderValidator: PlaceholderValidator,
  strictPlaceholders: boolean
): Promise<{ updates: { key: string; value: string }[]; placeholderIssues: PlaceholderIssue[] }> {
  const updates: { key: string; value: string }[] = [];
  const placeholderIssues: PlaceholderIssue[] = [];
  for (const chunk of chunkTasks(localePlan.tasks, batchSize)) {
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
        const candidate = translated[index] ?? '';
        const comparison = placeholderValidator.compare(task.sourceValue, candidate ?? '');

        if (task.placeholders.length && comparison.missing.length) {
          placeholderIssues.push({
            key: task.key,
            locale: localePlan.locale,
            type: 'missing',
            placeholders: comparison.missing,
          });
          if (!strictPlaceholders) {
            console.log(
              chalk.yellow(
                `Translator output for ${task.key} (${localePlan.locale}) is missing placeholder${
                  comparison.missing.length === 1 ? '' : 's'
                }: ${comparison.missing.join(', ')}. Falling back to source text.`
              )
            );
          }
          translationMap.set(task.key, task.sourceValue);
          return;
        }

        if (comparison.extra.length) {
          placeholderIssues.push({
            key: task.key,
            locale: localePlan.locale,
            type: 'extra',
            placeholders: comparison.extra,
          });
          if (!strictPlaceholders) {
            console.log(
              chalk.yellow(
                `Translator output for ${task.key} (${localePlan.locale}) introduced unexpected placeholder${
                  comparison.extra.length === 1 ? '' : 's'
                }: ${comparison.extra.join(', ')}`
              )
            );
          }
        }

        translationMap.set(task.key, candidate ?? '');
      });
    }

    chunk.forEach((task) => {
      updates.push({ key: task.key, value: translationMap.get(task.key) ?? '' });
    });
  }

  return { updates, placeholderIssues };
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

// ─────────────────────────────────────────────────────────────────────────────
// CSV Export/Import for translator handoff
// ─────────────────────────────────────────────────────────────────────────────

interface CsvRow {
  key: string;
  sourceLocale: string;
  sourceValue: string;
  targetLocale: string;
  translatedValue: string;
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
      } else if (char === ',') {
        fields.push(current);
        current = '';
        i++;
      } else {
        current += char;
        i++;
      }
    }
  }
  fields.push(current);
  return fields;
}

async function handleCsvExport(options: TranslateCommandOptions): Promise<void> {
  const exportPath = options.export!;
  console.log(chalk.blue(`Exporting missing translations to ${exportPath}...`));

  try {
    const config = await loadConfig(options.config);
    const translationService = new TranslationService(config);
    const plan = await translationService.buildPlan({
      locales: options.locales,
      force: options.force,
    });

    if (!plan.totalTasks) {
      console.log(chalk.green('✓ No missing translations to export.'));
      return;
    }

    // Build CSV rows
    const rows: CsvRow[] = [];
    for (const localePlan of plan.locales) {
      for (const task of localePlan.tasks) {
        rows.push({
          key: task.key,
          sourceLocale: plan.sourceLocale,
          sourceValue: task.sourceValue,
          targetLocale: localePlan.locale,
          translatedValue: '',
        });
      }
    }

    // Generate CSV content
    const header = 'key,sourceLocale,sourceValue,targetLocale,translatedValue';
    const csvLines = [header];
    for (const row of rows) {
      csvLines.push([
        escapeCsvField(row.key),
        escapeCsvField(row.sourceLocale),
        escapeCsvField(row.sourceValue),
        escapeCsvField(row.targetLocale),
        escapeCsvField(row.translatedValue),
      ].join(','));
    }
    const csvContent = csvLines.join('\n') + '\n';

    // Write CSV file
    const resolvedPath = path.resolve(process.cwd(), exportPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, csvContent, 'utf8');

    console.log(chalk.green(`✓ Exported ${rows.length} missing translation(s) to ${exportPath}`));
    console.log(chalk.gray(`  Source locale: ${plan.sourceLocale}`));
    console.log(chalk.gray(`  Target locales: ${plan.locales.map(l => l.locale).join(', ')}`));
    console.log(chalk.gray('\nFill in the "translatedValue" column and import with:'));
    console.log(chalk.cyan(`  i18nsmith translate --import ${exportPath} --write`));
  } catch (error) {
    console.error(chalk.red('Export failed:'), (error as Error).message);
    process.exitCode = 1;
  }
}

async function handleCsvImport(options: TranslateCommandOptions): Promise<void> {
  const importPath = options.import!;
  const dryRun = !options.write;
  console.log(chalk.blue(`${dryRun ? 'Previewing' : 'Importing'} translations from ${importPath}...`));

  try {
    const config = await loadConfig(options.config);
    const translationService = new TranslationService(config);
    const placeholderValidator = new PlaceholderValidator(
      config.sync?.placeholderFormats?.length ? config.sync.placeholderFormats : DEFAULT_PLACEHOLDER_FORMATS
    );

    // Read and parse CSV
    const resolvedPath = path.resolve(process.cwd(), importPath);
    let csvContent: string;
    try {
      csvContent = await fs.readFile(resolvedPath, 'utf8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        throw new Error(`CSV file not found: ${resolvedPath}`);
      }
      throw error;
    }

    const lines = csvContent.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows.');
    }

    // Parse header
    const headerFields = parseCsvLine(lines[0]);
    const keyIdx = headerFields.indexOf('key');
    const sourceLocaleIdx = headerFields.indexOf('sourceLocale');
    const sourceValueIdx = headerFields.indexOf('sourceValue');
    const targetLocaleIdx = headerFields.indexOf('targetLocale');
    const translatedValueIdx = headerFields.indexOf('translatedValue');

    if (keyIdx === -1 || targetLocaleIdx === -1 || translatedValueIdx === -1) {
      throw new Error('CSV must have columns: key, targetLocale, translatedValue');
    }

    // Parse data rows
    const updates = new Map<string, { key: string; value: string }[]>();
    const placeholderIssues: { key: string; locale: string; issue: string }[] = [];
    let skipped = 0;
    let total = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      const key = fields[keyIdx]?.trim();
      const targetLocale = fields[targetLocaleIdx]?.trim();
      const translatedValue = fields[translatedValueIdx]?.trim();
      const sourceValue = sourceValueIdx >= 0 ? fields[sourceValueIdx]?.trim() : undefined;

      if (!key || !targetLocale) {
        skipped++;
        continue;
      }

      total++;

      if (!translatedValue) {
        skipped++;
        continue;
      }

      // Validate placeholders if we have source value
      if (sourceValue) {
        const comparison = placeholderValidator.compare(sourceValue, translatedValue);
        if (comparison.missing.length > 0) {
          placeholderIssues.push({
            key,
            locale: targetLocale,
            issue: `Missing placeholders: ${comparison.missing.join(', ')}`,
          });
          if (options.strictPlaceholders) {
            skipped++;
            continue;
          }
        }
        if (comparison.extra.length > 0) {
          placeholderIssues.push({
            key,
            locale: targetLocale,
            issue: `Extra placeholders: ${comparison.extra.join(', ')}`,
          });
        }
      }

      if (!updates.has(targetLocale)) {
        updates.set(targetLocale, []);
      }
      updates.get(targetLocale)!.push({ key, value: translatedValue });
    }

    // Print summary
    const totalUpdates = Array.from(updates.values()).reduce((sum, arr) => sum + arr.length, 0);
    console.log(chalk.green(`Parsed ${total} row(s): ${totalUpdates} with translations, ${skipped} skipped (empty)`));

    if (placeholderIssues.length > 0) {
      console.log(chalk.yellow(`\n⚠️  ${placeholderIssues.length} placeholder issue(s):`));
      for (const issue of placeholderIssues.slice(0, 10)) {
        console.log(chalk.yellow(`  • ${issue.key} (${issue.locale}): ${issue.issue}`));
      }
      if (placeholderIssues.length > 10) {
        console.log(chalk.gray(`  ... and ${placeholderIssues.length - 10} more`));
      }
    }

    if (options.strictPlaceholders && placeholderIssues.length > 0) {
      console.error(chalk.red('\n✗ Aborting due to placeholder issues (--strict-placeholders mode)'));
      process.exitCode = 1;
      return;
    }

    if (totalUpdates === 0) {
      console.log(chalk.yellow('No translations to import. Fill in the "translatedValue" column.'));
      return;
    }

    // Apply updates
    if (dryRun) {
      console.log(chalk.blue('\nDry-run preview:'));
      for (const [locale, localeUpdates] of updates) {
        console.log(`  • ${locale}: ${localeUpdates.length} translation(s)`);
      }
      console.log(chalk.cyan('\n📋 DRY RUN - No files were modified'));
      console.log(chalk.yellow('Run again with --write to apply changes.'));
    } else {
      for (const [locale, localeUpdates] of updates) {
        const result = await translationService.writeTranslations(locale, localeUpdates, {
          overwrite: options.force ?? false,
          skipEmpty: options.skipEmpty !== false,
        });
        console.log(`  • ${locale}: ${result.written} written, ${result.skipped} skipped`);
      }

      const stats = await translationService.flush();
      console.log(chalk.green(`\n✓ Imported translations from ${importPath}`));
      for (const stat of stats) {
        console.log(chalk.gray(`  ${stat.locale}: ${stat.added.length} added, ${stat.updated.length} updated`));
      }
    }

    // Write report if requested
    if (options.report) {
      const report = {
        source: importPath,
        dryRun,
        totalRows: total,
        skipped,
        updates: Object.fromEntries(
          Array.from(updates.entries()).map(([locale, arr]) => [locale, arr.length])
        ),
        placeholderIssues,
      };
      const outputPath = path.resolve(process.cwd(), options.report);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
      console.log(chalk.green(`Import report written to ${options.report}`));
    }
  } catch (error) {
    console.error(chalk.red('Import failed:'), (error as Error).message);
    process.exitCode = 1;
  }
}
