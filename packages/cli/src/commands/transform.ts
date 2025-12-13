import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfigWithMeta } from '@i18nsmith/core';
import { Transformer } from '@i18nsmith/transformer';
import type { TransformProgress, TransformSummary } from '@i18nsmith/transformer';
import { printLocaleDiffs, writeLocaleDiffPatches } from '../utils/diff-utils.js';
import { applyPreviewFile, writePreviewFile } from '../utils/preview.js';

interface TransformOptions {
  config?: string;
  json?: boolean;
  target?: string[];
  report?: string;
  write?: boolean;
  check?: boolean;
  diff?: boolean;
  patchDir?: string;
  migrateTextKeys?: boolean;
  previewOutput?: string;
  applyPreview?: string;
}

const collectTargetPatterns = (value: string | string[], previous: string[]) => {
  const list = Array.isArray(value) ? value : [value];
  const tokens = list
    .flatMap((entry) => entry.split(','))
    .map((token) => token.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
};

function printTransformSummary(summary: TransformSummary) {
  const counts = summary.candidates.reduce(
    (acc, c) => {
      acc.total += 1;
      if (c.status === 'applied') acc.applied += 1;
      else if (c.status === 'pending') acc.pending += 1;
      else if (c.status === 'duplicate') acc.duplicate += 1;
      else if (c.status === 'existing') acc.existing += 1;
      else if (c.status === 'skipped') acc.skipped += 1;
      return acc;
    },
    { total: 0, applied: 0, pending: 0, duplicate: 0, existing: 0, skipped: 0 }
  );

  console.log(
    chalk.green(
      `Scanned ${summary.filesScanned} file${summary.filesScanned === 1 ? '' : 's'}; ` +
        `${counts.total} candidate${counts.total === 1 ? '' : 's'} found ` +
        `(applied: ${counts.applied}, pending: ${counts.pending}, duplicates: ${counts.duplicate}, existing: ${counts.existing}, skipped: ${counts.skipped}).`
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

  const pending = summary.candidates.filter((candidate) => candidate.status === 'pending').length;
  if (pending > 0) {
    console.log(
      chalk.yellow(
        `\n${pending} candidate${pending === 1 ? '' : 's'} still pending. ` +
          `This can happen when candidates are filtered for safety (e.g., not in a React scope). ` +
          `Re-run with --write after reviewing skipped reasons if you want to keep iterating.`
      )
    );
  }

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

function createProgressLogger() {
  let lastPercent = -1;
  let lastLogTime = 0;
  let pendingCarriageReturn = false;

  const writeLine = (line: string, final = false) => {
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${line}`);
      pendingCarriageReturn = !final;
      if (final) {
        process.stdout.write('\n');
      }
    } else {
      console.log(line);
    }
  };

  return {
    emit(progress: TransformProgress) {
      if (progress.stage !== 'apply' || progress.total === 0) {
        return;
      }

      const now = Date.now();
      const shouldLog =
        progress.processed === progress.total ||
        progress.percent === 0 ||
        progress.percent >= lastPercent + 2 ||
        now - lastLogTime > 1500;

      if (!shouldLog) {
        return;
      }

      lastPercent = progress.percent;
      lastLogTime = now;
      const line =
        `Applying transforms ${progress.processed}/${progress.total} (${progress.percent}%)` +
        ` | applied: ${progress.applied ?? 0}` +
        ` | skipped: ${progress.skipped ?? 0}` +
        (progress.errors ? ` | errors: ${progress.errors}` : '') +
        ` | remaining: ${progress.remaining ?? progress.total - progress.processed}`;
      writeLine(line, progress.processed === progress.total);
    },
    flush() {
      if (pendingCarriageReturn && process.stdout.isTTY) {
        process.stdout.write('\n');
        pendingCarriageReturn = false;
      }
    },
  };
}

export function registerTransform(program: Command) {
  program
    .command('transform')
    .description('Scan project and apply i18n transformations')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
    .option('--write', 'Write changes to disk (defaults to dry-run)', false)
    .option('--check', 'Exit with error code if changes are needed', false)
    .option('--diff', 'Display unified diffs for locale files that would change', false)
    .option('--patch-dir <path>', 'Write locale diffs to .patch files in the specified directory')
    .option('--target <pattern...>', 'Limit scanning to specific files or glob patterns', collectTargetPatterns, [])
    .option('--migrate-text-keys', 'Migrate existing t("Text") calls to structured keys')
    .option('--preview-output <path>', 'Write preview summary (JSON) to a file (implies dry-run)')
    .option('--apply-preview <path>', 'Apply a previously saved transform preview JSON file safely')
    .action(async (options: TransformOptions) => {
      if (options.applyPreview) {
        await applyPreviewFile('transform', options.applyPreview);
        return;
      }

      const diffEnabled = Boolean(options.diff || options.patchDir);
      const previewMode = Boolean(options.previewOutput);
      const diffRequested = diffEnabled || previewMode;
      const writeEnabled = Boolean(options.write) && !previewMode;

      if (previewMode && options.write) {
        console.log(chalk.yellow('Preview requested; ignoring --write and running in dry-run mode.'));
      }
      options.write = writeEnabled;

      const banner = previewMode
        ? 'Generating transform preview...'
        : writeEnabled
        ? 'Running transform (write mode)...'
        : 'Planning transform (dry-run)...';
      console.log(chalk.blue(banner));

      try {
        const { config, projectRoot, configPath } = await loadConfigWithMeta(options.config);
        
        // Inform user if config was found in a parent directory
        const cwd = process.cwd();
        if (projectRoot !== cwd) {
          console.log(chalk.gray(`Config found at ${path.relative(cwd, configPath)}`));
          console.log(chalk.gray(`Using project root: ${projectRoot}\n`));
        }
        
        const transformer = new Transformer(config, { workspaceRoot: projectRoot });
        const progressLogger = createProgressLogger();
        const summary = await transformer.run({
          write: options.write,
          targets: options.target,
          diff: diffRequested,
          migrateTextKeys: options.migrateTextKeys,
          onProgress: progressLogger.emit,
        });
        progressLogger.flush();

        if (previewMode && options.previewOutput) {
          const savedPath = await writePreviewFile('transform', summary, options.previewOutput);
          console.log(chalk.green(`Preview written to ${path.relative(process.cwd(), savedPath)}`));
        }

        if (options.report) {
          const outputPath = path.resolve(process.cwd(), options.report);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
          console.log(chalk.green(`Transform report written to ${outputPath}`));
        }

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }

        printTransformSummary(summary);

        if (diffEnabled) {
          printLocaleDiffs(summary.diffs);
        }
        if (options.patchDir) {
          await writeLocaleDiffPatches(summary.diffs, options.patchDir);
        }

        if (options.check && summary.candidates.some((candidate) => candidate.status === 'pending')) {
          console.error(chalk.red('\nCheck failed: Pending translations found. Run with --write to fix.'));
          process.exitCode = 1;
          return;
        }

        if (!options.write && summary.candidates.some((candidate) => candidate.status === 'pending')) {
          console.log(chalk.cyan('\n📋 DRY RUN - No files were modified'));
          console.log(chalk.yellow('Run again with --write to apply these changes.'));
        }
      } catch (error) {
        const errorMessage = (error as Error).message;
        if (options.json) {
          console.log(JSON.stringify({ ok: false, error: { message: errorMessage } }, null, 2));
        } else {
          console.error(chalk.red('Transform failed:'), errorMessage);
        }
        process.exitCode = 1;
      }
    });
}
