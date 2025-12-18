import path from 'path';
import chalk from 'chalk';
import {
  LocaleStore,
  KeyValidator,
  LocaleValidator,
  SUSPICIOUS_KEY_REASON_DESCRIPTIONS,
  type I18nConfig,
} from '@i18nsmith/core';

export interface AuditIssue {
  key: string;
  value: string;
  reason: string;
  description: string;
  suggestion?: string;
}

export interface QualityIssue {
  type: 'duplicate-value' | 'inconsistent-key' | 'orphaned-namespace';
  description: string;
  keys?: string[];
  suggestion?: string;
}

export interface LocaleAuditResult {
  locale: string;
  totalKeys: number;
  issues: AuditIssue[];
  qualityIssues: QualityIssue[];
}

export interface LocaleAuditSummary {
  results: LocaleAuditResult[];
  totalIssues: number;
  totalQualityIssues: number;
}

export interface LocaleAuditContext {
  config: I18nConfig;
  projectRoot: string;
}

export interface LocaleAuditOptions {
  locales?: string[];
  checkDuplicates?: boolean;
  checkInconsistent?: boolean;
  checkOrphaned?: boolean;
}

export async function runLocaleAudit(
  context: LocaleAuditContext,
  options: LocaleAuditOptions = {}
): Promise<LocaleAuditSummary> {
  const { config, projectRoot } = context;
  const localesDir = path.resolve(projectRoot, config.localesDir ?? 'locales');
  const localeStore = new LocaleStore(localesDir, {
    sortKeys: config.locales?.sortKeys ?? 'alphabetical',
  });
  const keyValidator = new KeyValidator(config.sync?.suspiciousKeyPolicy ?? 'skip');
  const localeValidator = new LocaleValidator({
    delimiter: config.locales?.delimiter ?? '.',
  });

  let localesToAudit = options.locales?.filter(Boolean) ?? [];
  if (localesToAudit.length === 0) {
    const source = config.sourceLanguage ?? 'en';
    const targets = config.targetLanguages ?? [];
    localesToAudit = [source, ...targets];
  }

  // Ensure unique locales while preserving order
  localesToAudit = localesToAudit.filter((locale, index) => localesToAudit.indexOf(locale) === index);

  const runQualityChecks =
    Boolean(options.checkDuplicates) || Boolean(options.checkInconsistent) || Boolean(options.checkOrphaned);
  const checkDuplicates =
    typeof options.checkDuplicates === 'boolean' ? options.checkDuplicates : !runQualityChecks;
  const checkInconsistent = Boolean(options.checkInconsistent);
  const checkOrphaned = Boolean(options.checkOrphaned);

  const results: LocaleAuditResult[] = [];
  const allKeys = new Set<string>();

  // First pass: collect all keys
  for (const locale of localesToAudit) {
    const data = await localeStore.get(locale);
    for (const key of Object.keys(data)) {
      allKeys.add(key);
    }
  }

  for (const locale of localesToAudit) {
    const data = await localeStore.get(locale);
    const keys = Object.keys(data);
    const issues: AuditIssue[] = [];
    const qualityIssues: QualityIssue[] = [];

    for (const key of keys) {
      const value = data[key];
      const analysis = keyValidator.analyzeWithValue(key, value);
      if (analysis.suspicious && analysis.reason) {
        issues.push({
          key,
          value: value.length > 50 ? `${value.slice(0, 47)}...` : value,
          reason: analysis.reason,
          description:
            SUSPICIOUS_KEY_REASON_DESCRIPTIONS[analysis.reason] ?? 'Unknown issue',
          suggestion: keyValidator.suggestFix(key, analysis.reason),
        });
      }
    }

    if (checkDuplicates) {
      const duplicates = localeValidator.detectDuplicateValues(locale, data);
      for (const dup of duplicates) {
        const preview = dup.value.slice(0, 40);
        const label = dup.value.length > 40 ? `${preview}...` : preview;
        qualityIssues.push({
          type: 'duplicate-value',
          description: `Value "${label}" used by ${dup.keys.length} keys`,
          keys: dup.keys,
          suggestion: 'Consider consolidating to a single key',
        });
      }
    }

    if (checkInconsistent && locale === localesToAudit[0]) {
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

  return {
    results,
    totalIssues,
    totalQualityIssues,
  };
}

export function printLocaleAuditResults(summary: LocaleAuditSummary) {
  for (const result of summary.results) {
    const hasIssues = result.issues.length > 0 || result.qualityIssues.length > 0;
    if (!hasIssues) {
      console.log(chalk.green(`✓ ${result.locale}.json: ${result.totalKeys} keys, no issues`));
      continue;
    }

    console.log(chalk.yellow(`⚠ ${result.locale}.json: ${result.totalKeys} keys`));

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

    if (result.qualityIssues.length > 0) {
      console.log(chalk.cyan(`  Quality checks: ${result.qualityIssues.length}`));
      for (const issue of result.qualityIssues) {
        const typeLabel =
          issue.type === 'duplicate-value' ? '📋' : issue.type === 'inconsistent-key' ? '🔀' : '📦';
        console.log(chalk.dim(`    ${typeLabel} ${issue.description}`));
        if (issue.suggestion) {
          console.log(chalk.dim(`       ${issue.suggestion}`));
        }
      }
    }
  }

  console.log();
  if (summary.totalIssues === 0 && summary.totalQualityIssues === 0) {
    console.log(chalk.green('✓ No issues found in locale files'));
  } else {
    if (summary.totalIssues > 0) {
      console.log(chalk.yellow(`Found ${summary.totalIssues} suspicious key(s)`));
    }
    if (summary.totalQualityIssues > 0) {
      console.log(chalk.cyan(`Found ${summary.totalQualityIssues} quality issue(s)`));
    }
  }
}

export function hasAuditFindings(summary: LocaleAuditSummary): boolean {
  return summary.totalIssues > 0 || summary.totalQualityIssues > 0;
}
