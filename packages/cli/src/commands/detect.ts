import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import {
  ProjectIntelligenceService,
  type ProjectIntelligence,
  type ConfidenceLevel,
} from '@i18nsmith/core';
import { withErrorHandling } from '../utils/errors.js';

interface DetectOptions {
  json?: boolean;
  report?: string;
  verbose?: boolean;
  showConfig?: boolean;
}

/**
 * Get colored confidence indicator based on level
 */
function getConfidenceIndicator(level: ConfidenceLevel): string {
  switch (level) {
    case 'high':
      return chalk.green('●');
    case 'medium':
      return chalk.yellow('●');
    case 'low':
      return chalk.red('●');
    case 'uncertain':
    default:
      return chalk.gray('○');
  }
}

/**
 * Format percentage for display
 */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Print framework detection results
 */
function printFrameworkDetection(result: ProjectIntelligence, verbose: boolean) {
  console.log(chalk.blue('\n📦 Framework Detection'));

  const { framework, confidence } = result;
  const level = getConfidenceLevel(confidence.framework);
  const indicator = getConfidenceIndicator(level);

  if (framework.type === 'unknown') {
    console.log(chalk.yellow('  • No framework detected'));
  } else {
    console.log(`  ${indicator} Framework: ${chalk.bold(framework.type)}`);

    if (framework.adapter) {
      console.log(`     i18n Adapter: ${chalk.cyan(framework.adapter)}`);
    }

    if (framework.routerType && framework.routerType !== 'unknown') {
      console.log(`     Router: ${chalk.cyan(framework.routerType)} router`);
    }

    console.log(`     Confidence: ${formatPercent(confidence.framework)}`);
  }

  if (verbose && framework.evidence.length > 0) {
    console.log(chalk.gray('\n  Evidence:'));
    for (const evidence of framework.evidence) {
      const sourceLabel = evidence.type === 'package' ? '📦' : '📄';
      console.log(chalk.gray(`    ${sourceLabel} ${evidence.description} (weight: ${evidence.weight})`));
    }
  }
}

/**
 * Get confidence level from score
 */
function getConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 0.8) return 'high';
  if (score >= 0.5) return 'medium';
  if (score >= 0.3) return 'low';
  return 'uncertain';
}

/**
 * Print file patterns detection results
 */
function printFilePatterns(result: ProjectIntelligence, verbose: boolean) {
  console.log(chalk.blue('\n📂 File Patterns'));

  const { filePatterns, confidence } = result;
  const level = getConfidenceLevel(confidence.filePatterns);
  const indicator = getConfidenceIndicator(level);

  console.log(`  ${indicator} Source directories:`);
  for (const dir of filePatterns.sourceDirectories) {
    console.log(`     • ${chalk.cyan(dir)}`);
  }

  const extensions: string[] = [];
  if (filePatterns.hasTypeScript) extensions.push('.ts', '.tsx');
  if (filePatterns.hasJsx && !filePatterns.hasTypeScript) extensions.push('.jsx');
  if (filePatterns.hasVue) extensions.push('.vue');
  if (filePatterns.hasSvelte) extensions.push('.svelte');
  if (extensions.length === 0) extensions.push('.js');

  console.log(`  ${indicator} Extensions: ${extensions.map((e: string) => chalk.cyan(e)).join(', ')}`);
  console.log(`     Files: ~${filePatterns.sourceFileCount} source files`);
  console.log(`     Confidence: ${formatPercent(confidence.filePatterns)}`);

  if (verbose) {
    console.log(chalk.gray('\n  Suggested include patterns:'));
    for (const pattern of filePatterns.include) {
      console.log(chalk.gray(`    + ${pattern}`));
    }

    console.log(chalk.gray('\n  Suggested exclude patterns:'));
    for (const pattern of filePatterns.exclude.slice(0, 5)) {
      console.log(chalk.gray(`    - ${pattern}`));
    }
    if (filePatterns.exclude.length > 5) {
      console.log(chalk.gray(`    ... and ${filePatterns.exclude.length - 5} more`));
    }
  }
}

/**
 * Print locale detection results
 */
function printLocaleDetection(result: ProjectIntelligence, verbose: boolean) {
  console.log(chalk.blue('\n🌍 Locale Detection'));

  const { locales, confidence } = result;
  const level = getConfidenceLevel(confidence.locales);
  const indicator = getConfidenceIndicator(level);

  if (locales.existingFiles.length === 0) {
    console.log(chalk.yellow('  • No existing locale files detected'));
    return;
  }

  console.log(`  ${indicator} Locales directory: ${chalk.cyan(locales.localesDir || 'N/A')}`);
  console.log(`     Format: ${chalk.cyan(locales.format)}`);
  console.log(`     Source locale: ${chalk.cyan(locales.sourceLanguage || 'en')}`);

  const allLangs = [locales.sourceLanguage, ...locales.targetLanguages].filter(Boolean);
  console.log(`     Languages: ${allLangs.map((l: string) => chalk.cyan(l)).join(', ')}`);
  console.log(`     Total keys: ${locales.existingKeyCount}`);
  console.log(`     Confidence: ${formatPercent(confidence.locales)}`);

  if (verbose && locales.existingFiles.length > 0) {
    console.log(chalk.gray('\n  Locale files:'));
    for (const file of locales.existingFiles.slice(0, 10)) {
      const relativePath = file.path.includes('/') ? file.path.split('/').slice(-2).join('/') : file.path;
      console.log(chalk.gray(`    • ${file.locale}: ${relativePath} (${file.keyCount} keys)`));
    }
    if (locales.existingFiles.length > 10) {
      console.log(chalk.gray(`    ... and ${locales.existingFiles.length - 10} more files`));
    }
  }
}

/**
 * Print existing setup detection results
 */
function printExistingSetup(result: ProjectIntelligence, verbose: boolean) {
  const { existingSetup, confidence } = result;

  if (!existingSetup.hasExistingConfig && existingSetup.runtimePackages.length === 0) {
    return;
  }

  console.log(chalk.blue('\n⚙️ Existing i18n Setup'));

  const level = getConfidenceLevel(confidence.existingSetup);
  const indicator = getConfidenceIndicator(level);

  if (existingSetup.hasExistingConfig && existingSetup.configPath) {
    console.log(`  ${indicator} Existing config: ${chalk.cyan(existingSetup.configPath)}`);
  }

  for (const pkg of existingSetup.runtimePackages) {
    console.log(`  ${indicator} ${chalk.cyan(pkg.name)}@${pkg.version || 'latest'}`);
  }

  if (existingSetup.translationUsage) {
    const usage = existingSetup.translationUsage;
    console.log(`     Hook: ${usage.hookName}() (${usage.filesWithHooks} files)`);
    console.log(`     t() calls: ${usage.translationCalls} across ${usage.filesWithHooks} files`);
  }

  if (verbose && existingSetup.hasI18nProvider && existingSetup.providerPath) {
    console.log(chalk.gray(`\n  Provider: ${existingSetup.providerPath}`));
  }
}

/**
 * Print overall confidence summary
 */
function printConfidenceSummary(result: ProjectIntelligence) {
  console.log(chalk.blue('\n📊 Overall Confidence'));

  const { confidence } = result;
  const indicator = getConfidenceIndicator(confidence.level);

  console.log(`  ${indicator} Overall: ${chalk.bold(formatPercent(confidence.overall))} (${confidence.level})`);

  // Visual bar
  const barLength = 30;
  const filledLength = Math.round(confidence.overall * barLength);
  const emptyLength = barLength - filledLength;
  const bar = chalk.green('█'.repeat(filledLength)) + chalk.gray('░'.repeat(emptyLength));
  console.log(`     ${bar}`);
}

/**
 * Print warnings if any
 */
function printWarnings(result: ProjectIntelligence) {
  if (result.warnings.length === 0) {
    return;
  }

  console.log(chalk.blue('\n⚠️ Warnings'));
  for (const warning of result.warnings) {
    const label =
      warning.severity === 'error'
        ? chalk.red('ERROR')
        : warning.severity === 'warn'
          ? chalk.yellow('WARN')
          : chalk.cyan('INFO');
    console.log(`  • [${label}] ${warning.message}`);
    if (warning.suggestion) {
      console.log(chalk.gray(`    → ${warning.suggestion}`));
    }
  }
}

/**
 * Print suggested configuration
 */
function printSuggestedConfig(result: ProjectIntelligence) {
  console.log(chalk.blue('\n📝 Suggested Configuration'));

  const { suggestedConfig } = result;

  console.log(`  Source Language: ${chalk.cyan(suggestedConfig.sourceLanguage)}`);
  if (suggestedConfig.targetLanguages.length > 0) {
    console.log(`  Target Languages: ${suggestedConfig.targetLanguages.map((l: string) => chalk.cyan(l)).join(', ')}`);
  }
  console.log(`  Locales Dir: ${chalk.cyan(suggestedConfig.localesDir)}`);
  console.log(`  Adapter: ${chalk.cyan(suggestedConfig.translationAdapter.module)}`);
  console.log(`  Hook: ${chalk.cyan(suggestedConfig.translationAdapter.hookName)}`);
}

/**
 * Print full config preview as JSON
 */
function printConfigPreview(result: ProjectIntelligence) {
  console.log(chalk.blue('\n🔧 Full Config Preview'));

  const config = {
    localesDir: result.suggestedConfig.localesDir,
    defaultLocale: result.suggestedConfig.sourceLanguage,
    locales: [result.suggestedConfig.sourceLanguage, ...result.suggestedConfig.targetLanguages],
    include: result.suggestedConfig.include,
    exclude: result.suggestedConfig.exclude,
    adapter: result.suggestedConfig.translationAdapter.module,
    translationFunctionName: result.suggestedConfig.translationAdapter.hookName,
  };

  console.log(chalk.gray(JSON.stringify(config, null, 2)));
}

/**
 * Print recommendations if any
 */
function printRecommendations(result: ProjectIntelligence) {
  if (result.recommendations.length === 0) {
    return;
  }

  console.log(chalk.blue('\n💡 Recommendations'));
  for (const rec of result.recommendations) {
    console.log(`  • ${rec}`);
  }
}

export function registerDetect(program: Command) {
  program
    .command('detect')
    .description('Detect project configuration automatically')
    .option('--json', 'Output results as JSON', false)
    .option('--report <path>', 'Write JSON report to a file')
    .option('-v, --verbose', 'Show detailed evidence and suggestions', false)
    .option('--show-config', 'Show full suggested configuration', false)
    .action(
      withErrorHandling(async (options: DetectOptions) => {
        const workspaceRoot = process.cwd();

        console.log(chalk.blue('🔍 Analyzing project...'));
        console.log(chalk.gray(`   Working directory: ${workspaceRoot}\n`));

        const service = new ProjectIntelligenceService();
        const result = await service.analyze({ workspaceRoot });

        // JSON output
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Write report file
        if (options.report) {
          const outputPath = path.resolve(workspaceRoot, options.report);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });
          await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
          console.log(chalk.green(`Report written to ${outputPath}\n`));
        }

        // Pretty print results
        printFrameworkDetection(result, options.verbose ?? false);
        printFilePatterns(result, options.verbose ?? false);
        printLocaleDetection(result, options.verbose ?? false);
        printExistingSetup(result, options.verbose ?? false);
        printConfidenceSummary(result);
        printWarnings(result);
        printSuggestedConfig(result);
        printRecommendations(result);

        if (options.showConfig) {
          printConfigPreview(result);
        }

        // Helpful tip
        console.log(chalk.gray('\n💡 Tip: Run `i18nsmith init` to generate configuration based on this analysis.'));
      })
    );
}
