/**
 * Preflight check command - validates environment before running i18nsmith operations.
 * This is the onboarding wizard that helps users ensure their setup is correct.
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import fg from 'fast-glob';
import { loadConfigWithMeta, I18nConfig } from '@i18nsmith/core';
import { hasDependency, readPackageJson } from '../utils/pkg.js';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface PreflightResult {
  passed: boolean;
  checks: PreflightCheck[];
}

interface PreflightCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  suggestion?: string;
}

interface PreflightOptions {
  config?: string;
  fix?: boolean;
  json?: boolean;
}

export function registerPreflight(program: Command) {
  program
    .command('preflight')
    .description('Validate i18nsmith setup before running operations (onboarding wizard)')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--fix', 'Attempt to fix issues automatically', false)
    .option('--json', 'Output results as JSON', false)
    .action(
      withErrorHandling(async (options: PreflightOptions) => {
        try {
          const result = await runPreflightChecks(options);

          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            process.exitCode = result.passed ? 0 : 1;
            return;
          }

          printPreflightResults(result);
          process.exitCode = result.passed ? 0 : 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Preflight failed: ${message}`);
        }
      })
    );
}

async function runPreflightChecks(options: PreflightOptions): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const cwd = process.cwd();

  // 1. Check config file exists
  const configCheck = await checkConfigFile(options.config ?? 'i18n.config.json', cwd);
  checks.push(configCheck);

  if (configCheck.status === 'fail') {
    return { passed: false, checks };
  }

  // Load config for remaining checks
  let config: I18nConfig;
  let projectRoot: string;
  try {
    const result = await loadConfigWithMeta(options.config);
    config = result.config;
    projectRoot = result.projectRoot;
  } catch (err) {
    checks.push({
      name: 'Config Parse',
      status: 'fail',
      message: `Failed to parse config: ${(err as Error).message}`,
      suggestion: 'Check that i18n.config.json contains valid JSON',
    });
    return { passed: false, checks };
  }

  // 2. Check include patterns match files
  const includeCheck = await checkIncludePatterns(config, projectRoot);
  checks.push(includeCheck);

  // 3. Check locales directory
  const localesDirCheck = await checkLocalesDir(config, projectRoot, options.fix);
  checks.push(localesDirCheck);

  // 4. Check source locale file
  const sourceLocaleCheck = await checkSourceLocale(config, projectRoot, options.fix);
  checks.push(sourceLocaleCheck);

  // 5. Check adapter dependencies
  const adapterCheck = await checkAdapterDependencies(config, projectRoot);
  checks.push(adapterCheck);

  // 6. Check for write permissions
  const permissionCheck = await checkWritePermissions(config, projectRoot);
  checks.push(permissionCheck);

  // 7. Check for common configuration issues
  const configValidationChecks = await validateConfigOptions(config);
  checks.push(...configValidationChecks);

  const passed = checks.every((c) => c.status !== 'fail');
  return { passed, checks };
}

async function checkConfigFile(configPath: string, cwd: string): Promise<PreflightCheck> {
  const absolutePath = path.isAbsolute(configPath) ? configPath : path.resolve(cwd, configPath);

  try {
    await fs.access(absolutePath);
    return {
      name: 'Config File',
      status: 'pass',
      message: `Found config at ${path.relative(cwd, absolutePath) || configPath}`,
    };
  } catch {
    // Try to find config up the directory tree
    let searchDir = cwd;
    let parentDir = path.dirname(searchDir);
    let found = false;
    let foundPath = '';

    while (searchDir !== parentDir) {
      const testPath = path.join(searchDir, 'i18n.config.json');
      try {
        await fs.access(testPath);
        found = true;
        foundPath = testPath;
        break;
      } catch {
        searchDir = parentDir;
        parentDir = path.dirname(searchDir);
      }
    }

    if (found) {
      return {
        name: 'Config File',
        status: 'warn',
        message: `Config found at ${path.relative(cwd, foundPath)} (not in current directory)`,
        suggestion: 'You may be in a subdirectory. Run commands from the project root or use -c flag.',
      };
    }

    return {
      name: 'Config File',
      status: 'fail',
      message: `Config file not found: ${configPath}`,
      suggestion: 'Run "i18nsmith init" to create a configuration file',
    };
  }
}

async function checkIncludePatterns(config: I18nConfig, projectRoot: string): Promise<PreflightCheck> {
  try {
    const patterns = config.include.map((p) => 
      path.isAbsolute(p) ? p : path.join(projectRoot, p)
    );

    const files = await fg(patterns, {
      ignore: config.exclude ?? [],
      cwd: projectRoot,
      absolute: true,
    });

    if (files.length === 0) {
      return {
        name: 'Source Files',
        status: 'fail',
        message: 'No source files match the include patterns',
        suggestion: `Check your "include" patterns: ${config.include.join(', ')}`,
      };
    }

    return {
      name: 'Source Files',
      status: 'pass',
      message: `Found ${files.length} source file(s) to scan`,
    };
  } catch (err) {
    return {
      name: 'Source Files',
      status: 'fail',
      message: `Error matching include patterns: ${(err as Error).message}`,
    };
  }
}

async function checkLocalesDir(
  config: I18nConfig,
  projectRoot: string,
  autoFix?: boolean
): Promise<PreflightCheck> {
  const localesDir = path.resolve(projectRoot, config.localesDir ?? 'locales');

  try {
    const stats = await fs.stat(localesDir);
    if (!stats.isDirectory()) {
      return {
        name: 'Locales Directory',
        status: 'fail',
        message: `${config.localesDir} exists but is not a directory`,
      };
    }
    return {
      name: 'Locales Directory',
      status: 'pass',
      message: `Locales directory exists: ${config.localesDir}`,
    };
  } catch {
    if (autoFix) {
      try {
        await fs.mkdir(localesDir, { recursive: true });
        return {
          name: 'Locales Directory',
          status: 'pass',
          message: `Created locales directory: ${config.localesDir}`,
        };
      } catch (err) {
        return {
          name: 'Locales Directory',
          status: 'fail',
          message: `Failed to create locales directory: ${(err as Error).message}`,
        };
      }
    }

    return {
      name: 'Locales Directory',
      status: 'warn',
      message: `Locales directory does not exist: ${config.localesDir}`,
      suggestion: 'Run with --fix to create it, or run "i18nsmith sync --write"',
    };
  }
}

async function checkSourceLocale(
  config: I18nConfig,
  projectRoot: string,
  autoFix?: boolean
): Promise<PreflightCheck> {
  const localesDir = path.resolve(projectRoot, config.localesDir ?? 'locales');
  const sourceLocalePath = path.join(localesDir, `${config.sourceLanguage}.json`);

  try {
    const content = await fs.readFile(sourceLocalePath, 'utf8');
    JSON.parse(content); // Validate JSON
    return {
      name: 'Source Locale',
      status: 'pass',
      message: `Source locale file exists: ${config.sourceLanguage}.json`,
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      if (autoFix) {
        try {
          await fs.mkdir(localesDir, { recursive: true });
          await fs.writeFile(sourceLocalePath, '{}');
          return {
            name: 'Source Locale',
            status: 'pass',
            message: `Created source locale file: ${config.sourceLanguage}.json`,
          };
        } catch (fixErr) {
          return {
            name: 'Source Locale',
            status: 'fail',
            message: `Failed to create source locale: ${(fixErr as Error).message}`,
          };
        }
      }

      return {
        name: 'Source Locale',
        status: 'warn',
        message: `Source locale file does not exist: ${config.sourceLanguage}.json`,
        suggestion: 'Run with --fix or "i18nsmith sync --write" to create it',
      };
    }

    return {
      name: 'Source Locale',
      status: 'fail',
      message: `Source locale file is invalid: ${error.message}`,
      suggestion: 'Check that the file contains valid JSON',
    };
  }
}

async function checkAdapterDependencies(
  config: I18nConfig,
  projectRoot: string
): Promise<PreflightCheck> {
  const adapterModule = config.translationAdapter?.module ?? 'react-i18next';

  // Skip check for custom adapters (local paths)
  if (adapterModule.startsWith('.') || adapterModule.startsWith('@/') || adapterModule.startsWith('~/')) {
    return {
      name: 'Adapter Dependencies',
      status: 'pass',
      message: `Using custom adapter: ${adapterModule}`,
    };
  }

  try {
    const pkg = await readPackageJson(projectRoot);

    if (adapterModule === 'react-i18next') {
      const hasReactI18next = hasDependency(pkg, 'react-i18next');
      const hasI18next = hasDependency(pkg, 'i18next');

      if (!hasReactI18next || !hasI18next) {
        const missing = [];
        if (!hasReactI18next) missing.push('react-i18next');
        if (!hasI18next) missing.push('i18next');

        return {
          name: 'Adapter Dependencies',
          status: 'warn',
          message: `Missing adapter dependencies: ${missing.join(', ')}`,
          suggestion: `Run: npm install ${missing.join(' ')}`,
        };
      }

      return {
        name: 'Adapter Dependencies',
        status: 'pass',
        message: 'react-i18next and i18next are installed',
      };
    }

    // Check for other adapter modules
    if (hasDependency(pkg, adapterModule)) {
      return {
        name: 'Adapter Dependencies',
        status: 'pass',
        message: `Adapter dependency installed: ${adapterModule}`,
      };
    }

    return {
      name: 'Adapter Dependencies',
      status: 'warn',
      message: `Adapter module not found in dependencies: ${adapterModule}`,
      suggestion: `Run: npm install ${adapterModule}`,
    };
  } catch {
    return {
      name: 'Adapter Dependencies',
      status: 'warn',
      message: 'Could not read package.json to check dependencies',
    };
  }
}

async function checkWritePermissions(
  config: I18nConfig,
  projectRoot: string
): Promise<PreflightCheck> {
  const localesDir = path.resolve(projectRoot, config.localesDir ?? 'locales');

  try {
    // Try to access the locales directory
    await fs.access(localesDir);

    // Try to create a test file
    const testFile = path.join(localesDir, '.i18nsmith-permission-test');
    try {
      await fs.writeFile(testFile, '');
      await fs.unlink(testFile);
      return {
        name: 'Write Permissions',
        status: 'pass',
        message: 'Write access to locales directory confirmed',
      };
    } catch {
      return {
        name: 'Write Permissions',
        status: 'fail',
        message: 'No write access to locales directory',
        suggestion: 'Check file permissions on the locales directory',
      };
    }
  } catch {
    // Directory doesn't exist yet, check parent
    const parentDir = path.dirname(localesDir);
    try {
      const testFile = path.join(parentDir, '.i18nsmith-permission-test');
      await fs.writeFile(testFile, '');
      await fs.unlink(testFile);
      return {
        name: 'Write Permissions',
        status: 'pass',
        message: 'Write access to project directory confirmed',
      };
    } catch {
      return {
        name: 'Write Permissions',
        status: 'fail',
        message: 'No write access to project directory',
        suggestion: 'Check file permissions',
      };
    }
  }
}

async function validateConfigOptions(config: I18nConfig): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];

  // Check source language
  if (!config.sourceLanguage || config.sourceLanguage.length < 2) {
    checks.push({
      name: 'Source Language',
      status: 'fail',
      message: 'Invalid source language code',
      suggestion: 'Use a valid language code like "en", "fr", "de"',
    });
  } else {
    checks.push({
      name: 'Source Language',
      status: 'pass',
      message: `Source language: ${config.sourceLanguage}`,
    });
  }

  // Check target languages
  if (!config.targetLanguages || config.targetLanguages.length === 0) {
    checks.push({
      name: 'Target Languages',
      status: 'warn',
      message: 'No target languages configured',
      suggestion: 'Add target languages to translate to in your config',
    });
  } else {
    checks.push({
      name: 'Target Languages',
      status: 'pass',
      message: `Target languages: ${config.targetLanguages.join(', ')}`,
    });
  }

  // Check for common pattern mistakes
  if (config.include.some((p) => p.includes('node_modules'))) {
    checks.push({
      name: 'Include Patterns',
      status: 'warn',
      message: 'Include patterns contain node_modules',
      suggestion: 'Add "node_modules/**" to exclude patterns instead',
    });
  }

  return checks;
}

function printPreflightResults(result: PreflightResult) {
  console.log(chalk.blue('\n🔍 i18nsmith Preflight Check\n'));

  for (const check of result.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : '✗';
    const color = check.status === 'pass' ? chalk.green : check.status === 'warn' ? chalk.yellow : chalk.red;

    console.log(color(`${icon} ${check.name}: ${check.message}`));

    if (check.suggestion) {
      console.log(chalk.gray(`  └─ ${check.suggestion}`));
    }
  }

  console.log('');

  if (result.passed) {
    console.log(chalk.green('✅ All preflight checks passed! You are ready to use i18nsmith.\n'));
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.gray('  • Run "i18nsmith scan" to find translatable strings'));
    console.log(chalk.gray('  • Run "i18nsmith sync" to check locale file drift'));
    console.log(chalk.gray('  • Run "i18nsmith transform" to inject translations'));
  } else {
    console.log(chalk.red('❌ Some preflight checks failed. Please fix the issues above.\n'));
    console.log(chalk.gray('Tips:'));
    console.log(chalk.gray('  • Run "i18nsmith init" to create a new config'));
    console.log(chalk.gray('  • Run "i18nsmith preflight --fix" to auto-fix some issues'));
  }
}
