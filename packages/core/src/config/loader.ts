/**
 * Configuration file loading utilities
 */

import fs from 'fs/promises';
import path from 'path';
import type { I18nConfig, LoadConfigResult } from './types.js';
import { normalizeConfig } from './normalizer.js';
import { assertConfigValid } from './validator.js';
import { DEFAULT_CONFIG_FILENAME } from './defaults.js';
import { inferConfig } from './inference.js';

// ─────────────────────────────────────────────────────────────────────────────
// File System Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Search upward through directories for a file.
 */
async function findUp(filename: string, cwd: string): Promise<string | null> {
  let currentDir = cwd;
  let parentDir = path.dirname(currentDir);
  const maxDepth = 10; // Prevent infinite loops
  let depth = 0;

  do {
    const filePath = path.join(currentDir, filename);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // continue
    }

    parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
    depth++;
  } while (currentDir !== parentDir && depth < maxDepth);

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Loading
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load and parse a config file from a specific path.
 */
async function readConfigFile(resolvedPath: string): Promise<Partial<I18nConfig>> {
  let fileContents: string;

  try {
    fileContents = await fs.readFile(resolvedPath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found at ${resolvedPath}. Run "i18nsmith init" to create one.`);
    }
    throw new Error(`Unable to read config file at ${resolvedPath}: ${err.message}`);
  }

  let parsed: Partial<I18nConfig>;
  try {
    parsed = JSON.parse(fileContents);
  } catch (error) {
    throw new Error(
      `Config file at ${resolvedPath} contains invalid JSON: ${(error as Error).message}`
    );
  }

  return parsed;
}

/**
 * Load config file with upward directory traversal.
 * @param configPath - Path to config file (relative or absolute)
 * @param options - Load options
 * @returns Config object and metadata about where it was found
 */
export async function loadConfigWithMeta(
  configPath = DEFAULT_CONFIG_FILENAME,
  options?: { cwd?: string }
): Promise<LoadConfigResult> {
  const cwd = options?.cwd ?? process.cwd();
  let resolvedPath: string;

  if (path.isAbsolute(configPath)) {
    resolvedPath = configPath;
  } else {
    // Try to resolve relative to CWD first
    const cwdPath = path.resolve(cwd, configPath);
    try {
      await fs.access(cwdPath);
      resolvedPath = cwdPath;
    } catch {
      // If not found in CWD, and it looks like a default/simple filename, try finding up the tree
      if (!configPath.includes(path.sep) || configPath === DEFAULT_CONFIG_FILENAME) {
        const found = await findUp(configPath, cwd);
        resolvedPath = found ?? cwdPath;
      } else {
        resolvedPath = cwdPath;
      }
    }
  }

  const rawConfig = await readConfigFile(resolvedPath);
  const projectRoot = path.dirname(resolvedPath);
  const enriched = await inferConfig(rawConfig, { projectRoot });
  const config = normalizeConfig(enriched);
  assertConfigValid(config);

  return {
    config,
    configPath: resolvedPath,
    projectRoot,
  };
}

/**
 * Load config file (simplified API).
 * @param configPath - Path to config file (relative or absolute)
 * @returns Normalized config object
 */
export async function loadConfig(configPath = DEFAULT_CONFIG_FILENAME): Promise<I18nConfig> {
  const result = await loadConfigWithMeta(configPath);
  return result.config;
}
