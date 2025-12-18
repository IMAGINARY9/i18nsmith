import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfig } from '@i18nsmith/core';
import { runLocaleAudit, printLocaleAuditResults, hasAuditFindings } from '../utils/locale-audit.js';

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

export function registerAudit(program: Command) {
  program
    .command('audit')
    .description('Audit locale files for suspicious keys, key=value patterns, and quality issues')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('-l, --locale <locales...>', 'Specific locale(s) to audit (defaults to all)')
    .option('--json', 'Print raw JSON results', false)
    .option('--report <path>', 'Write JSON report to a file')
    .option('--strict', 'Exit with error code if any issues found', false)
    .option('--duplicates', 'Check for duplicate values (consolidation opportunities)', false)
    .option('--inconsistent', 'Detect inconsistent key naming patterns', false)
    .option('--orphaned', 'Detect orphaned namespaces that only contain a few keys', false)
    .action(async (options: AuditCommandOptions) => {
      console.log(chalk.yellow('⚠️  "i18nsmith audit" is deprecated. Use "i18nsmith check --audit" instead.'));
      try {
        const config = await loadConfig(options.config);
        const projectRoot = process.cwd();

        const summary = await runLocaleAudit(
          { config, projectRoot },
          {
            locales: options.locale,
            checkDuplicates: options.duplicates,
            checkInconsistent: options.inconsistent,
            checkOrphaned: options.orphaned,
          }
        );

        const payload = {
          results: summary.results,
          totalIssues: summary.totalIssues,
          totalQualityIssues: summary.totalQualityIssues,
        };

        if (options.report) {
          const outputPath = path.resolve(projectRoot, options.report);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, JSON.stringify(payload, null, 2));
          console.log(chalk.green(`Audit report written to ${outputPath}`));
        }

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          printLocaleAuditResults(summary);
        }

        if (options.strict && hasAuditFindings(summary)) {
          console.error(chalk.red(`\nAudit failed with issues. Use --strict=false to allow.`));
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(chalk.red('Audit failed:'), (error as Error).message);
        process.exitCode = 1;
      }
    });
}
