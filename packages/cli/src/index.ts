#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import type { CheckboxQuestion } from 'inquirer';
import {
  loadConfig,
  loadConfigWithMeta,
  Scanner,
  ScanCandidate,
  KeyValidator,
  SUSPICIOUS_KEY_REASON_DESCRIPTIONS,
  LocaleStore,
  LocaleValidator,
  SyncSummary,
  Syncer,
  KeyRenamer,
  KeyRenameSummary,
  KeyRenameBatchSummary,
  KeyRenameMapping,
  diagnoseWorkspace,
  CheckRunner,
  generateRenameProposals,
  createRenameMappingFile,
  listBackups,
  restoreBackup,
} from '@i18nsmith/core';
import type { CheckSummary, DiagnosisReport } from '@i18nsmith/core';
import { TransformSummary, Transformer } from '@i18nsmith/transformer';
import { registerInit } from './commands/init.js';
import { registerScaffoldAdapter } from './commands/scaffold-adapter.js';
import { registerTranslate } from './commands/translate.js';
import { registerPreflight } from './commands/preflight.js';
import { registerDebugPatterns } from './commands/debug-patterns.js';
import { printLocaleDiffs, writeLocaleDiffPatches } from './utils/diff-utils.js';
import { getDiagnosisExitSignal } from './utils/diagnostics-exit.js';
import { SYNC_EXIT_CODES, CHECK_EXIT_CODES } from './utils/exit-codes.js';

interface ScanOptions {
  config?: string;
  json?: boolean;
  target?: string[];
  report?: string;
  listFiles?: boolean;
  include?: string[];
  exclude?: string[];
}

interface DiagnoseCommandOptions {
  config?: string;
  json?: boolean;
  report?: string;
}

interface CheckCommandOptions extends ScanOptions {
  json?: boolean;
  report?: string;
  failOn?: 'none' | 'conflicts' | 'warnings';
  assume?: string[];
  assumeGlobs?: string[];
  validateInterpolations?: boolean;
  emptyValues?: boolean;
  diff?: boolean;
  invalidateCache?: boolean;
  preferDiagnosticsExit?: boolean;
}

interface RenameMapOptions extends ScanOptions {
  map: string;
  write?: boolean;
  diff?: boolean;
}

interface SyncCommandOptions extends ScanOptions {
  write?: boolean;
  prune?: boolean;
  backup?: boolean;
  yes?: boolean;
  check?: boolean;
  strict?: boolean;
  validateInterpolations?: boolean;
  emptyValues?: boolean;
  assume?: string[];
  assumeGlobs?: string[];
  interactive?: boolean;
  diff?: boolean;
  patchDir?: string;
  invalidateCache?: boolean;
  autoRenameSuspicious?: boolean;
  renameMapFile?: string;
  namingConvention?: 'kebab-case' | 'camelCase' | 'snake_case';
  rewriteShape?: 'flat' | 'nested';
  shapeDelimiter?: string;
  seedTargetLocales?: boolean;
  seedValue?: string;
}

interface AuditCommandOptions {
  config?: string;
  locale?: string[];
  json?: boolean;
  report?: string;
  strict?: boolean;
  duplicates?: boolean;
  inconsistent?: boolean;
  orphaned?: boolean;
}

const program = new Command();

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
registerTranslate(program);
registerPreflight(program);
registerDebugPatterns(program);

program
  .command('diagnose')
  .description('Detect existing i18n assets and potential merge conflicts')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--report <path>', 'Write JSON report to a file (for CI or editors)')
  .action(async (options: DiagnoseCommandOptions) => {
    console.log(chalk.blue('Running repository diagnostics...'));
    try {
      const config = await loadConfig(options.config);
      const report = await diagnoseWorkspace(config);

      if (options.report) {
        const outputPath = path.resolve(process.cwd(), options.report);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
        console.log(chalk.green(`Diagnosis report written to ${outputPath}`));
      }

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printDiagnosisReport(report);
      }

      const exitSignal = getDiagnosisExitSignal(report);
      if (exitSignal) {
        console.error(chalk.red(`\nBlocking conflicts detected (${report.conflicts.length}).`));
        console.error(chalk.red(`Exit code ${exitSignal.code}: ${exitSignal.reason}`));
        process.exitCode = exitSignal.code;
      }
    } catch (error) {
      console.error(chalk.red('Diagnose failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('audit')
  .description('Audit locale files for suspicious keys, key=value patterns, and quality issues')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('-l, --locale <locales...>', 'Specific locale(s) to audit (defaults to all)')
  .option('--json', 'Print raw JSON results', false)
  .option('--report <path>', 'Write JSON report to a file')
  .option('--strict', 'Exit with error code if any issues found', false)
  .option('--duplicates', 'Check for duplicate values (consolidation opportunities)', false)
  .option('--inconsistent', 'Check for inconsistent key naming patterns', false)
  .option('--orphaned', 'Check for orphaned namespaces with few keys', false)
  .action(async (options: AuditCommandOptions) => {
    console.log(chalk.blue('Auditing locale files...'));
    try {
      const config = await loadConfig(options.config);
      const localesDir = path.resolve(process.cwd(), config.localesDir ?? 'locales');
      const localeStore = new LocaleStore(localesDir, {
        sortKeys: config.locales?.sortKeys ?? 'alphabetical',
      });
      const keyValidator = new KeyValidator(config.sync?.suspiciousKeyPolicy ?? 'skip');
      const localeValidator = new LocaleValidator({
        delimiter: config.locales?.delimiter ?? '.',
      });

      // Determine which locales to audit
      let localesToAudit = options.locale ?? [];
      if (localesToAudit.length === 0) {
        localesToAudit = [config.sourceLanguage ?? 'en', ...(config.targetLanguages ?? [])];
      }

      // Enable all quality checks if none specified
      const runQualityChecks = options.duplicates || options.inconsistent || options.orphaned;
      const checkDuplicates = options.duplicates || !runQualityChecks;
      const checkInconsistent = options.inconsistent;
      const checkOrphaned = options.orphaned;

      interface AuditIssue {
        key: string;
        value: string;
        reason: string;
        description: string;
        suggestion?: string;
      }

      interface QualityIssue {
        type: 'duplicate-value' | 'inconsistent-key' | 'orphaned-namespace';
        description: string;
        keys?: string[];
        suggestion?: string;
      }

      interface LocaleAuditResult {
        locale: string;
        totalKeys: number;
        issues: AuditIssue[];
        qualityIssues: QualityIssue[];
      }

      const results: LocaleAuditResult[] = [];
      const allKeys = new Set<string>();

      // First pass: collect all keys
      for (const locale of localesToAudit) {
        const data = await localeStore.get(locale);
        for (const key of Object.keys(data)) {
          allKeys.add(key);
        }
      }

      // Second pass: run audits
      for (const locale of localesToAudit) {
        const data = await localeStore.get(locale);
        const keys = Object.keys(data);
        const issues: AuditIssue[] = [];
        const qualityIssues: QualityIssue[] = [];

        // Suspicious key detection
        for (const key of keys) {
          const value = data[key];
          const analysis = keyValidator.analyzeWithValue(key, value);

          if (analysis.suspicious && analysis.reason) {
            issues.push({
              key,
              value: value.length > 50 ? `${value.slice(0, 47)}...` : value,
              reason: analysis.reason,
              description: SUSPICIOUS_KEY_REASON_DESCRIPTIONS[analysis.reason] ?? 'Unknown issue',
              suggestion: keyValidator.suggestFix(key, analysis.reason),
            });
          }
        }

        // Quality checks
        if (checkDuplicates) {
          const duplicates = localeValidator.detectDuplicateValues(locale, data);
          for (const dup of duplicates) {
            qualityIssues.push({
              type: 'duplicate-value',
              description: `Value "${dup.value.slice(0, 40)}${dup.value.length > 40 ? '...' : ''}" used by ${dup.keys.length} keys`,
              keys: dup.keys,
              suggestion: 'Consider consolidating to a single key',
            });
          }
        }

        if (checkInconsistent && locale === localesToAudit[0]) {
          // Only check inconsistent keys once (using all keys)
          const inconsistent = localeValidator.detectInconsistentKeys(Array.from(allKeys));
          for (const inc of inconsistent) {
            qualityIssues.push({
              type: 'inconsistent-key',
              description: inc.pattern,
              keys: inc.variants,
              suggestion: inc.suggestion,
            });
          }
        }

        if (checkOrphaned && locale === localesToAudit[0]) {
          // Only check orphaned namespaces once (using all keys)
          const orphaned = localeValidator.detectOrphanedNamespaces(Array.from(allKeys));
          for (const orph of orphaned) {
            qualityIssues.push({
              type: 'orphaned-namespace',
              description: `Namespace "${orph.namespace}" has only ${orph.keyCount} key(s)`,
              keys: orph.keys,
              suggestion: 'Consider merging into a related namespace',
            });
          }
        }

        results.push({
          locale,
          totalKeys: keys.length,
          issues,
          qualityIssues,
        });
      }

      const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
      const totalQualityIssues = results.reduce((sum, r) => sum + r.qualityIssues.length, 0);

      if (options.report) {
        const outputPath = path.resolve(process.cwd(), options.report);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify({ results, totalIssues, totalQualityIssues }, null, 2));
        console.log(chalk.green(`Audit report written to ${outputPath}`));
      }

      if (options.json) {
        console.log(JSON.stringify({ results, totalIssues, totalQualityIssues }, null, 2));
      } else {
        // Pretty print results
        for (const result of results) {
          const hasIssues = result.issues.length > 0 || result.qualityIssues.length > 0;
          if (!hasIssues) {
            console.log(chalk.green(`✓ ${result.locale}.json: ${result.totalKeys} keys, no issues`));
          } else {
            console.log(chalk.yellow(`⚠ ${result.locale}.json: ${result.totalKeys} keys`));

            // Suspicious keys
            if (result.issues.length > 0) {
              console.log(chalk.yellow(`  Suspicious keys: ${result.issues.length}`));
              for (const issue of result.issues) {
                console.log(chalk.dim(`    - "${issue.key}"`));
                console.log(chalk.dim(`      ${issue.description}`));
                if (issue.suggestion) {
                  console.log(chalk.dim(`      Suggestion: ${issue.suggestion}`));
                }
              }
            }

            // Quality issues
            if (result.qualityIssues.length > 0) {
              console.log(chalk.cyan(`  Quality checks: ${result.qualityIssues.length}`));
              for (const issue of result.qualityIssues) {
                const typeLabel = issue.type === 'duplicate-value' ? '📋' :
                                  issue.type === 'inconsistent-key' ? '🔀' : '📦';
                console.log(chalk.dim(`    ${typeLabel} ${issue.description}`));
                if (issue.suggestion) {
                  console.log(chalk.dim(`       ${issue.suggestion}`));
                }
              }
            }
          }
        }

        console.log();
        if (totalIssues === 0 && totalQualityIssues === 0) {
          console.log(chalk.green('✓ No issues found in locale files'));
        } else {
          if (totalIssues > 0) {
            console.log(chalk.yellow(`Found ${totalIssues} suspicious key(s)`));
          }
          if (totalQualityIssues > 0) {
            console.log(chalk.cyan(`Found ${totalQualityIssues} quality issue(s)`));
          }
        }
      }

      if (options.strict && totalIssues > 0) {
        console.error(chalk.red(`\nAudit failed with ${totalIssues} issue(s). Use --strict=false to allow.`));
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(chalk.red('Audit failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

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
  .action(async (options: CheckCommandOptions) => {
    console.log(chalk.blue('Running guided repository health check...'));
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
      const runner = new CheckRunner(config, { workspaceRoot: projectRoot });
      const summary = await runner.run({
        assumedKeys: options.assume,
        validateInterpolations: options.validateInterpolations,
        emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
        diff: options.diff,
        targets: options.target,
        invalidateCache: options.invalidateCache,
      });

      if (options.report) {
        const outputPath = path.resolve(process.cwd(), options.report);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
        console.log(chalk.green(`Health report written to ${outputPath}`));
      }

      if (options.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        printCheckSummary(summary);
        if (options.diff) {
          printLocaleDiffs(summary.sync.diffs);
        }
      }

      // If diagnostics discovered blocking conflicts, prefer the diagnostics' exit
      // signal so CI can branch on specific failure modes (missing source locale,
      // invalid JSON, etc.). This mirrors `i18nsmith diagnose` behavior.
      // Only when --prefer-diagnostics-exit is true and --fail-on=conflicts.
      const diagExit = getDiagnosisExitSignal(summary.diagnostics);
      if (diagExit && options.preferDiagnosticsExit && options.failOn === 'conflicts') {
        console.error(chalk.red(`\nBlocking diagnostic conflict detected: ${diagExit.reason}`));
        console.error(chalk.red(`Exit code ${diagExit.code}`));
        process.exitCode = diagExit.code;
        return;
      }

      const failMode = (options.failOn ?? 'conflicts').toLowerCase();
      const hasErrors = summary.actionableItems.some((item) => item.severity === 'error');
      const hasWarnings = summary.actionableItems.some((item) => item.severity === 'warn');

      if (failMode === 'conflicts' && hasErrors) {
        console.error(chalk.red('\nBlocking issues detected. Resolve the actionable errors above.'));
        process.exitCode = CHECK_EXIT_CODES.CONFLICTS;
      } else if (failMode === 'warnings' && (hasErrors || hasWarnings)) {
        console.error(chalk.red('\nWarnings detected. Use --fail-on conflicts to limit failures to blocking issues.'));
        process.exitCode = CHECK_EXIT_CODES.WARNINGS;
      }
    } catch (error) {
      console.error(chalk.red('Check failed:'), (error as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('scan')
  .description('Scan project for strings to translate')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
  .option('--list-files', 'List the files that were scanned', false)
  .option('--include <patterns...>', 'Override include globs from config (comma or space separated)', collectTargetPatterns, [])
  .option('--exclude <patterns...>', 'Override exclude globs from config (comma or space separated)', collectTargetPatterns, [])
  .action(async (options: ScanOptions) => {
    console.log(chalk.blue('Starting scan...'));

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
      const scanner = new Scanner(config, { workspaceRoot: projectRoot });
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

function printDiagnosisReport(report: DiagnosisReport) {
  console.log(chalk.green(`Locales directory: ${report.localesDir}`));

  console.log(chalk.blue('\nLocales'));
  if (report.localeFiles.length === 0) {
    console.log(chalk.yellow('  • No locale files detected.'));
  } else {
    for (const entry of report.localeFiles) {
      const relPath = path.relative(process.cwd(), entry.path);
      const status = entry.missing
        ? chalk.red('missing')
        : entry.parseError
        ? chalk.red('invalid JSON')
        : `${entry.keyCount} keys`;
      console.log(`  • ${entry.locale} — ${status}${entry.missing ? '' : ` (${relPath})`}`);
    }
  }

  console.log(chalk.blue('\nRuntime packages'));
  if (report.runtimePackages.length === 0) {
    console.log(chalk.yellow('  • None detected in package.json.'));
  } else {
    for (const pkg of report.runtimePackages) {
      console.log(`  • ${pkg.name}@${pkg.version ?? 'latest'} (${pkg.source})`);
    }
  }

  console.log(chalk.blue('\nProvider candidates'));
  if (report.providerFiles.length === 0) {
    console.log(chalk.gray('  • No provider files discovered.'));
  } else {
    for (const provider of report.providerFiles) {
      const flags: string[] = [];
      if (provider.frameworkHint !== 'unknown') {
        flags.push(provider.frameworkHint);
      }
      if (provider.hasI18nProvider) {
        flags.push('wraps <I18nProvider>');
      }
      if (provider.usesTranslationHook) {
        flags.push('imports translation hook');
      }
      const flagLabel = flags.length ? ` (${flags.join(', ')})` : '';
      console.log(`  • ${provider.relativePath}${flagLabel}`);
    }
  }

  console.log(chalk.blue('\nTranslation usage'));
  console.log(
    `  • Files scanned: ${report.translationUsage.filesExamined} — ` +
      `${report.translationUsage.hookOccurrences} ${report.translationUsage.hookName} hooks, ` +
      `${report.translationUsage.identifierOccurrences} ${report.translationUsage.translationIdentifier}() calls`
  );

  if (report.translationUsage.hookExampleFiles.length) {
    console.log(
      chalk.gray(`    Examples: ${report.translationUsage.hookExampleFiles.concat(report.translationUsage.identifierExampleFiles).slice(0, 5).join(', ')}`)
    );
  }

  if (report.actionableItems.length) {
    console.log(chalk.blue('\nActionable items'));
    for (const item of report.actionableItems) {
      const label = item.severity === 'error' ? chalk.red('ERROR') : item.severity === 'warn' ? chalk.yellow('WARN') : chalk.cyan('INFO');
      console.log(`  • [${label}] ${item.message}`);
    }
  }

  if (report.recommendations.length) {
    console.log(chalk.blue('\nRecommendations'));
    for (const rec of report.recommendations) {
      console.log(`  • ${rec}`);
    }
  }

  if (report.conflicts.length) {
    console.log(chalk.red('\nConflicts'));
    for (const conflict of report.conflicts) {
      const files = conflict.files?.length ? ` (${conflict.files.join(', ')})` : '';
      console.log(`  • ${conflict.message}${files}`);
    }
  }
}

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

function formatSeverityLabel(severity: 'info' | 'warn' | 'error'): string {
  if (severity === 'error') {
    return chalk.red('ERROR');
  }
  if (severity === 'warn') {
    return chalk.yellow('WARN');
  }
  return chalk.cyan('INFO');
}

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
  .action(async (options: ScanOptions & { write?: boolean; check?: boolean; diff?: boolean; patchDir?: string; migrateTextKeys?: boolean }) => {
    const diffEnabled = Boolean(options.diff || options.patchDir);
    console.log(
      chalk.blue(options.write ? 'Running transform (write mode)...' : 'Planning transform (dry-run)...')
    );

    try {
      const { config, projectRoot, configPath } = await loadConfigWithMeta(options.config);
      
      // Inform user if config was found in a parent directory
      const cwd = process.cwd();
      if (projectRoot !== cwd) {
        console.log(chalk.gray(`Config found at ${path.relative(cwd, configPath)}`));
        console.log(chalk.gray(`Using project root: ${projectRoot}\n`));
      }
      
      const transformer = new Transformer(config, { workspaceRoot: projectRoot });
      const summary = await transformer.run({
        write: options.write,
        targets: options.target,
        diff: diffEnabled,
        migrateTextKeys: options.migrateTextKeys,
      });

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
  .description('Detect missing locale keys and optionally prune unused entries')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
  .option('--write', 'Write changes to disk (defaults to dry-run)', false)
  .option('--prune', 'Remove unused keys from locale files (requires --write)', false)
  .option('--no-backup', 'Disable automatic backup when using --prune (backup is on by default with --prune)')
  .option('-y, --yes', 'Skip confirmation prompts (for CI)', false)
  .option('--check', 'Exit with error code if drift detected', false)
  .option('--strict', 'Exit with error code if any suspicious patterns detected (CI mode)', false)
  .option('--validate-interpolations', 'Validate interpolation placeholders across locales', false)
  .option('--no-empty-values', 'Treat empty or placeholder locale values as failures')
  .option('--assume <keys...>', 'List of runtime keys to assume present (comma-separated)', collectAssumedKeys, [])
  .option('--assume-globs <patterns...>', 'Glob patterns for dynamic key namespaces (e.g., errors.*, navigation.**)', collectTargetPatterns, [])
  .option('--interactive', 'Interactively approve locale mutations before writing', false)
  .option('--diff', 'Display unified diffs for locale files that would change', false)
  .option('--patch-dir <path>', 'Write locale diffs to .patch files in the specified directory')
  .option('--invalidate-cache', 'Ignore cached sync analysis and rescan all source files', false)
  .option('--target <pattern...>', 'Limit translation reference scanning to specific files or glob patterns', collectTargetPatterns, [])
  .option('--include <patterns...>', 'Override include globs from config (comma or space separated)', collectTargetPatterns, [])
  .option('--exclude <patterns...>', 'Override exclude globs from config (comma or space separated)', collectTargetPatterns, [])
  .option('--auto-rename-suspicious', 'Propose normalized names for suspicious keys', false)
  .option('--rename-map-file <path>', 'Write rename proposals to a mapping file (JSON or commented format)')
  .option('--naming-convention <convention>', 'Naming convention for auto-rename (kebab-case, camelCase, snake_case)', 'kebab-case')
  .option('--rewrite-shape <format>', 'Rewrite all locale files to flat or nested format')
  .option('--shape-delimiter <char>', 'Delimiter for key nesting (default: ".")', '.')
  .option('--seed-target-locales', 'Add missing keys to target locale files with empty or placeholder values', false)
  .option('--seed-value <value>', 'Value to use when seeding target locales (default: empty string)', '')
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
      // Merge --assume-globs with config
      if (options.assumeGlobs?.length) {
        config.sync = config.sync ?? {};
        config.sync.dynamicKeyGlobs = [
          ...(config.sync.dynamicKeyGlobs ?? []),
          ...options.assumeGlobs,
        ];
      }
      // Apply --seed-target-locales and --seed-value flags
      if (options.seedTargetLocales) {
        config.seedTargetLocales = true;
      }
      if (options.seedValue !== undefined && options.seedValue !== '') {
        config.sync = config.sync ?? {};
        config.sync.seedValue = options.seedValue;
      }
      const syncer = new Syncer(config, { workspaceRoot: projectRoot });
      if (interactive) {
        await runInteractiveSync(syncer, { ...options, diff: diffEnabled, invalidateCache });
        return;
      }

      // If writing with prune, first do a dry-run to check scope
      const PRUNE_CONFIRMATION_THRESHOLD = 10;
      let confirmedPrune = options.prune;
      
      if (options.write && options.prune && !options.yes) {
        // Quick dry-run to see how many keys would be pruned
        const dryRunSummary = await syncer.run({
          write: false,
          prune: true,
          validateInterpolations: options.validateInterpolations,
          emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
          assumedKeys: options.assume,
          diff: false,
          invalidateCache,
          targets: options.target,
        });

        if (dryRunSummary.unusedKeys.length >= PRUNE_CONFIRMATION_THRESHOLD) {
          console.log(chalk.yellow(`\n⚠️  About to remove ${dryRunSummary.unusedKeys.length} unused key(s) from locale files.\n`));
          
          // Show sample of keys to be removed
          const sampleKeys = dryRunSummary.unusedKeys.slice(0, 10).map(k => k.key);
          for (const key of sampleKeys) {
            console.log(chalk.gray(`   - ${key}`));
          }
          if (dryRunSummary.unusedKeys.length > 10) {
            console.log(chalk.gray(`   ... and ${dryRunSummary.unusedKeys.length - 10} more`));
          }
          console.log('');

          const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
            {
              type: 'confirm',
              name: 'confirmed',
              message: `Remove these ${dryRunSummary.unusedKeys.length} unused keys?`,
              default: false,
            },
          ]);

          if (!confirmed) {
            console.log(chalk.yellow('Prune cancelled. Running with --write only (add missing keys).'));
            confirmedPrune = false;
          }
        }
      }

      const summary = await syncer.run({
        write: options.write,
        prune: confirmedPrune,
        backup: options.backup,
        validateInterpolations: options.validateInterpolations,
        emptyValuePolicy: options.emptyValues === false ? 'fail' : undefined,
        assumedKeys: options.assume,
        diff: diffRequested,
        invalidateCache,
        targets: options.target,
      });

      // Show backup info if created
      if (summary.backup) {
        console.log(chalk.blue(`\n📦 ${summary.backup.summary}`));
      }

      if (options.report) {
        const outputPath = path.resolve(process.cwd(), options.report);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(summary, null, 2));
        console.log(chalk.green(`Sync report written to ${outputPath}`));
      }

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

      // Handle --auto-rename-suspicious
      if (options.autoRenameSuspicious && summary.suspiciousKeys.length > 0) {
        await handleAutoRenameSuspicious(summary, options, config);
      }

      // Handle --rewrite-shape
      if (options.rewriteShape && (options.rewriteShape === 'flat' || options.rewriteShape === 'nested')) {
        await handleRewriteShape(options, config);
      }

      const shouldFailPlaceholders = summary.validation.interpolations && summary.placeholderIssues.length > 0;
      const shouldFailEmptyValues =
        summary.validation.emptyValuePolicy === 'fail' && summary.emptyValueViolations.length > 0;

      // --strict mode: fail on any suspicious patterns
      if (options.strict) {
        const hasSuspiciousKeys = summary.suspiciousKeys.length > 0;
        const hasDrift = summary.missingKeys.length > 0 || summary.unusedKeys.length > 0;

        if (hasSuspiciousKeys) {
          console.error(chalk.red('\n⚠️  Suspicious patterns detected (--strict mode):'));
          const grouped = new Map<string, string[]>();
          for (const warning of summary.suspiciousKeys.slice(0, 20)) {
            const reason = warning.reason;
            if (!grouped.has(reason)) {
              grouped.set(reason, []);
            }
            grouped.get(reason)!.push(warning.key);
          }
          for (const [reason, keys] of grouped) {
            console.error(chalk.yellow(`  ${reason}:`));
            keys.slice(0, 5).forEach((key) => console.error(`    • ${key}`));
            if (keys.length > 5) {
              console.error(chalk.gray(`    ...and ${keys.length - 5} more.`));
            }
          }
          if (summary.suspiciousKeys.length > 20) {
            console.error(chalk.gray(`  ...and ${summary.suspiciousKeys.length - 20} more warnings.`));
          }
          process.exitCode = SYNC_EXIT_CODES.SUSPICIOUS_KEYS;
          return;
        }

        if (shouldFailPlaceholders) {
          console.error(chalk.red('\nPlaceholder mismatches detected (--strict mode).'));
          process.exitCode = SYNC_EXIT_CODES.PLACEHOLDER_MISMATCH;
          return;
        }

        if (shouldFailEmptyValues) {
          console.error(chalk.red('\nEmpty locale values detected (--strict mode).'));
          process.exitCode = SYNC_EXIT_CODES.EMPTY_VALUES;
          return;
        }

        if (hasDrift) {
          console.error(chalk.red('\nDrift detected (--strict mode). Run with --write to fix.'));
          process.exitCode = SYNC_EXIT_CODES.DRIFT;
          return;
        }

        console.log(chalk.green('\n✓ No issues detected (--strict mode passed).'));
        return;
      }

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

      if (!options.write) {
        // Show prominent dry-run indicator
        console.log(chalk.cyan('\n📋 DRY RUN - No files were modified'));
        if (summary.missingKeys.length && summary.unusedKeys.length) {
          console.log(chalk.yellow('Run again with --write to add missing keys.'));
          console.log(chalk.yellow('Run with --write --prune to also remove unused keys.'));
        } else if (summary.missingKeys.length) {
          console.log(chalk.yellow('Run again with --write to add missing keys.'));
        } else if (summary.unusedKeys.length) {
          console.log(chalk.yellow('Unused keys found. Run with --write --prune to remove them.'));
        }
      } else if (options.write && !options.prune && summary.unusedKeys.length) {
        console.log(chalk.gray(`\n  Note: ${summary.unusedKeys.length} unused key(s) were not removed. Use --prune to remove them.`));
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

async function handleAutoRenameSuspicious(
  summary: SyncSummary,
  options: SyncCommandOptions,
  config: Awaited<ReturnType<typeof loadConfig>>
) {
  console.log(chalk.blue('\n📝 Auto-rename suspicious keys analysis:'));

  // Get existing keys from locale data to check for conflicts
  const localesDir = path.resolve(process.cwd(), config.localesDir ?? 'locales');
  const localeStore = new LocaleStore(localesDir, {
    sortKeys: config.locales?.sortKeys ?? 'alphabetical',
  });
  const sourceLocale = config.sourceLanguage ?? 'en';
  const sourceData = await localeStore.get(sourceLocale);
  const existingKeys = new Set(Object.keys(sourceData));

  // Generate rename proposals
  const namingConvention = options.namingConvention ?? 'kebab-case';
  const report = generateRenameProposals(summary.suspiciousKeys, {
    existingKeys,
    namingConvention,
  });

  // Print summary
  console.log(`  Found ${report.totalSuspicious} suspicious key(s)`);

  if (report.safeProposals.length > 0) {
    console.log(chalk.green(`\n  ✓ Safe rename proposals (${report.safeProposals.length}):`));
    const toShow = report.safeProposals.slice(0, 10);
    for (const proposal of toShow) {
      console.log(chalk.gray(`    "${proposal.originalKey}" → "${proposal.proposedKey}"`));
      console.log(chalk.gray(`      (${proposal.reason}) in ${proposal.filePath}:${proposal.position.line}`));
    }
    if (report.safeProposals.length > 10) {
      console.log(chalk.gray(`    ...and ${report.safeProposals.length - 10} more`));
    }
  }

  if (report.conflictProposals.length > 0) {
    console.log(chalk.yellow(`\n  ⚠️  Conflicting proposals (${report.conflictProposals.length}):`));
    const toShow = report.conflictProposals.slice(0, 5);
    for (const proposal of toShow) {
      console.log(chalk.yellow(`    "${proposal.originalKey}" → "${proposal.proposedKey}"`));
      console.log(chalk.gray(`      Conflicts with: ${proposal.conflictsWith}`));
    }
    if (report.conflictProposals.length > 5) {
      console.log(chalk.gray(`    ...and ${report.conflictProposals.length - 5} more`));
    }
  }

  if (report.skippedKeys.length > 0) {
    console.log(chalk.gray(`\n  Skipped ${report.skippedKeys.length} key(s) (already normalized or no change needed)`));
  }

  // Write mapping file if requested
  if (options.renameMapFile && Object.keys(report.renameMapping).length > 0) {
    const outputPath = path.resolve(process.cwd(), options.renameMapFile);
    const isJsonFormat = outputPath.endsWith('.json');
    const content = createRenameMappingFile(report.renameMapping, {
      includeComments: !isJsonFormat,
    });
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, content, 'utf8');
    console.log(chalk.green(`\n  ✓ Rename mapping written to ${outputPath}`));
    console.log(chalk.gray('    Apply with: npx i18nsmith rename-keys --map ' + options.renameMapFile + ' --write'));
  }

  // If --write is set and there are safe proposals, offer to apply them
  if (options.write && report.safeProposals.length > 0) {
    console.log(chalk.yellow('\n  Note: Use --rename-map-file to export the mapping, then apply with rename-keys --map'));
    console.log(chalk.gray('    This two-step process allows you to review and edit the mappings before applying.'));
  } else if (Object.keys(report.renameMapping).length > 0 && !options.renameMapFile) {
    console.log(chalk.gray('\n  Use --rename-map-file <path> to export mappings for later application.'));
  }
}

async function handleRewriteShape(
  options: SyncCommandOptions,
  config: Awaited<ReturnType<typeof loadConfig>>
) {
  const targetFormat = options.rewriteShape as 'flat' | 'nested';
  const delimiter = options.shapeDelimiter ?? '.';

  console.log(chalk.blue(`\n🔄 Rewriting locale files to ${targetFormat} format...`));

  const localesDir = path.resolve(process.cwd(), config.localesDir ?? 'locales');
  const localeStore = new LocaleStore(localesDir, {
    delimiter,
    sortKeys: config.locales?.sortKeys ?? 'alphabetical',
  });

  // Load all configured locales
  const sourceLocale = config.sourceLanguage ?? 'en';
  const targetLocales = config.targetLanguages ?? [];
  const allLocales = [sourceLocale, ...targetLocales];

  for (const locale of allLocales) {
    await localeStore.get(locale); // Load into cache
  }

  // Rewrite all locales to the target format
  const stats = await localeStore.rewriteShape(targetFormat, { delimiter });

  if (stats.length === 0) {
    console.log(chalk.yellow('  No locale files found to rewrite.'));
    return;
  }

  console.log(chalk.green(`  ✓ Rewrote ${stats.length} locale file(s) to ${targetFormat} format:`));
  for (const stat of stats) {
    console.log(chalk.gray(`    • ${stat.locale}: ${stat.totalKeys} keys`));
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

// ─────────────────────────────────────────────────────────────────────────────
// Backup Commands
// ─────────────────────────────────────────────────────────────────────────────

program
  .command('backup-list')
  .description('List available locale file backups')
  .option('--backup-dir <path>', 'Custom backup directory (default: .i18nsmith-backup)')
  .action(async (options: { backupDir?: string }) => {
    try {
      const workspaceRoot = process.cwd();
      const backups = await listBackups(workspaceRoot, { backupDir: options.backupDir });

      if (backups.length === 0) {
        console.log(chalk.yellow('No backups found.'));
        console.log(chalk.gray('Backups are created automatically when using --write --prune'));
        return;
      }

      console.log(chalk.blue(`Found ${backups.length} backup(s):\n`));

      for (const backup of backups) {
        const date = new Date(backup.createdAt);
        const formattedDate = date.toLocaleString();
        console.log(`  ${chalk.cyan(backup.timestamp)}  ${formattedDate}  (${backup.fileCount} files)`);
      }

      console.log(chalk.gray(`\nRestore a backup with: i18nsmith backup-restore <timestamp>`));
    } catch (err) {
      console.error(chalk.red('Error listing backups:'), err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

program
  .command('backup-restore')
  .description('Restore locale files from a previous backup')
  .argument('<timestamp>', 'Backup timestamp (from backup-list) or "latest" for most recent')
  .option('--backup-dir <path>', 'Custom backup directory (default: .i18nsmith-backup)')
  .action(async (timestamp: string, options: { backupDir?: string }) => {
    try {
      const workspaceRoot = process.cwd();
      const backups = await listBackups(workspaceRoot, { backupDir: options.backupDir });

      if (backups.length === 0) {
        console.error(chalk.red('No backups found.'));
        process.exitCode = 1;
        return;
      }

      let targetBackup = timestamp === 'latest'
        ? backups[0]
        : backups.find((b) => b.timestamp === timestamp);

      if (!targetBackup) {
        console.error(chalk.red(`Backup not found: ${timestamp}`));
        console.log(chalk.gray('Available backups:'));
        for (const b of backups.slice(0, 5)) {
          console.log(`  ${b.timestamp}`);
        }
        process.exitCode = 1;
        return;
      }

      // Confirm restore
      const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
        {
          type: 'confirm',
          name: 'confirmed',
          message: `Restore ${targetBackup.fileCount} locale files from backup ${targetBackup.timestamp}? This will overwrite current locale files.`,
          default: false,
        },
      ]);

      if (!confirmed) {
        console.log(chalk.yellow('Restore cancelled.'));
        return;
      }

      const result = await restoreBackup(targetBackup.path, workspaceRoot);

      console.log(chalk.green(`\n✅ ${result.summary}`));
      for (const file of result.restored) {
        console.log(chalk.gray(`   Restored: ${file}`));
      }
    } catch (err) {
      console.error(chalk.red('Error restoring backup:'), err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
  });

program
  .command('rename-key')
  .description('Rename translation keys across source files and locale JSON')
  .argument('<oldKey>', 'Existing translation key')
  .argument('<newKey>', 'Replacement translation key')
  .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
  .option('--json', 'Print raw JSON results', false)
  .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
  .option('--write', 'Write changes to disk (defaults to dry-run)', false)
  .action(async (oldKey: string, newKey: string, options: ScanOptions & { write?: boolean }) => {
    console.log(chalk.blue(options.write ? 'Renaming translation key...' : 'Planning key rename (dry-run)...'));

    try {
      const config = await loadConfig(options.config);
      const renamer = new KeyRenamer(config);
      const summary = await renamer.rename(oldKey, newKey, { write: options.write });

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
  .option('--report <path>', 'Write JSON summary to a file (for CI or editors)')
  .option('--write', 'Write changes to disk (defaults to dry-run)', false)
  .option('--diff', 'Display unified diffs for files that would change', false)
  .action(async (options: RenameMapOptions) => {
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
