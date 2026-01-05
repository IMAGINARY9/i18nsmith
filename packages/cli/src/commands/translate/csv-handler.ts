/**
 * CSV export/import utilities for translator handoff
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import {
  DEFAULT_PLACEHOLDER_FORMATS,
  PlaceholderValidator,
  loadConfig,
  TranslationService,
} from '@i18nsmith/core';
import type { TranslateCommandOptions, CsvRow } from './types.js';

/**
 * Escape a field for CSV output
 */
export function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Parse a CSV line into fields (handles quoted fields with commas and escaped quotes)
 */
export function parseCsvLine(line: string): string[] {
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

/**
 * Export missing translations to a CSV file for external translation
 */
export async function handleCsvExport(options: TranslateCommandOptions): Promise<void> {
  const exportPath = options.export!;
  console.log(chalk.blue(`Exporting missing translations to ${exportPath}...`));

  try {
    const config = await loadConfig(options.config);
    const translationService = new TranslationService(config);
    const plan = await translationService.buildPlan({
      locales: options.locales,
      force: options.force,
      // Export should represent what the UI calls "missing" (usually includes empty strings)
      treatEmptyAsMissing: true,
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
          targetValue: '',
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
        escapeCsvField(row.targetValue),
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

/**
 * Import translations from a CSV file and merge into locale files
 */
export async function handleCsvImport(options: TranslateCommandOptions): Promise<void> {
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
