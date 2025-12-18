import { Command } from 'commander';
import chalk from 'chalk';
import inquirer, { type CheckboxQuestion } from 'inquirer';
import { promises as fs } from 'fs';
import path from 'path';
import {
  Syncer,
  KeyRenamer,
  LocaleStore,
  loadConfig,
  loadConfigWithMeta,
  generateRenameProposals,
  createRenameMappingFile,
  type SyncSummary,
  type KeyRenameBatchSummary,
  type SyncSelection,
} from '@i18nsmith/core';
import {
  printLocaleDiffs,
  writeLocaleDiffPatches,
} from '../utils/diff-utils.js';
import { applyPreviewFile, writePreviewFile } from '../utils/preview.js';
import { SYNC_EXIT_CODES } from '../utils/exit-codes.js';

interface SyncCommandOptions {
  config?: string;
  json?: boolean;
  target?: string[];
  report?: string;
  listFiles?: boolean;
  include?: string[];
  exclude?: string[];
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
  previewOutput?: string;
  selectionFile?: string;
  applyPreview?: string;
}

function collectAssumedKeys(value: string, previous: string[] = []) {
  return previous.concat(value.split(',').map((k) => k.trim()));
}

function collectTargetPatterns(value: string, previous: string[] = []) {
  return previous.concat(value);
}

export function registerSync(program: Command) {
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
    .option('--preview-output <path>', 'Write preview summary (JSON) to a file (implies dry-run)')
    .option('--selection-file <path>', 'Path to JSON file with selected missing/unused keys to write (used with --write)')
    .option('--apply-preview <path>', 'Apply a previously saved sync preview JSON file safely')
    .action(async (options: SyncCommandOptions) => {
      if (options.applyPreview) {
        const extraArgs: string[] = [];
        if (options.selectionFile) {
          extraArgs.push('--selection-file', options.selectionFile);
        }
        if (options.prune) {
          extraArgs.push('--prune');
        }
        if (options.yes) {
          extraArgs.push('--yes');
        }
        if (options.seedTargetLocales) {
          extraArgs.push('--seed-target-locales');
        }
        if (options.seedValue) {
          extraArgs.push('--seed-value', options.seedValue);
        }
        await applyPreviewFile('sync', options.applyPreview, extraArgs);
        return;
      }

      const interactive = Boolean(options.interactive);
      const diffEnabled = Boolean(options.diff || options.patchDir);
      const invalidateCache = Boolean(options.invalidateCache);
      const previewMode = Boolean(options.previewOutput);
      const diffRequested = diffEnabled || Boolean(options.json) || previewMode;

      if (interactive && options.json) {
        console.error(chalk.red('--interactive cannot be combined with --json output.'));
        process.exitCode = 1;
        return;
      }

      if (previewMode && interactive) {
        console.error(chalk.red('--preview-output cannot be combined with --interactive.'));
        process.exitCode = 1;
        return;
      }

      const writeEnabled = Boolean(options.write) && !previewMode;
      if (previewMode && options.write) {
        console.log(
          chalk.yellow('Preview requested; ignoring --write and running in dry-run mode.')
        );
      }
      options.write = writeEnabled;

      if (options.selectionFile && !options.write) {
        console.error(chalk.red('--selection-file requires --write (or --apply-preview) to take effect.'));
        process.exitCode = 1;
        return;
      }

      const selectionFromFile = options.selectionFile
        ? await loadSelectionFile(options.selectionFile)
        : undefined;

      const banner = previewMode
        ? 'Generating sync preview...'
        : interactive
        ? 'Interactive sync (dry-run first)...'
        : writeEnabled
        ? 'Syncing locale files...'
        : 'Checking locale drift...';
      console.log(chalk.blue(banner));

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
          selection: selectionFromFile,
          diff: diffRequested,
          invalidateCache,
          targets: options.target,
        });

        // If previewing with auto-rename, calculate the rename diffs and include them
        if (previewMode && options.autoRenameSuspicious && summary.suspiciousKeys.length > 0) {
          const localesDir = path.resolve(process.cwd(), config.localesDir ?? 'locales');
          const localeStore = new LocaleStore(localesDir, {
            sortKeys: config.locales?.sortKeys ?? 'alphabetical',
          });
          const sourceLocale = config.sourceLanguage ?? 'en';
          const sourceData = await localeStore.get(sourceLocale);
          const existingKeys = new Set(Object.keys(sourceData));

          const namingConvention = options.namingConvention ?? 'kebab-case';
          const report = generateRenameProposals(summary.suspiciousKeys, {
            existingKeys,
            namingConvention,
            workspaceRoot: projectRoot,
            allowExistingConflicts: true,
          });

          if (report.safeProposals.length > 0) {
            const mappings = report.safeProposals.map((proposal) => ({
              from: proposal.originalKey,
              to: proposal.proposedKey,
            }));

            const renamer = new KeyRenamer(config, { workspaceRoot: projectRoot });
            // Run rename batch in dry-run mode with diffs
            const batchSummary = await renamer.renameBatch(mappings, {
              write: false,
              diff: true,
              allowConflicts: true,
            });
            
            // Merge rename diffs into summary
            summary.renameDiffs = batchSummary.diffs;
            
            // Merge locale diffs if any (renamer returns localeDiffs)
            if (batchSummary.localeDiffs && batchSummary.localeDiffs.length > 0) {
              summary.localeDiffs = [
                ...(summary.localeDiffs || []),
                ...batchSummary.localeDiffs
              ];
              // Also update main diffs array if it's used for preview
              summary.diffs = [
                ...(summary.diffs || []),
                ...batchSummary.localeDiffs
              ];
            }
          }
        }

        if (previewMode && options.previewOutput) {
          const savedPath = await writePreviewFile('sync', summary, options.previewOutput);
          console.log(chalk.green(`Preview written to ${path.relative(process.cwd(), savedPath)}`));
        }

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
          await handleAutoRenameSuspicious(summary, options, config, projectRoot);
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
}

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
  config: Awaited<ReturnType<typeof loadConfig>>,
  projectRoot: string
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
    allowExistingConflicts: true,
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
  const hasMappings = Object.keys(report.renameMapping).length > 0;

  if (options.renameMapFile && hasMappings) {
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

  if (options.write) {
    if (report.safeProposals.length === 0) {
      console.log(chalk.yellow('\n  No safe rename proposals to apply.'));
    } else {
      console.log(chalk.blue('\n✍️  Applying safe rename proposals (source + locales)...'));
      const mappings = report.safeProposals.map((proposal) => ({
        from: proposal.originalKey,
        to: proposal.proposedKey,
      }));

      const renamer = new KeyRenamer(config, { workspaceRoot: projectRoot });
      const applySummary = await renamer.renameBatch(mappings, {
        write: true,
        diff: Boolean(options.diff),
        allowConflicts: true,
      });
      printRenameBatchSummary(applySummary);

      if (!options.renameMapFile && hasMappings) {
        const defaultMapPath = path.resolve(projectRoot, '.i18nsmith', 'auto-rename-map.json');
        await fs.mkdir(path.dirname(defaultMapPath), { recursive: true });
        await fs.writeFile(defaultMapPath, JSON.stringify(report.renameMapping, null, 2));
        console.log(
          chalk.gray(
            `\n  Saved rename mapping to ${path.relative(process.cwd(), defaultMapPath)} (set --rename-map-file to customize)`
          )
        );
      }
    }
  } else if (hasMappings && !options.renameMapFile) {
    console.log(chalk.gray('\n  Use --rename-map-file <path> to export mappings for later application.'));
    console.log(chalk.gray('  Run with --write to apply safe proposals automatically.'));
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

async function loadSelectionFile(filePath: string): Promise<SyncSelection> {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  let raw: string;
  try {
    raw = await fs.readFile(resolvedPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read selection file at ${resolvedPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Selection file ${resolvedPath} contains invalid JSON: ${message}`);
  }

  const selection: SyncSelection = {};
  const missing = (parsed as { missing?: unknown }).missing;
  const unused = (parsed as { unused?: unknown }).unused;

  if (Array.isArray(missing)) {
    const normalized = missing.map((key) => String(key).trim()).filter(Boolean);
    if (normalized.length) {
      selection.missing = normalized;
    }
  }

  if (Array.isArray(unused)) {
    const normalized = unused.map((key) => String(key).trim()).filter(Boolean);
    if (normalized.length) {
      selection.unused = normalized;
    }
  }

  if (!selection.missing?.length && !selection.unused?.length) {
    throw new Error(`Selection file ${resolvedPath} must include at least one "missing" or "unused" entry.`);
  }

  return selection;
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
