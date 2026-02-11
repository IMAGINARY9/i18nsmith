import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfigWithMeta, Syncer } from '@i18nsmith/core';
import type { DynamicKeyCoverage, I18nConfig } from '@i18nsmith/core';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface CoverageCommandOptions {
  config?: string;
  report?: string;
  json?: boolean;
  target?: string[];
  invalidateCache?: boolean;
}

const collectTargetPatterns = (value: string | string[], previous: string[]) => {
  const list = Array.isArray(value) ? value : [value];
  const tokens = list
    .flatMap((entry) => entry.split(','))
    .map((token) => token.trim())
    .filter(Boolean);
  return [...previous, ...tokens];
};

function buildCoverageSummary(coverage: DynamicKeyCoverage[]): {
  patterns: number;
  missing: number;
} {
  const entriesWithGaps = coverage.filter((entry) => Object.keys(entry.missingByLocale ?? {}).length > 0);
  const missing = entriesWithGaps.reduce((total, entry) => {
    return (
      total +
      Object.values(entry.missingByLocale ?? {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)
    );
  }, 0);
  return { patterns: entriesWithGaps.length, missing };
}

function buildCoverageReport(
  coverage: DynamicKeyCoverage[],
  config: I18nConfig,
  projectRoot: string,
  configPath: string
) {
  const summary = buildCoverageSummary(coverage);
  return {
    generatedAt: new Date().toISOString(),
    projectRoot,
    configPath,
    sourceLanguage: config.sourceLanguage ?? 'en',
    targetLanguages: config.targetLanguages ?? [],
    summary,
    coverage,
  };
}

export function registerCoverage(program: Command) {
  program
    .command('coverage')
    .description('Export dynamic key coverage report')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--report <path>', 'Write coverage report JSON to a file', '.i18nsmith/dynamic-key-coverage.json')
    .option('--json', 'Print report JSON to stdout', false)
    .option('--target <pattern...>', 'Limit reference scanning to specific files or patterns', collectTargetPatterns, [])
    .option('--invalidate-cache', 'Ignore cached sync analysis and rescan all source files', false)
    .action(withErrorHandling(async (options: CoverageCommandOptions) => runCoverage(options)));
}

export async function runCoverage(options: CoverageCommandOptions): Promise<void> {
  const { config, projectRoot, configPath } = await loadConfigWithMeta(options.config);
  const syncer = new Syncer(config, { workspaceRoot: projectRoot });

  const summary = await syncer.run({
    write: false,
    targets: options.target,
    invalidateCache: options.invalidateCache,
  });

  const coverage = summary.dynamicKeyCoverage ?? [];
  const report = buildCoverageReport(coverage, config, projectRoot, configPath);

  if (options.report) {
    const outputPath = path.resolve(process.cwd(), options.report);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(chalk.green(`Dynamic key coverage report written to ${outputPath}`));
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (!options.report && !options.json) {
    throw new CliError('No output specified. Use --report to write a file or --json to print to stdout.');
  }
}
