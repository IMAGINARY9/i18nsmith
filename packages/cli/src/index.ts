#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';
import {
  loadConfig,
  Scanner,
  ScanCandidate,
  SyncSummary,
  Syncer,
  KeyRenamer,
  KeyRenameSummary,
} from '@i18nsmith/core';
import { TransformSummary, Transformer } from '@i18nsmith/transformer';
import { registerInit } from './commands/init';
import { registerScaffoldAdapter } from './commands/scaffold-adapter';

interface ScanOptions {
  config?: string;
  json?: boolean;
}

interface SyncCommandOptions extends ScanOptions {
  write?: boolean;
  check?: boolean;
  validateInterpolations?: boolean;
  emptyValues?: boolean;
  assume?: string[];
}

const program = new Command();

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
  .action(async (options: ScanOptions & { write?: boolean; check?: boolean }) => {
    console.log(
      chalk.blue(options.write ? 'Running transform (write mode)...' : 'Planning transform (dry-run)...')
    );

    try {
      const config = await loadConfig(options.config);
      const transformer = new Transformer(config);
      const summary = await transformer.run({ write: options.write });

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

const collectAssumedKeys = (value: string, previous: string[]) => {
  const tokens = value
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
};

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
  .action(async (options: SyncCommandOptions) => {
    console.log(chalk.blue(options.write ? 'Syncing locale files...' : 'Checking locale drift...'));

    try {
      const config = await loadConfig(options.config);
      const syncer = new Syncer(config);
      const summary = await syncer.run({
        write: options.write,
        validateInterpolations: options.validateInterpolations,
        emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
        assumedKeys: options.assume,
      });

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      printSyncSummary(summary);

      const shouldFailPlaceholders = summary.validation.interpolations && summary.placeholderIssues.length > 0;
      const shouldFailEmptyValues =
        summary.validation.emptyValuePolicy === 'fail' && summary.emptyValueViolations.length > 0;

      if (
        options.check &&
        (summary.missingKeys.length || summary.unusedKeys.length || shouldFailPlaceholders || shouldFailEmptyValues)
      ) {
        console.error(chalk.red('\nDrift detected. Run with --write to fix.'));
        process.exitCode = 1;
        return;
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

program.parse();
