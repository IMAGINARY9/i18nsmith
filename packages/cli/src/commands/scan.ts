import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfigWithMeta, Scanner } from '@i18nsmith/core';
import type { ScanCandidate } from '@i18nsmith/core';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface ScanOptions {
  config?: string;
  json?: boolean;
  target?: string[];
  report?: string;
  listFiles?: boolean;
  include?: string[];
  exclude?: string[];
}

const collectTargetPatterns = (value: string | string[], previous: string[]) => {
  const list = Array.isArray(value) ? value : [value];
  const tokens = list
    .flatMap((entry) => entry.split(','))
    .map((token) => token.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
};

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

export function registerScan(program: Command) {
  program
    .command('scan')
    .description('Scan project for strings to translate')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
    .option('--list-files', 'List the files that were scanned', false)
    .option('--include <patterns...>', 'Override include globs from config (comma or space separated)', collectTargetPatterns, [])
    .option('--exclude <patterns...>', 'Override exclude globs from config (comma or space separated)', collectTargetPatterns, [])
    .action(
      withErrorHandling(async (options: ScanOptions) => {
        // When JSON output is requested, avoid human-readable preamble on stdout
        // so callers can reliably parse the JSON summary. Send banner to stderr
        // when --json is used.
        if (options.json) {
          console.error(chalk.blue('Starting scan...'));
        } else {
          console.log(chalk.blue('Starting scan...'));
        }

        try {
          const { config, projectRoot, configPath } = await loadConfigWithMeta(options.config);

          // Inform user if config was found in a parent directory
          const cwd = process.cwd();
          if (projectRoot !== cwd) {
            console.log(chalk.gray(`Config found at ${path.relative(cwd, configPath)}`));
            console.log(chalk.gray(`Using project root: ${projectRoot}\n`));
          }

          if (options.include?.length) {
            config.include = options.include;
          }
          if (options.exclude?.length) {
            config.exclude = options.exclude;
          }
          // Use factory that registers framework adapters (React/Vue) so
          // scans include files handled by adapters. Backwards compatible
          // API: Scanner.create will return a scanner with adapters wired.
          const scanner = await Scanner.create(config, { workspaceRoot: projectRoot });
          const summary = scanner.scan();

          if (options.report) {
            const outputPath = path.resolve(process.cwd(), options.report);
            await fs.mkdir(path.dirname(outputPath), { recursive: true });
            await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
            console.log(chalk.green(`Scan report written to ${outputPath}`));
          }

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

          if (options.listFiles) {
            if (summary.filesExamined.length === 0) {
              console.log(chalk.yellow('No files matched the configured include/exclude patterns.'));
            } else {
              console.log(chalk.blue(`Files scanned (${summary.filesExamined.length}):`));
              const preview = summary.filesExamined.slice(0, 200);
              preview.forEach((file) => console.log(`  • ${file}`));
              if (summary.filesExamined.length > preview.length) {
                console.log(
                  chalk.gray(
                    `  ...and ${summary.filesExamined.length - preview.length} more. Use --target to narrow the list.`
                  )
                );
              }
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Scan failed: ${message}`);
        }
      })
    );
}
