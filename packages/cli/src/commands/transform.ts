import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfigWithMeta } from '@i18nsmith/core';
import { Transformer } from '@i18nsmith/transformer';
import type { TransformProgress, TransformSummary } from '@i18nsmith/transformer';
import { printLocaleDiffs, writeLocaleDiffPatches } from '../utils/diff-utils.js';
import { applyPreviewFile, writePreviewFile } from '../utils/preview.js';
import { CliError, withErrorHandling } from '../utils/errors.js';
import inquirer from 'inquirer';
import { detectPackageManager, installDependencies } from '../utils/package-manager.js';

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

/* Re-enabled after framework migration stabilization */
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

  const pending = summary.candidateStats?.pending
    ?? summary.candidates.filter((candidate) => candidate.status === 'pending').length;
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

  if (summary.skippedReasons && Object.keys(summary.skippedReasons).length) {
    console.log(chalk.yellow('Skipped reasons:'));
    (Object.entries(summary.skippedReasons) as [string, number][])
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => console.log(`  • ${reason}: ${count}`));
  }
}

function createProgressLogger() {
  let lastPercent = -1;
  let lastLogTime = 0;
  let pendingCarriageReturn = false;
  let lastPlainLog = 0;
  let emittedZero = false;
  const isTTY = Boolean(process.stdout.isTTY);
  const minPercentStep = isTTY ? 5 : 15;
  const minIntervalMs = isTTY ? 1000 : 4000;

  const writeLine = (line: string, final = false) => {
    if (isTTY) {
      process.stdout.write(`\r${line}`);
      pendingCarriageReturn = !final;
      if (final) {
        process.stdout.write('\n');
      }
      return;
    }

    const now = Date.now();
    if (final || now - lastPlainLog >= minIntervalMs) {
      console.log(line);
      lastPlainLog = now;
    }
  };

  return {
    emit(progress: TransformProgress) {
      if (progress.stage !== 'apply' || progress.total === 0) {
        return;
      }

      const now = Date.now();
      const computedPercent =
        typeof progress.percent === 'number'
          ? Math.max(0, Math.min(100, Math.round(progress.percent)))
          : progress.total
          ? Math.round((progress.processed / progress.total) * 100)
          : 0;
      const reachedEnd = progress.processed === progress.total;
      const percentAdvanced =
        (!emittedZero && computedPercent === 0) || computedPercent >= lastPercent + minPercentStep || reachedEnd;
      const timedOut = now - lastLogTime >= minIntervalMs;

      if (!percentAdvanced && !timedOut) {
        return;
      }

      if (!emittedZero && computedPercent === 0) {
        emittedZero = true;
      }

      lastPercent = Math.max(lastPercent, computedPercent);
      lastLogTime = now;

      const remaining =
        typeof progress.remaining === 'number'
          ? progress.remaining
          : Math.max(progress.total - progress.processed, 0);

      const line =
        `Applying transforms ${progress.processed}/${progress.total} (${computedPercent}%)` +
        ` | applied: ${progress.applied ?? 0}` +
        ` | skipped: ${progress.skipped ?? 0}` +
        (progress.errors ? ` | errors: ${progress.errors}` : '') +
        ` | remaining: ${remaining}`;
      writeLine(line, reachedEnd);
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
    .action(
      withErrorHandling(async (options: TransformOptions) => {
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

        // Proactively check if Vue files are targeted but the parser is missing
        const includesVue = config.include?.some(pattern => pattern.includes('.vue')) ?? false;
        let isVueParserAvailable = false;
        try {
          const require = createRequire(import.meta.url);
          const moduleDir = path.dirname(fileURLToPath(import.meta.url));
          require.resolve('vue-eslint-parser', { paths: [projectRoot, moduleDir] });
          isVueParserAvailable = true;
        } catch {
          isVueParserAvailable = false;
        }

        if (includesVue && !isVueParserAvailable) {
          console.log(chalk.yellow('⚠️  Vue files detected but "vue-eslint-parser" is not installed.'));
          console.log(chalk.yellow('   Verification of Vue templates might be incomplete or fail.'));
          
          if (process.stdout.isTTY) {
            const { install } = await inquirer.prompt<{ install: boolean }>([
              {
                type: 'confirm',
                name: 'install',
                message: 'Do you want to install "vue-eslint-parser" (dev dependency) now?',
                default: true,
              },
            ]);

            if (install) {
              const pm = await detectPackageManager(projectRoot);
              const cmd = pm === 'npm' ? 'npm install --save-dev vue-eslint-parser' : `${pm} add -D vue-eslint-parser`;
              console.log(chalk.gray(`> ${cmd}`));
              // We use installDependencies helper but need to pass dev flag args if not flexible
              // The helper seems simple: const args = manager === 'npm' ? ['install', ...deps] : ['add', ...deps];
              // So for dev we need to include -D in deps
              await installDependencies(pm, ['-D', 'vue-eslint-parser'], projectRoot);
              console.log(chalk.green('✔ Installed. Continuing...'));
            }
          }
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (options.json) {
          console.log(JSON.stringify({ ok: false, error: { message: errorMessage } }, null, 2));
          process.exitCode = 1;
          return;
        }
        throw new CliError(`Transform failed: ${errorMessage}`);
      }
    })
    );
}
