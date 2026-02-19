import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfigWithMeta, CheckRunner, isPackageResolvable } from '@i18nsmith/core';
import type { CheckSummary, I18nConfig } from '@i18nsmith/core';
import { printLocaleDiffs } from '../utils/diff-utils.js';
import { getDiagnosisExitSignal } from '../utils/diagnostics-exit.js';
import { CHECK_EXIT_CODES } from '../utils/exit-codes.js';
import {
  runLocaleAudit,
  printLocaleAuditResults,
  hasAuditFindings,
  type LocaleAuditSummary,
} from '../utils/locale-audit.js';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface CheckCommandOptions {
  config?: string;
  json?: boolean;
  target?: string[];
  report?: string;
  listFiles?: boolean;
  include?: string[];
  exclude?: string[];
  failOn?: 'none' | 'conflicts' | 'warnings';
  assume?: string[];
  assumeGlobs?: string[];
  validateInterpolations?: boolean;
  emptyValues?: boolean;
  diff?: boolean;
  invalidateCache?: boolean;
  preferDiagnosticsExit?: boolean;
  audit?: boolean;
  auditStrict?: boolean;
  auditLocales?: string[];
  auditDuplicates?: boolean;
  auditInconsistent?: boolean;
  auditOrphaned?: boolean;
}

interface ParserWarning {
  dependency: string;
  message: string;
  installHint: string;
}

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

function printCheckSummary(summary: CheckSummary) {
  const report = summary.diagnostics;
  console.log(chalk.green(`Locales directory: ${report.localesDir}`));
  console.log(
    chalk.gray(
      `Detected locales: ${report.detectedLocales.length ? report.detectedLocales.join(', ') : 'none'}`
    )
  );
  console.log(
    chalk.gray(
      `Runtime packages: ${report.runtimePackages.length ? report.runtimePackages.map((pkg) => pkg.name).join(', ') : 'none'}`
    )
  );
  console.log(
    chalk.gray(
      `Translation references scanned: ${summary.sync.references.length} across ${summary.sync.filesScanned} file${summary.sync.filesScanned === 1 ? '' : 's'}`
    )
  );

  printDynamicKeyCoverage(summary);

  if (summary.actionableItems.length) {
    console.log(chalk.blue('\nActionable items'));
    summary.actionableItems.slice(0, 25).forEach((item) => {
      const label = formatSeverityLabel(item.severity);
      console.log(`  • [${label}] ${item.message}`);
    });
    if (summary.actionableItems.length > 25) {
      console.log(chalk.gray(`  ...and ${summary.actionableItems.length - 25} more.`));
    }
  } else {
    console.log(chalk.green('\nNo actionable issues detected.'));
  }

  if (summary.suggestedCommands.length) {
    console.log(chalk.blue('\nSuggested commands'));
    summary.suggestedCommands.forEach((suggestion) => {
      const label = formatSeverityLabel(suggestion.severity);
      console.log(`  • [${label}] ${suggestion.label}`);
      console.log(`      ${chalk.cyan(suggestion.command)}`);
      console.log(chalk.gray(`      ${suggestion.reason}`));
    });
  } else {
    console.log(chalk.gray('\nNo automated suggestions—review actionable items above.'));
  }
}

function printDynamicKeyCoverage(summary: CheckSummary) {
  const coverage = summary.sync.dynamicKeyCoverage ?? [];
  if (!coverage.length) {
    return;
  }

  const entriesWithGaps = coverage.filter((entry) =>
    entry.missingByLocale && Object.keys(entry.missingByLocale).length > 0
  );
  const totalMissing = entriesWithGaps.reduce((total, entry) => {
    return (
      total +
      Object.values(entry.missingByLocale).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0)
    );
  }, 0);

  if (!entriesWithGaps.length) {
    console.log(chalk.green('Dynamic key coverage: all expanded keys present.'));
    return;
  }

  console.log(
    chalk.yellow(
      `Dynamic key coverage: ${totalMissing} missing translation${totalMissing === 1 ? '' : 's'} across ${entriesWithGaps.length} pattern${entriesWithGaps.length === 1 ? '' : 's'}.`
    )
  );

  entriesWithGaps.slice(0, 5).forEach((entry) => {
    const localeSummary = Object.entries(entry.missingByLocale)
      .map(([locale, missing]) => `${locale}(${missing.length})`)
      .join(', ');
    console.log(chalk.gray(`  • ${entry.pattern}: ${localeSummary}`));
  });

  if (entriesWithGaps.length > 5) {
    console.log(chalk.gray(`  ...and ${entriesWithGaps.length - 5} more.`));
  }
  console.log(chalk.gray('  Tip: run `i18nsmith sync --write` to scaffold missing dynamic keys.'));
}

function formatSeverityLabel(severity: 'info' | 'warn' | 'error'): string {
  if (severity === 'error') {
    return chalk.red('ERROR');
  }
  if (severity === 'warn') {
    return chalk.yellow('WARN');
  }
  return chalk.cyan('INFO');
}

export function registerCheck(program: Command) {
  program
    .command('check')
    .description('Run diagnostics plus a sync dry-run for a consolidated health report')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
    .option('--fail-on <level>', 'Failure threshold: none | conflicts | warnings', 'conflicts')
    .option('--assume <keys...>', 'List of runtime keys to assume (comma-separated)', collectAssumedKeys, [])
    .option('--assume-globs <patterns...>', 'Glob patterns for dynamic key namespaces (e.g., errors.*, navigation.**)', collectTargetPatterns, [])
    .option('--validate-interpolations', 'Validate interpolation placeholders across locales', false)
    .option('--no-empty-values', 'Treat empty or placeholder locale values as failures')
    .option('--diff', 'Include locale diff previews for missing/unused key fixes', false)
    .option('--invalidate-cache', 'Ignore cached sync analysis and rescan all source files', false)
    .option('--target <pattern...>', 'Limit translation reference scanning to specific files or patterns', collectTargetPatterns, [])
    .option('--prefer-diagnostics-exit', 'Prefer diagnostics exit codes when --fail-on=conflicts and blocking conflicts exist', false)
    .option('--audit', 'Include locale quality audit (duplicates, inconsistent keys, orphaned namespaces)', false)
    .option('--audit-strict', 'Fail if locale audit finds issues (implies --audit)', false)
  .option('--audit-locales <locales...>', 'Limit locale audit to specific locales (comma-separated)', collectTargetPatterns, [])
  .option('--audit-duplicates', 'Include duplicate-value quality check during audit (defaults on when no other audit filters provided)', false)
  .option('--audit-inconsistent', 'Include inconsistent-key quality check during audit', false)
  .option('--audit-orphaned', 'Include orphaned-namespace quality check during audit', false)
    .action(withErrorHandling(async (options: CheckCommandOptions) => runCheck(options)));
}

export async function runCheck(options: CheckCommandOptions): Promise<void> {
  const auditEnabled = Boolean(options.audit || options.auditStrict);
  if (options.json) {
    console.error(chalk.blue('Running guided repository health check...'));
  } else {
    console.log(chalk.blue('Running guided repository health check...'));
  }
  try {
    const { config, projectRoot, configPath } = await loadConfigWithMeta(options.config);

    // Inform user if config was found in a parent directory
    const cwd = process.cwd();
    if (projectRoot !== cwd) {
      console.log(chalk.gray(`Config found at ${path.relative(cwd, configPath)}`));
      console.log(chalk.gray(`Using project root: ${projectRoot}\n`));
    }

    // Merge --assume-globs with config
    if (options.assumeGlobs?.length) {
      config.sync = config.sync ?? {};
      config.sync.dynamicKeyGlobs = [
        ...(config.sync.dynamicKeyGlobs ?? []),
        ...options.assumeGlobs,
      ];
    }
    const parserWarnings: ParserWarning[] = [];
    const parserStatus = buildParserStatus(config, projectRoot);
    const vueStatus = parserStatus.vue;
    if (vueStatus?.required && !vueStatus.available) {
      parserWarnings.push({
        dependency: 'vue-eslint-parser',
        message: 'Vue files detected but "vue-eslint-parser" is not installed. Results may be incomplete.',
        installHint: 'npm install --save-dev vue-eslint-parser',
      });
      console.log(chalk.yellow('⚠️  Vue files detected but "vue-eslint-parser" is not installed.'));
      console.log(chalk.yellow('   Some Vue template references may be skipped.'));
    }

    const runner = new CheckRunner(config, { workspaceRoot: projectRoot });
    const summary = await runner.run({
      assumedKeys: options.assume,
      validateInterpolations: options.validateInterpolations,
      emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
      diff: options.diff,
      targets: options.target,
      invalidateCache: options.invalidateCache,
    });

    let localeAudit: LocaleAuditSummary | undefined;
    if (auditEnabled) {
      const auditLocales = options.auditLocales?.filter(Boolean) ?? [];
      const auditOverridesProvided = Boolean(options.auditDuplicates) || Boolean(options.auditInconsistent) || Boolean(options.auditOrphaned);

      localeAudit = await runLocaleAudit(
        { config, projectRoot },
        {
          locales: auditLocales.length ? auditLocales : undefined,
          checkDuplicates: auditOverridesProvided ? Boolean(options.auditDuplicates) : true,
          checkInconsistent: auditOverridesProvided ? Boolean(options.auditInconsistent) : true,
          checkOrphaned: auditOverridesProvided ? Boolean(options.auditOrphaned) : true,
        }
      );
    }

    const payload = localeAudit
      ? { ...summary, audit: localeAudit, parserStatus, ...(parserWarnings.length ? { parserWarnings } : {}) }
      : { ...summary, parserStatus, ...(parserWarnings.length ? { parserWarnings } : {}) };

    if (options.report) {
      const outputPath = path.resolve(process.cwd(), options.report);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
      console.log(chalk.green(`Health report written to ${outputPath}`));
    }

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printCheckSummary(summary);
      if (parserWarnings.length) {
        console.log(chalk.yellow('\nParser warnings'));
        parserWarnings.forEach((warning) => {
          console.log(`  • ${warning.message}`);
          console.log(chalk.gray(`    Install: ${warning.installHint}`));
        });
      }
      if (options.diff) {
        printLocaleDiffs(summary.sync.diffs);
      }
      if (localeAudit) {
        console.log(chalk.blue('\nLocale quality audit')); 
        printLocaleAuditResults(localeAudit);
      }
    }

    // Diagnostics exit override
    const diagExit = getDiagnosisExitSignal(summary.diagnostics);
    if (diagExit && options.preferDiagnosticsExit && (options.failOn ?? 'conflicts') === 'conflicts') {
      console.error(chalk.red(`\nBlocking diagnostic conflict detected: ${diagExit.reason}`));
      console.error(chalk.red(`Exit code ${diagExit.code}`));
      process.exitCode = diagExit.code;
      return;
    }

    const failMode = (options.failOn ?? 'conflicts').toLowerCase();
    const hasErrors = summary.actionableItems.some((item) => item.severity === 'error');
    const hasWarnings = summary.actionableItems.some((item) => item.severity === 'warn');
    const auditHasIssues = Boolean(localeAudit && hasAuditFindings(localeAudit));

    if (options.auditStrict && auditHasIssues) {
      console.error(chalk.red('\nAudit detected locale quality issues (--audit-strict).'));
      process.exitCode = CHECK_EXIT_CODES.WARNINGS;
      return;
    }

    if (failMode === 'conflicts' && hasErrors) {
      console.error(chalk.red('\nBlocking issues detected. Resolve the actionable errors above.'));
      process.exitCode = CHECK_EXIT_CODES.CONFLICTS;
    } else if (failMode === 'warnings' && (hasErrors || hasWarnings || auditHasIssues)) {
      console.error(chalk.red('\nWarnings detected. Use --fail-on conflicts to limit failures to blocking issues.'));
      process.exitCode = CHECK_EXIT_CODES.WARNINGS;
    }
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`Check failed: ${message}`);
  }
}

type ParserStatusEntry = {
  available: boolean;
  required: boolean;
};

type ParserStatusMap = Record<string, ParserStatusEntry>;

function buildParserStatus(config: I18nConfig, projectRoot: string): ParserStatusMap {
  const includePatterns = config.include ?? [];
  const requiresVue = includesExtension(includePatterns, '.vue');
  const requiresTypeScript =
    includesExtension(includePatterns, '.ts') ||
    includesExtension(includePatterns, '.tsx') ||
    includesExtension(includePatterns, '.js') ||
    includesExtension(includePatterns, '.jsx');

  let vueAvailable = false;
  try {
    vueAvailable = isPackageResolvable('vue-eslint-parser', projectRoot);
  } catch {
    vueAvailable = false;
  }

  return {
    typescript: { available: true, required: requiresTypeScript },
    vue: { available: vueAvailable, required: requiresVue },
  };
}

function includesExtension(patterns: string[], extension: string): boolean {
  const ext = extension.toLowerCase();
  const extToken = ext.startsWith('.') ? ext.slice(1) : ext;
  const extRegex = new RegExp(`\\.${extToken}(?:\\b|\\}|,|$)`, 'i');

  return patterns.some((pattern) => {
    const normalized = pattern.toLowerCase();
    if (normalized.includes(ext)) {
      return true;
    }
    const braceMatch = normalized.match(/\{([^}]+)\}/);
    if (braceMatch) {
      const entries = braceMatch[1].split(',').map((value) => value.trim());
      if (entries.includes(extToken)) {
        return true;
      }
    }
    return extRegex.test(normalized);
  });
}
