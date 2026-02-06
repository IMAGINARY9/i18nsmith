/**
 * Adapter preflight utilities for CLI commands.
 * Validates framework adapter dependencies before write operations.
 */

import { AdapterRegistry } from '@i18nsmith/core';
import chalk from 'chalk';
import { CliError } from './errors.js';

interface PreflightResult {
  hasMissingDeps: boolean;
  missingDeps: Array<{
    adapter: string;
    dependency: string;
    installHint: string;
  }>;
}

/**
 * Run preflight checks for all registered framework adapters.
 * Throws an error if any required dependencies are missing.
 */
export async function runAdapterPreflight(): Promise<void> {
  const registry = new AdapterRegistry();
  const results = registry.preflightCheck();

  const missingDeps: PreflightResult['missingDeps'] = [];

  for (const [adapterId, checks] of results) {
    for (const check of checks) {
      if (!check.available) {
        missingDeps.push({
          adapter: adapterId,
          dependency: check.name,
          installHint: check.installHint,
        });
      }
    }
  }

  if (missingDeps.length > 0) {
    console.error(chalk.red('❌ Missing framework adapter dependencies:'));
    for (const dep of missingDeps) {
      console.error(chalk.red(`  - ${dep.adapter}: ${dep.dependency}`));
      console.error(chalk.gray(`    Install: ${dep.installHint}`));
    }
    console.error('');
    console.error(chalk.yellow('Please install the missing dependencies before running write operations.'));
    throw new CliError('Framework adapter dependencies are missing. Install them and try again.');
  }

  console.log(chalk.green('✅ Framework adapter dependencies are available'));
}