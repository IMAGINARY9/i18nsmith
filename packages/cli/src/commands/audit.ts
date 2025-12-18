import chalk from 'chalk';
import type { Command } from 'commander';
import { runCheck } from './check.js';

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
      console.log(chalk.yellow('⚠️  "i18nsmith audit" is deprecated. Proxying to "i18nsmith check --audit"...'));
      await runCheck({
        config: options.config,
        json: options.json,
        report: options.report,
        audit: true,
        auditStrict: options.strict,
        auditLocales: options.locale,
        auditDuplicates: options.duplicates,
        auditInconsistent: options.inconsistent,
        auditOrphaned: options.orphaned,
      });
    });
}
