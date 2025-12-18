import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig, diagnoseWorkspace } from '@i18nsmith/core';
import type { DiagnosisReport } from '@i18nsmith/core';
import { getDiagnosisExitSignal } from '../utils/diagnostics-exit.js';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface DiagnoseCommandOptions {
  config?: string;
  json?: boolean;
  report?: string;
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

export function registerDiagnose(program: Command) {
  program
    .command('diagnose')
    .description('Detect existing i18n assets and potential merge conflicts')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON report to a file (for CI or editors)')
    .action(
      withErrorHandling(async (options: DiagnoseCommandOptions) => {
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
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Diagnose failed: ${message}`);
        }
      })
    );
}
