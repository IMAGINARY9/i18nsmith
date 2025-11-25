#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import type { CheckboxQuestion } from 'inquirer';
import {
  loadConfig,
  Scanner,
  ScanCandidate,
  SyncSummary,
  Syncer,
  KeyRenamer,
  KeyRenameSummary,
  KeyRenameBatchSummary,
  KeyRenameMapping,
} from '@i18nsmith/core';
import { TransformSummary, Transformer } from '@i18nsmith/transformer';
import { registerInit } from './commands/init';
import { registerScaffoldAdapter } from './commands/scaffold-adapter';
import { printLocaleDiffs, writeLocaleDiffPatches } from './utils/diff-utils';

interface ScanOptions {
  config?: string;
  json?: boolean;
  target?: string[];
}

interface RenameMapOptions extends ScanOptions {
  map: string;
  write?: boolean;
}

interface SyncCommandOptions extends ScanOptions {
  write?: boolean;
  check?: boolean;
  validateInterpolations?: boolean;
  emptyValues?: boolean;
  assume?: string[];
  interactive?: boolean;
  diff?: boolean;
  patchDir?: string;
  invalidateCache?: boolean;
}

const program = new Command();

const SYNC_EXIT_CODES = {
  DRIFT: 1,
  PLACEHOLDER_MISMATCH: 2,
  EMPTY_VALUES: 3,
} as const;

const collectAssumedKeys = (value: string, previous: string[]) => {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
};

const collectTargetPatterns = (value: string | string[], previous: string[]) => {
  const list = Array.isArray(value) ? value : [value];
  const tokens = list
    .flatMap((entry) => entry.split(','))
    .map((token) => token.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
};



program
  .name('i18nsmith')
  .description('Universal Automated i18n Library')
  .version('0.1.0');

registerInit(program);
registerScaffoldAdapter(program);

program
  .command('scan')
  .description('Scan project for strings to translate')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .action(async (options: ScanOptions) => {
    console.log(chalk.blue('Starting scan...'));

    try {
      const config = await loadConfig(options.config);
      const scanner = new Scanner(config);
      const summary = scanner.scan();

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(
        chalk.green(
          `Scanned ${summary.filesScanned} file${summary.filesScanned === 1 ? '' : 's'} and found ${summary.candidates.length} candidate${summary.candidates.length === 1 ? '' : 's'}.`
        )
      );

      if (summary.candidates.length === 0) {
        console.log(chalk.yellow('No translatable strings found.'));
        return;
      }

      printCandidateTable(summary.candidates);
    } catch (error) {
      console.error(chalk.red('Scan failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

function printCandidateTable(candidates: ScanCandidate[]) {
  const preview = candidates.slice(0, 50).map((candidate) => ({
    File: candidate.filePath,
    Line: candidate.position.line,
    Column: candidate.position.column,
    Kind: candidate.kind,
    Context: candidate.context ?? '',
    Text:
      candidate.text.length > 60
        ? `${candidate.text.slice(0, 57)}...`
        : candidate.text,
  }));

  console.table(preview);

  if (candidates.length > 50) {
    console.log(chalk.gray(`Showing first 50 of ${candidates.length} candidates.`));
  }
}

program
  .command('transform')
  .description('Scan project and apply i18n transformations')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--write', 'Write changes to disk (defaults to dry-run)', false)
  .option('--check', 'Exit with error code if changes are needed', false)
  .option('--target <pattern...>', 'Limit scanning to specific files or glob patterns', collectTargetPatterns, [])
  .action(async (options: ScanOptions & { write?: boolean; check?: boolean }) => {
    console.log(
      chalk.blue(options.write ? 'Running transform (write mode)...' : 'Planning transform (dry-run)...')
    );

    try {
      const config = await loadConfig(options.config);
      const transformer = new Transformer(config);
  const summary = await transformer.run({ write: options.write, targets: options.target });

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      printTransformSummary(summary);

      if (options.check && summary.candidates.some((candidate) => candidate.status === 'pending')) {
        console.error(chalk.red('\nCheck failed: Pending translations found. Run with --write to fix.'));
        process.exitCode = 1;
        return;
      }

      if (!options.write && summary.candidates.some((candidate) => candidate.status === 'pending')) {
        console.log(chalk.yellow('Run again with --write to apply these changes.'));
      }
    } catch (error) {
      console.error(chalk.red('Transform failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

function printTransformSummary(summary: TransformSummary) {
  console.log(
    chalk.green(
      `Scanned ${summary.filesScanned} file${summary.filesScanned === 1 ? '' : 's'}; ` +
        `${summary.candidates.length} candidate${summary.candidates.length === 1 ? '' : 's'} processed.`
    )
  );

  const preview = summary.candidates.slice(0, 50).map((candidate) => ({
    File: candidate.filePath,
    Line: candidate.position.line,
    Kind: candidate.kind,
    Status: candidate.status,
    Key: candidate.suggestedKey,
    Preview:
      candidate.text.length > 40
        ? `${candidate.text.slice(0, 37)}...`
        : candidate.text,
  }));

  console.table(preview);

  if (summary.filesChanged.length) {
    console.log(chalk.blue(`Files changed (${summary.filesChanged.length}):`));
    summary.filesChanged.forEach((file) => console.log(`  • ${file}`));
  }

  if (summary.localeStats.length) {
    console.log(chalk.blue('Locale updates:'));
    summary.localeStats.forEach((stat) => {
      console.log(
        `  • ${stat.locale}: ${stat.added.length} added, ${stat.updated.length} updated, ${stat.removed.length} removed (total ${stat.totalKeys})`
      );
    });
  }

  if (summary.skippedFiles.length) {
    console.log(chalk.yellow('Skipped items:'));
    summary.skippedFiles.forEach((item) => console.log(`  • ${item.filePath}: ${item.reason}`));
  }
}
program
  .command('sync')
  .description('Detect missing locale keys and prune unused entries')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--write', 'Write changes to disk (defaults to dry-run)', false)
  .option('--check', 'Exit with error code if drift detected', false)
  .option('--validate-interpolations', 'Validate interpolation placeholders across locales', false)
  .option('--no-empty-values', 'Treat empty or placeholder locale values as failures')
  .option('--assume <keys...>', 'List of runtime keys to assume present (comma-separated)', collectAssumedKeys, [])
  .option('--interactive', 'Interactively approve locale mutations before writing', false)
  .option('--diff', 'Display unified diffs for locale files that would change', false)
  .option('--patch-dir <path>', 'Write locale diffs to .patch files in the specified directory')
  .option('--invalidate-cache', 'Ignore cached sync analysis and rescan all source files', false)
  .option('--target <pattern...>', 'Limit translation reference scanning to specific files or glob patterns', collectTargetPatterns, [])
  .action(async (options: SyncCommandOptions) => {
    const interactive = Boolean(options.interactive);
    const diffEnabled = Boolean(options.diff || options.patchDir);
    const invalidateCache = Boolean(options.invalidateCache);
    const diffRequested = diffEnabled || Boolean(options.json);
    if (interactive && options.json) {
      console.error(chalk.red('--interactive cannot be combined with --json output.'));
      process.exitCode = 1;
      return;
    }

    console.log(
      chalk.blue(
        interactive
          ? 'Interactive sync (dry-run first)...'
          : options.write
          ? 'Syncing locale files...'
          : 'Checking locale drift...'
      )
    );

    try {
      const config = await loadConfig(options.config);
      const syncer = new Syncer(config);
      if (interactive) {
        await runInteractiveSync(syncer, { ...options, diff: diffEnabled, invalidateCache });
        return;
      }

      const summary = await syncer.run({
        write: options.write,
        validateInterpolations: options.validateInterpolations,
        emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
        assumedKeys: options.assume,
        diff: diffRequested,
        invalidateCache,
        targets: options.target,
      });

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      printSyncSummary(summary);
      if (diffEnabled) {
        printLocaleDiffs(summary.diffs);
      }
      if (options.patchDir) {
        await writeLocaleDiffPatches(summary.diffs, options.patchDir);
      }

      const shouldFailPlaceholders = summary.validation.interpolations && summary.placeholderIssues.length > 0;
      const shouldFailEmptyValues =
        summary.validation.emptyValuePolicy === 'fail' && summary.emptyValueViolations.length > 0;

      if (options.check) {
        const hasDrift = summary.missingKeys.length || summary.unusedKeys.length;
        if (shouldFailPlaceholders) {
          console.error(chalk.red('\nPlaceholder mismatches detected. Run with --write to fix.'));
          process.exitCode = SYNC_EXIT_CODES.PLACEHOLDER_MISMATCH;
          return;
        }
        if (shouldFailEmptyValues) {
          console.error(chalk.red('\nEmpty locale values detected. Run with --write to fix.'));
          process.exitCode = SYNC_EXIT_CODES.EMPTY_VALUES;
          return;
        }
        if (hasDrift) {
          console.error(chalk.red('\nDrift detected. Run with --write to fix.'));
          process.exitCode = SYNC_EXIT_CODES.DRIFT;
          return;
        }
      }

      if (!options.write && (summary.missingKeys.length || summary.unusedKeys.length)) {
        console.log(chalk.yellow('Run again with --write to apply fixes.'));
      }
    } catch (error) {
      console.error(chalk.red('Sync failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

function printSyncSummary(summary: SyncSummary) {
  console.log(
    chalk.green(
      `Scanned ${summary.filesScanned} file${summary.filesScanned === 1 ? '' : 's'}; ` +
        `${summary.references.length} translation reference${summary.references.length === 1 ? '' : 's'} found.`
    )
  );

  if (summary.missingKeys.length) {
    console.log(chalk.red('Missing keys:'));
    summary.missingKeys.slice(0, 50).forEach((item) => {
      const sample = item.references[0];
      const location = sample ? `${sample.filePath}:${sample.position.line}` : 'n/a';
      console.log(`  • ${item.key} (${item.references.length} reference${item.references.length === 1 ? '' : 's'} — e.g., ${location})`);
    });
    if (summary.missingKeys.length > 50) {
      console.log(chalk.gray(`  ...and ${summary.missingKeys.length - 50} more.`));
    }
  } else {
    console.log(chalk.green('No missing keys detected.'));
  }

  if (summary.unusedKeys.length) {
    console.log(chalk.yellow('Unused locale keys:'));
    summary.unusedKeys.slice(0, 50).forEach((item) => {
      console.log(`  • ${item.key} (${item.locales.join(', ')})`);
    });
    if (summary.unusedKeys.length > 50) {
      console.log(chalk.gray(`  ...and ${summary.unusedKeys.length - 50} more.`));
    }
  } else {
    console.log(chalk.green('No unused locale keys detected.'));
  }

  if (summary.validation.interpolations) {
    if (summary.placeholderIssues.length) {
      console.log(chalk.yellow('Placeholder mismatches:'));
      summary.placeholderIssues.slice(0, 50).forEach((issue) => {
        const missing = issue.missing.length ? `missing [${issue.missing.join(', ')}]` : '';
        const extra = issue.extra.length ? `extra [${issue.extra.join(', ')}]` : '';
        const detail = [missing, extra].filter(Boolean).join('; ');
        console.log(`  • ${issue.key} (${issue.locale}) ${detail}`);
      });
      if (summary.placeholderIssues.length > 50) {
        console.log(chalk.gray(`  ...and ${summary.placeholderIssues.length - 50} more.`));
      }
    } else {
      console.log(chalk.green('No placeholder mismatches detected.'));
    }
  }

  if (summary.validation.emptyValuePolicy !== 'ignore') {
    if (summary.emptyValueViolations.length) {
      const label =
        summary.validation.emptyValuePolicy === 'fail'
          ? chalk.red('Empty locale values:')
          : chalk.yellow('Empty locale values:');
      console.log(label);
      summary.emptyValueViolations.slice(0, 50).forEach((violation) => {
        console.log(`  • ${violation.key} (${violation.locale}) — ${violation.reason}`);
      });
      if (summary.emptyValueViolations.length > 50) {
        console.log(chalk.gray(`  ...and ${summary.emptyValueViolations.length - 50} more.`));
      }
    } else {
      console.log(chalk.green('No empty locale values detected.'));
    }
  }

  if (summary.dynamicKeyWarnings.length) {
    console.log(chalk.yellow('Dynamic translation keys detected:'));
    summary.dynamicKeyWarnings.slice(0, 50).forEach((warning) => {
      console.log(
        `  • ${warning.filePath}:${warning.position.line} (${warning.reason}) ${chalk.gray(warning.expression)}`
      );
    });
    if (summary.dynamicKeyWarnings.length > 50) {
      console.log(chalk.gray(`  ...and ${summary.dynamicKeyWarnings.length - 50} more.`));
    }
    if (summary.assumedKeys.length) {
      console.log(chalk.blue(`Assumed runtime keys: ${summary.assumedKeys.join(', ')}`));
    } else {
      console.log(
        chalk.gray(
          'Use --assume key1,key2 to prevent false positives for known runtime-only translation keys.'
        )
      );
    }
  }

  if (summary.localeStats.length) {
    console.log(chalk.blue('Locale file changes:'));
    summary.localeStats.forEach((stat) => {
      console.log(
        `  • ${stat.locale}: ${stat.added.length} added, ${stat.updated.length} updated, ${stat.removed.length} removed (total ${stat.totalKeys})`
      );
    });
  }

  if (!summary.write && summary.localePreview.length) {
    console.log(chalk.blue('Locale diff preview:'));
    summary.localePreview.forEach((stat) => {
      console.log(
        `  • ${stat.locale}: ${stat.add.length} to add, ${stat.remove.length} to remove`
      );
    });
  }
}

async function runInteractiveSync(syncer: Syncer, options: SyncCommandOptions) {
  const diffEnabled = Boolean(options.diff || options.patchDir);
  const invalidateCache = Boolean(options.invalidateCache);
  const baseline = await syncer.run({
    write: false,
    validateInterpolations: options.validateInterpolations,
    emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
    assumedKeys: options.assume,
    diff: diffEnabled,
    invalidateCache,
    targets: options.target,
  });

  printSyncSummary(baseline);
  if (diffEnabled) {
    printLocaleDiffs(baseline.diffs);
  }
  if (options.patchDir) {
    await writeLocaleDiffPatches(baseline.diffs, options.patchDir);
  }

  if (!baseline.missingKeys.length && !baseline.unusedKeys.length) {
    console.log(chalk.green('No drift detected. Nothing to apply.'));
    return;
  }

  const prompts: CheckboxQuestion[] = [];
  if (baseline.missingKeys.length) {
    prompts.push({
      type: 'checkbox',
      name: 'missing',
      message: 'Select missing keys to add',
      pageSize: 15,
      choices: baseline.missingKeys.map((item) => ({
        name: `${item.key} (${item.references.length} reference${item.references.length === 1 ? '' : 's'})`,
        value: item.key,
        checked: true,
      })),
    });
  }

  if (baseline.unusedKeys.length) {
    prompts.push({
      type: 'checkbox',
      name: 'unused',
      message: 'Select unused keys to prune',
      pageSize: 15,
      choices: baseline.unusedKeys.map((item) => ({
        name: `${item.key} (${item.locales.join(', ')})`,
        value: item.key,
        checked: true,
      })),
    });
  }

  const answers = prompts.length ? await inquirer.prompt(prompts) : {};
  const selectedMissing: string[] = (answers as { missing?: string[] }).missing ?? [];
  const selectedUnused: string[] = (answers as { unused?: string[] }).unused ?? [];

  if (!selectedMissing.length && !selectedUnused.length) {
    console.log(chalk.yellow('No changes selected. Run again later if needed.'));
    return;
  }

  const confirmation = await inquirer.prompt<{ proceed: boolean }>([
    {
      type: 'confirm',
      name: 'proceed',
      default: true,
      message: `Apply ${selectedMissing.length} addition${selectedMissing.length === 1 ? '' : 's'} and ${selectedUnused.length} removal${selectedUnused.length === 1 ? '' : 's'}?`,
    },
  ]);

  if (!confirmation.proceed) {
    console.log(chalk.yellow('Aborted. No changes written.'));
    return;
  }

  const writeSummary = await syncer.run({
    write: true,
    validateInterpolations: options.validateInterpolations,
    emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
    assumedKeys: options.assume,
    selection: {
      missing: selectedMissing,
      unused: selectedUnused,
    },
    diff: diffEnabled,
    targets: options.target,
  });

  printSyncSummary(writeSummary);
  if (diffEnabled) {
    printLocaleDiffs(writeSummary.diffs);
  }
  if (options.patchDir) {
    await writeLocaleDiffPatches(writeSummary.diffs, options.patchDir);
  }
}

program
  .command('rename-key')
  .description('Rename translation keys across source files and locale JSON')
  .argument('<oldKey>', 'Existing translation key')
  .argument('<newKey>', 'Replacement translation key')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--write', 'Write changes to disk (defaults to dry-run)', false)
  .action(async (oldKey: string, newKey: string, options: ScanOptions & { write?: boolean }) => {
    console.log(chalk.blue(options.write ? 'Renaming translation key...' : 'Planning key rename (dry-run)...'));

    try {
      const config = await loadConfig(options.config);
      const renamer = new KeyRenamer(config);
      const summary = await renamer.rename(oldKey, newKey, { write: options.write });

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      printRenameSummary(summary);

      if (!options.write) {
        console.log(chalk.yellow('Run again with --write to apply changes.'));
      }
    } catch (error) {
      console.error(chalk.red('Rename failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('rename-keys')
  .description('Rename multiple translation keys using a mapping file')
  .requiredOption('-m, --map <path>', 'Path to JSON map file (object or array of {"from","to"})')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--write', 'Write changes to disk (defaults to dry-run)', false)
  .action(async (options: RenameMapOptions) => {
    console.log(
      chalk.blue(options.write ? 'Renaming translation keys from map...' : 'Planning batch rename (dry-run)...')
    );

    try {
      const config = await loadConfig(options.config);
      const mappings = await loadRenameMappings(options.map);
      const renamer = new KeyRenamer(config);
      const summary = await renamer.renameBatch(mappings, { write: options.write });

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      printRenameBatchSummary(summary);

      if (!options.write) {
        console.log(chalk.yellow('Run again with --write to apply changes.'));
      }
    } catch (error) {
      console.error(chalk.red('Batch rename failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

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

program.parse();
