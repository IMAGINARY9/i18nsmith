import { Command } from 'commander';
import chalk from 'chalk';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { loadConfig, KeyRenamer, type KeyRenameSummary, type KeyRenameBatchSummary, type KeyRenameMapping } from '@i18nsmith/core';
import { applyPreviewFile, writePreviewFile } from '../utils/preview.js';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface ScanOptions {
  config: string;
  json?: boolean;
  report?: string;
}

interface RenameKeyOptions extends ScanOptions {
  write?: boolean;
  diff?: boolean;
  previewOutput?: string;
  applyPreview?: string;
}

interface RenameMapOptions extends ScanOptions {
  map: string;
  write?: boolean;
  diff?: boolean;
}

/**
 * Registers rename-related commands (rename-key, rename-keys)
 */
export function registerRename(program: Command): void {
  program
    .command('rename-key')
    .description('Rename translation keys across source files and locale JSON')
    .argument('<oldKey>', 'Existing translation key')
    .argument('<newKey>', 'Replacement translation key')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
    .option('--write', 'Write changes to disk (defaults to dry-run)', false)
    .option('--diff', 'Display unified diffs for files that would change', false)
    .option('--preview-output <path>', 'Write preview summary (JSON) to a file (implies dry-run)')
    .option('--apply-preview <path>', 'Apply a previously saved rename preview JSON file safely')
    .action(
      withErrorHandling(async (oldKey: string, newKey: string, options: RenameKeyOptions) => {
        if (options.applyPreview) {
          await applyPreviewFile('rename-key', options.applyPreview);
          return;
        }

        const previewMode = Boolean(options.previewOutput);
        const writeEnabled = Boolean(options.write) && !previewMode;
        if (previewMode && options.write) {
          console.log(chalk.yellow('Preview requested; ignoring --write and running in dry-run mode.'));
        }
        options.write = writeEnabled;

        console.log(chalk.blue(writeEnabled ? 'Renaming translation key...' : 'Planning key rename (dry-run)...'));

        try {
          const config = await loadConfig(options.config);
          const renamer = new KeyRenamer(config);
          const summary = await renamer.rename(oldKey, newKey, {
            write: options.write,
            diff: options.diff || previewMode,
          });

          if (previewMode && options.previewOutput) {
            const savedPath = await writePreviewFile('rename-key', summary, options.previewOutput);
            console.log(chalk.green(`Preview written to ${path.relative(process.cwd(), savedPath)}`));
            return;
          }

          if (options.report) {
            const outputPath = path.resolve(process.cwd(), options.report);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
            console.log(chalk.green(`Rename report written to ${outputPath}`));
          }

          if (options.json) {
            console.log(JSON.stringify(summary, null, 2));
            return;
          }

          printRenameSummary(summary);

          if (!options.write) {
            console.log(chalk.cyan('\n📋 DRY RUN - No files were modified'));
            console.log(chalk.yellow('Run again with --write to apply changes.'));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Rename failed: ${message}`);
        }
      })
    );

  program
    .command('rename-keys')
    .description('Rename multiple translation keys using a mapping file')
    .requiredOption('-m, --map <path>', 'Path to JSON map file (object or array of {"from","to"})')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
    .option('--write', 'Write changes to disk (defaults to dry-run)', false)
    .option('--diff', 'Display unified diffs for files that would change', false)
    .action(
      withErrorHandling(async (options: RenameMapOptions) => {
        console.log(
          chalk.blue(options.write ? 'Renaming translation keys from map...' : 'Planning batch rename (dry-run)...')
        );

        try {
          const config = await loadConfig(options.config);
          const mappings = await loadRenameMappings(options.map);
          const renamer = new KeyRenamer(config);
          const summary = await renamer.renameBatch(mappings, { write: options.write, diff: options.diff });

          if (options.report) {
            const outputPath = path.resolve(process.cwd(), options.report);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
            console.log(chalk.green(`Batch rename report written to ${outputPath}`));
          }

          if (options.json) {
            console.log(JSON.stringify(summary, null, 2));
            return;
          }

          printRenameBatchSummary(summary);

          // Print source file diffs if requested
          if (options.diff && summary.diffs.length > 0) {
            console.log(chalk.blue('\nSource file changes:'));
            for (const diff of summary.diffs) {
              console.log(chalk.cyan(`\n--- ${diff.relativePath} (${diff.changes} change${diff.changes === 1 ? '' : 's'}) ---`));
              console.log(diff.diff);
            }
          }

          if (!options.write) {
            console.log(chalk.cyan('\n📋 DRY RUN - No files were modified'));
            console.log(chalk.yellow('Run again with --write to apply changes.'));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Batch rename failed: ${message}`);
        }
      })
    );
}

function printRenameSummary(summary: KeyRenameSummary) {
  console.log(
    chalk.green(
      `Updated ${summary.occurrences} occurrence${summary.occurrences === 1 ? '' : 's'} across ${summary.filesUpdated.length} file${summary.filesUpdated.length === 1 ? '' : 's'}.`
    )
  );

  if (summary.filesUpdated.length) {
    console.log(chalk.blue('Files updated:'));
    summary.filesUpdated.forEach((file) => console.log(`  • ${file}`));
  }

  if (summary.localeStats.length) {
    console.log(chalk.blue('Locale updates:'));
    summary.localeStats.forEach((stat) => {
      console.log(
        `  • ${stat.locale}: ${stat.added.length} added, ${stat.updated.length} updated, ${stat.removed.length} removed (total ${stat.totalKeys})`
      );
    });
  } else if (summary.localePreview.length) {
    console.log(chalk.blue('Locale impact preview:'));
    summary.localePreview.forEach((preview) => {
      const status = preview.missing
        ? chalk.yellow('missing source key')
        : preview.duplicate
        ? chalk.red('destination already exists')
        : chalk.green('ready');
      console.log(`  • ${preview.locale}: ${status}`);
    });
  }

  if (summary.missingLocales.length) {
    console.log(
      chalk.yellow(
        `Locales missing the original key: ${summary.missingLocales.join(', ')}. Update them manually if needed.`
      )
    );
  }
}

function printRenameBatchSummary(summary: KeyRenameBatchSummary) {
  console.log(
    chalk.green(
      `Updated ${summary.occurrences} occurrence${summary.occurrences === 1 ? '' : 's'} across ${summary.filesUpdated.length} file${summary.filesUpdated.length === 1 ? '' : 's'}.`
    )
  );

  if (summary.mappingSummaries.length === 0) {
    console.log(chalk.yellow('No mappings were applied.'));
  } else {
    console.log(chalk.blue('Mappings:'));
    summary.mappingSummaries.slice(0, 50).forEach((mapping) => {
      const refLabel = `${mapping.occurrences} reference${mapping.occurrences === 1 ? '' : 's'}`;
      console.log(`  • ${mapping.from} → ${mapping.to} (${refLabel})`);

      const duplicates = mapping.localePreview
        .filter((preview) => preview.duplicate)
        .map((preview) => preview.locale);
      const missing = mapping.missingLocales;

      const annotations = [
        missing.length ? `missing locales: ${missing.join(', ')}` : null,
        duplicates.length ? `target already exists in: ${duplicates.join(', ')}` : null,
      ].filter(Boolean);

      if (annotations.length) {
        console.log(chalk.gray(`      ${annotations.join(' · ')}`));
      }
    });

    if (summary.mappingSummaries.length > 50) {
      console.log(chalk.gray(`  ...and ${summary.mappingSummaries.length - 50} more.`));
    }
  }

  if (summary.filesUpdated.length) {
    console.log(chalk.blue('Files updated:'));
    summary.filesUpdated.forEach((file) => console.log(`  • ${file}`));
  }

  if (summary.localeStats.length) {
    console.log(chalk.blue('Locale updates:'));
    summary.localeStats.forEach((stat) => {
      console.log(
        `  • ${stat.locale}: ${stat.added.length} added, ${stat.updated.length} updated, ${stat.removed.length} removed (total ${stat.totalKeys})`
      );
    });
  }
}

async function loadRenameMappings(mapPath: string): Promise<KeyRenameMapping[]> {
  if (!mapPath) {
    throw new Error('A path to the rename map is required.');
  }

  const resolvedPath = path.isAbsolute(mapPath) ? mapPath : path.resolve(process.cwd(), mapPath);
  let fileContents: string;

  try {
    fileContents = await fs.readFile(resolvedPath, 'utf8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Rename map not found at ${resolvedPath}.`);
    }
    throw new Error(`Unable to read rename map at ${resolvedPath}: ${err.message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(`Rename map contains invalid JSON: ${(error as Error).message}`);
  }

  const mappings = normalizeRenameMap(parsed);
  if (!mappings.length) {
    throw new Error('Rename map is empty. Provide at least one {"from": "foo", "to": "bar"} entry.');
  }

  return mappings;
}

function normalizeRenameMap(input: unknown): KeyRenameMapping[] {
  if (Array.isArray(input)) {
    return input
      .map((item) => {
        if (typeof item !== 'object' || item === null) {
          return undefined;
        }
        const from = 'from' in item ? String((item as Record<string, unknown>).from ?? '') : '';
        const to = 'to' in item ? String((item as Record<string, unknown>).to ?? '') : '';
        return { from: from.trim(), to: to.trim() };
      })
      .filter((entry): entry is KeyRenameMapping =>
        Boolean(entry && entry.from && entry.to && entry.from !== entry.to)
      );
  }

  if (input && typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>)
      .map(([from, to]) => ({ from: from.trim(), to: typeof to === 'string' ? to.trim() : '' }))
      .filter((entry) => Boolean(entry.from) && Boolean(entry.to) && entry.from !== entry.to);
  }

  throw new Error('Rename map must be either an object ("old":"new") or an array of {"from","to"}.');
}
