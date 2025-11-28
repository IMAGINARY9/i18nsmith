import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  loadConfig,
  LocaleStore,
  KeyValidator,
  LocaleValidator,
  SUSPICIOUS_KEY_REASON_DESCRIPTIONS,
} from '@i18nsmith/core';

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
}
