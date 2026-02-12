import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { Command } from 'commander';
import { loadConfigWithMeta, DEFAULT_CONFIG_FILENAME } from '@i18nsmith/core';
import { CliError, withErrorHandling } from '../utils/errors.js';

interface ConfigCommandOptions {
  config?: string;
  json?: boolean;
}

interface ConfigSetOptions extends ConfigCommandOptions {
  key: string;
  value: string;
}

interface ConfigGetOptions extends ConfigCommandOptions {
  key: string;
}

/**
 * Parse a dot-notation key path into segments.
 * e.g., 'translationAdapter.module' => ['translationAdapter', 'module']
 */
function parseKeyPath(keyPath: string): string[] {
  return keyPath.split('.').filter(Boolean);
}

/**
 * Get a nested value from an object using a key path.
 */
function getNestedValue(obj: Record<string, unknown>, keyPath: string[]): unknown {
  let current: unknown = obj;
  for (const key of keyPath) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Set a nested value in an object using a key path.
 * Creates intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, keyPath: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  const finalKey = keyPath[keyPath.length - 1];
  current[finalKey] = value;
}

/**
 * Parse a value string into an appropriate type.
 * Handles booleans, numbers, arrays, and strings.
 */
function parseValue(valueStr: string): unknown {
  // Boolean
  if (valueStr === 'true') return true;
  if (valueStr === 'false') return false;
  
  // Null
  if (valueStr === 'null') return null;
  
  // Number
  if (/^-?\d+(\.\d+)?$/.test(valueStr)) {
    return parseFloat(valueStr);
  }
  
  // JSON array or object
  if ((valueStr.startsWith('[') && valueStr.endsWith(']')) ||
      (valueStr.startsWith('{') && valueStr.endsWith('}'))) {
    try {
      return JSON.parse(valueStr);
    } catch {
      // Fall through to string
    }
  }
  
  // Remove surrounding quotes if present
  if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
      (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
    return valueStr.slice(1, -1);
  }
  
  return valueStr;
}

/**
 * Read the raw config file content (unparsed JSON with comments preserved formatting).
 */
async function readRawConfig(configPath: string): Promise<{ content: string; parsed: Record<string, unknown> }> {
  const content = await fs.readFile(configPath, 'utf-8');
  const parsed = JSON.parse(content);
  return { content, parsed };
}

/**
 * Write config back to file with nice formatting.
 */
async function writeConfig(configPath: string, config: Record<string, unknown>): Promise<void> {
  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(configPath, content, 'utf-8');
}

export function registerConfig(program: Command) {
  const configCmd = program
    .command('config')
    .description('View or modify i18nsmith configuration');

  // Subcommand: config get <key>
  configCmd
    .command('get <key>')
    .description('Get a configuration value by key path (e.g., translationAdapter.module)')
    .option('-c, --config <path>', 'Path to i18nsmith config file', DEFAULT_CONFIG_FILENAME)
    .option('--json', 'Output as JSON', false)
    .action(
      withErrorHandling(async (key: string, options: ConfigGetOptions) => {
        try {
          const { config } = await loadConfigWithMeta(options.config);
          const keyPath = parseKeyPath(key);
          const value = getNestedValue(config as unknown as Record<string, unknown>, keyPath);

          if (value === undefined) {
            throw new CliError(`Key "${key}" not found in config`);
          }

          if (options.json) {
            console.log(JSON.stringify({ key, value }, null, 2));
          } else if (typeof value === 'object' && value !== null) {
            console.log(JSON.stringify(value, null, 2));
          } else {
            console.log(String(value));
          }
        } catch (error) {
          if (error instanceof CliError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Failed to get config: ${message}`);
        }
      })
    );

  // Subcommand: config set <key> <value>
  configCmd
    .command('set <key> <value>')
    .description('Set a configuration value by key path (e.g., translationAdapter.module "src/i18n.ts")')
    .option('-c, --config <path>', 'Path to i18nsmith config file', DEFAULT_CONFIG_FILENAME)
    .option('--json', 'Output result as JSON', false)
    .action(
      withErrorHandling(async (key: string, value: string, options: ConfigSetOptions) => {
        try {
          const { configPath } = await loadConfigWithMeta(options.config);
          const { parsed } = await readRawConfig(configPath);

          const keyPath = parseKeyPath(key);
          const parsedValue = parseValue(value);

          setNestedValue(parsed, keyPath, parsedValue);

          await writeConfig(configPath, parsed);

          if (options.json) {
            console.log(JSON.stringify({ key, value: parsedValue, configPath }, null, 2));
          } else {
            console.log(chalk.green(`✓ Set ${key} = ${JSON.stringify(parsedValue)}`));
            console.log(chalk.dim(`  Updated: ${configPath}`));
          }
        } catch (error) {
          if (error instanceof CliError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Failed to set config: ${message}`);
        }
      })
    );

  // Subcommand: config list
  configCmd
    .command('list')
    .description('List all configuration values')
    .option('-c, --config <path>', 'Path to i18nsmith config file', DEFAULT_CONFIG_FILENAME)
    .option('--json', 'Output as JSON', false)
    .action(
      withErrorHandling(async (options: ConfigCommandOptions) => {
        try {
          const { config, configPath } = await loadConfigWithMeta(options.config);

          if (options.json) {
            console.log(JSON.stringify(config, null, 2));
          } else {
            console.log(chalk.blue(`Configuration from: ${configPath}`));
            console.log();
            console.log(JSON.stringify(config, null, 2));
          }
        } catch (error) {
          if (error instanceof CliError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Failed to read config: ${message}`);
        }
      })
    );

  // Subcommand: config path
  configCmd
    .command('path')
    .description('Print the path to the active config file')
    .option('-c, --config <path>', 'Path to i18nsmith config file', DEFAULT_CONFIG_FILENAME)
    .action(
      withErrorHandling(async (options: ConfigCommandOptions) => {
        try {
          const { configPath } = await loadConfigWithMeta(options.config);
          console.log(configPath);
        } catch (error) {
          if (error instanceof CliError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Failed to find config: ${message}`);
        }
      })
    );

  // Subcommand: config init-adapter <path>
  configCmd
    .command('init-adapter <adapterPath>')
    .description('Configure a translation adapter module in the config file')
    .option('-c, --config <path>', 'Path to i18nsmith config file', DEFAULT_CONFIG_FILENAME)
    .option('--hook <name>', 'Name of the translation hook (default: useTranslation)', 'useTranslation')
    .option('--json', 'Output result as JSON', false)
    .action(
      withErrorHandling(async (adapterPath: string, options: { config?: string; hook: string; json?: boolean }) => {
        try {
          const { configPath } = await loadConfigWithMeta(options.config);
          const { parsed } = await readRawConfig(configPath);

          // Resolve relative path
          const projectRoot = path.dirname(configPath);
          const relativePath = path.isAbsolute(adapterPath)
            ? path.relative(projectRoot, adapterPath)
            : adapterPath;

          // Update translationAdapter
          if (!parsed.translationAdapter || typeof parsed.translationAdapter !== 'object') {
            parsed.translationAdapter = {};
          }
          const adapter = parsed.translationAdapter as Record<string, unknown>;
          adapter.module = relativePath;
          adapter.hookName = options.hook;

          await writeConfig(configPath, parsed);

          if (options.json) {
            console.log(JSON.stringify({
              translationAdapter: parsed.translationAdapter,
              configPath,
            }, null, 2));
          } else {
            console.log(chalk.green('✓ Translation adapter configured:'));
            console.log(chalk.dim(`  module: ${relativePath}`));
            console.log(chalk.dim(`  hookName: ${options.hook}`));
            console.log(chalk.dim(`  Updated: ${configPath}`));
          }
        } catch (error) {
          if (error instanceof CliError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Failed to configure adapter: ${message}`);
        }
      })
    );

  // Subcommand: config migrate
  configCmd
    .command('migrate')
    .description('Migrate configuration from v1 to v2 format and apply modern defaults')
    .option('-c, --config <path>', 'Path to i18nsmith config file', DEFAULT_CONFIG_FILENAME)
    .option('--dry-run', 'Show what would be changed without modifying files', false)
    .option('--json', 'Output result as JSON', false)
    .action(
      withErrorHandling(async (options: { config?: string; dryRun?: boolean; json?: boolean }) => {
        try {
          const { configPath } = await loadConfigWithMeta(options.config);
          const { parsed: rawConfig } = await readRawConfig(configPath);

          // Check if migration is needed
          const currentVersion = (rawConfig.configVersion ?? rawConfig.version ?? 1) as number;
          if (currentVersion >= 2) {
            if (options.json) {
              console.log(JSON.stringify({ migrated: false, reason: 'Already at latest version' }, null, 2));
            } else {
              console.log(chalk.blue('Configuration is already up to date (v2 or later)'));
            }
            return;
          }

          // Apply migration transformations
          const migratedConfig = { ...rawConfig };

          // Set new version
          migratedConfig.configVersion = 2;
          delete migratedConfig.version;

          // Migrate field names
          if (rawConfig.sourceLocale) {
            migratedConfig.sourceLanguage = rawConfig.sourceLocale;
            delete migratedConfig.sourceLocale;
          }
          if (rawConfig.targetLocales) {
            migratedConfig.targetLanguages = rawConfig.targetLocales;
            delete migratedConfig.targetLocales;
          }

          // Add extraction preset with strict defaults for new configs
          if (!migratedConfig.extraction) {
            migratedConfig.extraction = {};
          }
          const extraction = migratedConfig.extraction as Record<string, unknown>;
          if (!extraction.preset) {
            extraction.preset = 'strict';
          }

          // Clean up deprecated fields
          const deprecatedFields = ['projectName'];
          for (const field of deprecatedFields) {
            if (field in migratedConfig) {
              delete migratedConfig[field];
            }
          }

          if (options.dryRun) {
            if (options.json) {
              console.log(JSON.stringify({
                migrated: true,
                dryRun: true,
                changes: {
                  added: { configVersion: 2, 'extraction.preset': 'strict' },
                  removed: deprecatedFields.filter(f => f in rawConfig),
                  renamed: Object.assign({},
                    rawConfig.sourceLocale ? { sourceLocale: 'sourceLanguage' } : {},
                    rawConfig.targetLocales ? { targetLocales: 'targetLanguages' } : {},
                  ),
                },
                result: migratedConfig,
              }, null, 2));
            } else {
              console.log(chalk.blue('Migration preview (dry run):'));
              console.log();
              console.log(chalk.green('✓ Would set configVersion: 2'));
              console.log(chalk.green('✓ Would add extraction.preset: strict'));
              if (rawConfig.sourceLocale) {
                console.log(chalk.green(`✓ Would rename sourceLocale → sourceLanguage`));
              }
              if (rawConfig.targetLocales) {
                console.log(chalk.green(`✓ Would rename targetLocales → targetLanguages`));
              }
              const removed = deprecatedFields.filter(f => f in rawConfig);
              if (removed.length > 0) {
                console.log(chalk.green(`✓ Would remove deprecated fields: ${removed.join(', ')}`));
              }
              console.log();
              console.log(chalk.dim('Run without --dry-run to apply changes'));
            }
          } else {
            await writeConfig(configPath, migratedConfig);

            if (options.json) {
              console.log(JSON.stringify({
                migrated: true,
                configPath,
                changes: {
                  added: { configVersion: 2, 'extraction.preset': 'strict' },
                  removed: deprecatedFields.filter(f => f in rawConfig),
                  renamed: Object.assign({},
                    rawConfig.sourceLocale ? { sourceLocale: 'sourceLanguage' } : {},
                    rawConfig.targetLocales ? { targetLocales: 'targetLanguages' } : {},
                  ),
                },
              }, null, 2));
            } else {
              console.log(chalk.green('✓ Configuration migrated to v2'));
              console.log(chalk.dim(`  Updated: ${configPath}`));
              console.log();
              console.log(chalk.blue('New features available:'));
              console.log(chalk.dim('  • extraction.preset: strict (reduces false positives)'));
              console.log(chalk.dim('  • Improved field names for clarity'));
            }
          }
        } catch (error) {
          if (error instanceof CliError) {
            throw error;
          }
          const message = error instanceof Error ? error.message : String(error);
          throw new CliError(`Failed to migrate config: ${message}`);
        }
      })
    );
}
