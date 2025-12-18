import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import type { Command } from 'commander';
import { loadConfigWithMeta, Scanner, type ScanCandidate, type ScanSummary } from '@i18nsmith/core';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface ReviewCommandOptions {
  config?: string;
  json?: boolean;
  limit?: number;
  scanCalls?: boolean;
}

type ReviewAction = 'allow' | 'deny' | 'skip' | 'stop';

const DEFAULT_CONFIG_PATH = 'i18n.config.json';
const DEFAULT_LIMIT = 20;

export function literalToRegexPattern(value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `^${escaped}$`;
}

function normalizeLimit(value?: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, Math.floor(value)), 200);
}

type BucketedScanSummary = ScanSummary & {
  buckets?: {
    needsReview?: ScanCandidate[];
    skipped?: Array<{ reason: string }>;
  };
};

function summarizeSkipReasons(skipped: Array<{ reason: string }>): string[] {
  if (!skipped.length) {
    return [];
  }
  const counts = new Map<string, number>();
  for (const entry of skipped) {
    counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `${reason}: ${count}`);
}

async function writeExtractionOverrides(
  configPath: string,
  allowPatterns: string[],
  denyPatterns: string[]
): Promise<{ allowAdded: number; denyAdded: number; wrote: boolean }> {
  if (!allowPatterns.length && !denyPatterns.length) {
    return { allowAdded: 0, denyAdded: 0, wrote: false };
  }

  const raw = await fs.readFile(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const extraction = (typeof parsed.extraction === 'object' && parsed.extraction !== null)
    ? (parsed.extraction as Record<string, unknown>)
    : (parsed.extraction = {});

  const allowList = Array.isArray(extraction.allowPatterns)
    ? [...(extraction.allowPatterns as string[])]
    : [];
  const denyList = Array.isArray(extraction.denyPatterns)
    ? [...(extraction.denyPatterns as string[])]
    : [];

  const allowAdded = appendUnique(allowList, allowPatterns);
  const denyAdded = appendUnique(denyList, denyPatterns);

  if (allowAdded === 0 && denyAdded === 0) {
    return { allowAdded, denyAdded, wrote: false };
  }

  extraction.allowPatterns = allowList;
  extraction.denyPatterns = denyList;

  await fs.writeFile(configPath, JSON.stringify(parsed, null, 2));
  return { allowAdded, denyAdded, wrote: true };
}

function appendUnique(target: string[], additions: string[]): number {
  const seen = new Set(target);
  let added = 0;
  for (const next of additions) {
    if (seen.has(next)) continue;
    target.push(next);
    seen.add(next);
    added++;
  }
  return added;
}

function printCandidate(candidate: ScanCandidate) {
  const location = `${candidate.filePath}:${candidate.position.line}:${candidate.position.column}`;
  console.log(chalk.cyan(`\n${candidate.text}`));
  console.log(chalk.gray(`  • Location: ${location}`));
  console.log(chalk.gray(`  • Kind: ${candidate.kind}`));
  if (candidate.context) {
    console.log(chalk.gray(`  • Context: ${candidate.context}`));
  }
}

async function promptAction(): Promise<ReviewAction> {
  const { action } = await inquirer.prompt<{ action: ReviewAction }>([
    {
      type: 'list',
      name: 'action',
      message: 'Choose an action for this string',
      choices: [
        { name: 'Always translate (add to allowPatterns)', value: 'allow' },
        { name: 'Always skip (add to denyPatterns)', value: 'deny' },
        { name: 'Skip for now', value: 'skip' },
        { name: 'Stop reviewing', value: 'stop' },
      ],
    },
  ]);
  return action;
}

export function registerReview(program: Command) {
  program
    .command('review')
    .description('Review borderline candidates and persist allow/deny overrides')
    .option('-c, --config <path>', 'Path to i18nsmith config file', DEFAULT_CONFIG_PATH)
    .option('--json', 'Print raw bucket data as JSON', false)
    .option('--limit <n>', 'Limit the number of items per session (default: 20)', (value) => parseInt(value, 10))
    .option('--scan-calls', 'Include translation call arguments', false)
    .action(
      withErrorHandling(async (options: ReviewCommandOptions) => {
        try {
          const { config, projectRoot, configPath } = await loadConfigWithMeta(options.config);
          const scanner = new Scanner(config, { workspaceRoot: projectRoot });
          const summary = scanner.scan({ scanCalls: options.scanCalls }) as BucketedScanSummary;
          const buckets = summary.buckets ?? {};
          const needsReview = buckets.needsReview ?? [];
          const skipped = buckets.skipped ?? [];

          if (options.json) {
            console.log(JSON.stringify({ needsReview, skipped }, null, 2));
            return;
          }

          if (!needsReview.length) {
            console.log(chalk.green('No borderline candidates detected.'));
            const reasons = summarizeSkipReasons(skipped);
            if (reasons.length) {
              console.log(chalk.gray('Most common skip reasons:'));
              reasons.forEach((line) => console.log(chalk.gray(`  • ${line}`)));
            }
            return;
          }

          if (!process.stdout.isTTY || process.env.CI === 'true') {
            console.log(chalk.red('Interactive review requires a TTY. Use --json for non-interactive output.'));
            process.exitCode = 1;
            return;
          }

          const limit = normalizeLimit(options.limit);
          const queue = needsReview.slice(0, limit);
          console.log(
            chalk.blue(
              `Reviewing ${queue.length} of ${needsReview.length} candidate${needsReview.length === 1 ? '' : 's'} (limit=${limit}).`
            )
          );

          const allowPatterns: string[] = [];
          const denyPatterns: string[] = [];

          for (const candidate of queue) {
            printCandidate(candidate);
            const action = await promptAction();
            if (action === 'stop') {
              break;
            }
            if (action === 'skip') {
              continue;
            }
            const pattern = literalToRegexPattern(candidate.text);
            if (action === 'allow') {
              allowPatterns.push(pattern);
              console.log(chalk.green(`  → Queued ${pattern} for allowPatterns`));
            } else if (action === 'deny') {
              denyPatterns.push(pattern);
              console.log(chalk.yellow(`  → Queued ${pattern} for denyPatterns`));
            }
          }

          if (!allowPatterns.length && !denyPatterns.length) {
            console.log(chalk.gray('No config changes requested.'));
            return;
          }

          const { allowAdded, denyAdded, wrote } = await writeExtractionOverrides(
            configPath,
            allowPatterns,
            denyPatterns
          );

          if (!wrote) {
            console.log(chalk.gray('Patterns already existed; config unchanged.'));
            return;
          }

          console.log(
            chalk.green(
              `Updated ${relativize(configPath)} (${allowAdded} allow, ${denyAdded} deny pattern${
                allowAdded + denyAdded === 1 ? '' : 's'
              } added).`
            )
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Review failed: ${message}`);
        }
      })
    );
}

function relativize(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}
