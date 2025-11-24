#!/usr/bin/env node
import chalk from 'chalk';
import { Command } from 'commander';
import { Scanner, ScanCandidate } from '@i18nsmith/core';
import { TransformSummary, Transformer } from '@i18nsmith/transformer';
import { registerInitCommand } from './commands/init.js';
import { registerScaffoldAdapter } from './commands/scaffold-adapter.js';
import { loadConfig } from './utils/config.js';

interface ScanOptions {
  config?: string;
  json?: boolean;
}

const program = new Command();

program
  .name('i18nsmith')
  .description('Universal Automated i18n Library')
  .version('0.1.0');

registerInitCommand(program);
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
  .action(async (options: ScanOptions & { write?: boolean }) => {
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
        `  • ${stat.locale}: ${stat.added.length} added, ${stat.updated.length} updated (total ${stat.totalKeys})`
      );
    });
  }

  if (summary.skippedFiles.length) {
    console.log(chalk.yellow('Skipped items:'));
    summary.skippedFiles.forEach((item) => console.log(`  • ${item.filePath}: ${item.reason}`));
  }
}

program.parse();
