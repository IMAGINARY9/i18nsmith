/**
 * Locale Detector
 *
 * Detects existing locale files, source language, and target languages
 * in a project.
 *
 * @module @i18nsmith/core/project-intelligence
 */

import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import type { FrameworkType, LocaleDetection, LocaleFileInfo, PILocaleFormat } from './types.js';
import { FRAMEWORK_SIGNATURES } from './signatures.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Common locale directory candidates */
const LOCALE_DIR_CANDIDATES = [
  // Standard locations
  'locales',
  'locale',
  'i18n',
  'translations',
  'lang',
  'languages',
  'messages',

  // Nested in src
  'src/locales',
  'src/locale',
  'src/i18n',
  'src/translations',
  'src/lang',
  'src/messages',

  // Framework-specific
  'public/locales', // react-i18next common
  'app/locales', // Next.js app router
  'app/i18n', // Next.js
  'i18n/locales',

  // Assets-based
  'assets/locales',
  'assets/i18n',
  'src/assets/locales',
  'src/assets/i18n',

  // Lib-based
  'lib/locales',
  'lib/i18n',
  'src/lib/locales',
  'src/lib/i18n',
];

/** Locale file name patterns */
const LOCALE_FILE_REGEX = /^([a-z]{2,3})(?:[-_]([A-Z]{2}|[a-zA-Z]{4}))?(?:[-_]([a-zA-Z]+))?$/i;

/** Common source language codes */
const COMMON_SOURCE_LANGUAGES = ['en', 'en-US', 'en-GB'];

/** File extensions for locale files */
const LOCALE_FILE_EXTENSIONS = ['.json', '.yaml', '.yml', '.js', '.ts'];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LocaleDetectorOptions {
  workspaceRoot: string;
  frameworkType?: FrameworkType;
  verbose?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Locale Detector Class
// ─────────────────────────────────────────────────────────────────────────────

export class LocaleDetector {
  private readonly workspaceRoot: string;
  private readonly frameworkType: FrameworkType;
  private readonly verbose: boolean;

  constructor(options: LocaleDetectorOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.frameworkType = options.frameworkType ?? 'unknown';
    this.verbose = options.verbose ?? false;
  }

  /**
   * Detect locale configuration in the project.
   */
  async detect(): Promise<LocaleDetection> {
    // Find locale directory
    const localesDir = await this.findLocalesDir();

    if (!localesDir) {
      // No locales found, return defaults
      return this.getDefaultDetection();
    }

    // Scan locale files
    const existingFiles = await this.scanLocaleFiles(localesDir);

    if (existingFiles.length === 0) {
      return {
        ...this.getDefaultDetection(),
        localesDir,
      };
    }

    // Determine format
    const format = this.detectFormat(existingFiles);

    // Determine source and target languages
    const { sourceLanguage, targetLanguages } = this.determineLanguages(existingFiles);

    // Count total keys
    const existingKeyCount = existingFiles.reduce((sum, f) => sum + f.keyCount, 0);

    // Calculate confidence
    const confidence = this.calculateConfidence(existingFiles, localesDir);

    return {
      sourceLanguage,
      targetLanguages,
      localesDir,
      format,
      existingFiles,
      existingKeyCount,
      confidence,
    };
  }

  /**
   * Find the locales directory in the project.
   */
  private async findLocalesDir(): Promise<string | undefined> {
    // Get framework-specific candidates first
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === this.frameworkType);
    const candidates = signature
      ? [...signature.localesCandidates, ...LOCALE_DIR_CANDIDATES]
      : LOCALE_DIR_CANDIDATES;

    // Check each candidate
    for (const candidate of candidates) {
      const absolutePath = path.join(this.workspaceRoot, candidate);
      try {
        const stats = await fs.stat(absolutePath);
        if (stats.isDirectory()) {
          // Verify it contains locale-like files
          const hasLocaleFiles = await this.hasLocaleFiles(candidate);
          if (hasLocaleFiles) {
            return candidate;
          }
        }
      } catch {
        // Directory doesn't exist, continue
      }
    }

    // Try to find any directory with locale files
    const patterns = ['**/locales', '**/i18n', '**/lang', '**/messages'];
    for (const pattern of patterns) {
      const matches = await fg(pattern, {
        cwd: this.workspaceRoot,
        onlyDirectories: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
        suppressErrors: true,
        deep: 3,
      });

      for (const match of matches) {
        if (await this.hasLocaleFiles(match)) {
          return match;
        }
      }
    }

    return undefined;
  }

  /**
   * Check if a directory contains locale files.
   */
  private async hasLocaleFiles(dir: string): Promise<boolean> {
    const absolutePath = path.join(this.workspaceRoot, dir);

    try {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });

      for (const entry of entries) {
        // Check for locale-named files
        if (entry.isFile()) {
          const baseName = path.parse(entry.name).name;
          if (LOCALE_FILE_REGEX.test(baseName)) {
            return true;
          }
        }

        // Check for locale-named directories (namespaced structure)
        if (entry.isDirectory() && LOCALE_FILE_REGEX.test(entry.name)) {
          return true;
        }
      }
    } catch {
      return false;
    }

    return false;
  }

  /**
   * Scan locale files in a directory.
   */
  private async scanLocaleFiles(localesDir: string): Promise<LocaleFileInfo[]> {
    const absoluteDir = path.join(this.workspaceRoot, localesDir);
    const files: LocaleFileInfo[] = [];

    try {
      const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (!LOCALE_FILE_EXTENSIONS.includes(ext)) continue;

          const baseName = path.parse(entry.name).name;
          const localeMatch = baseName.match(LOCALE_FILE_REGEX);

          if (localeMatch) {
            const locale = this.normalizeLocale(baseName);
            const filePath = path.join(absoluteDir, entry.name);
            const fileInfo = await this.parseLocaleFile(filePath, locale, ext);
            files.push(fileInfo);
          }
        } else if (entry.isDirectory()) {
          // Check for directory-based locales (e.g., en/common.json)
          const localeMatch = entry.name.match(LOCALE_FILE_REGEX);
          if (localeMatch) {
            const locale = this.normalizeLocale(entry.name);
            const dirPath = path.join(absoluteDir, entry.name);
            const fileInfo = await this.parseLocaleDirectory(dirPath, locale);
            if (fileInfo) {
              files.push(fileInfo);
            }
          }
        }
      }
    } catch (error) {
      if (this.verbose) {
        console.warn(`Error scanning locale directory: ${error}`);
      }
    }

    return files.sort((a, b) => a.locale.localeCompare(b.locale));
  }

  /**
   * Parse a single locale file.
   */
  private async parseLocaleFile(
    filePath: string,
    locale: string,
    ext: string
  ): Promise<LocaleFileInfo> {
    const format = this.extToFormat(ext);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const stats = await fs.stat(filePath);

      let keyCount = 0;
      let parseError: string | undefined;

      if (format === 'json') {
        try {
          const parsed = JSON.parse(content);
          keyCount = this.countKeys(parsed);
        } catch (e) {
          parseError = (e as Error).message;
        }
      } else if (format === 'yaml') {
        // Basic YAML key counting (without a full parser)
        keyCount = this.countYamlKeys(content);
      }

      return {
        locale,
        path: filePath,
        keyCount,
        bytes: stats.size,
        format,
        parseError,
      };
    } catch (error) {
      return {
        locale,
        path: filePath,
        keyCount: 0,
        bytes: 0,
        format,
        parseError: (error as Error).message,
      };
    }
  }

  /**
   * Parse a locale directory (namespaced structure).
   */
  private async parseLocaleDirectory(
    dirPath: string,
    locale: string
  ): Promise<LocaleFileInfo | null> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      let totalKeys = 0;
      let totalBytes = 0;
      let format: 'json' | 'yaml' | 'js' | 'ts' = 'json';

      for (const entry of entries) {
        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name).toLowerCase();
        if (!LOCALE_FILE_EXTENSIONS.includes(ext)) continue;

        const filePath = path.join(dirPath, entry.name);
        const stats = await fs.stat(filePath);
        totalBytes += stats.size;
        format = this.extToFormat(ext);

        if (format === 'json') {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            totalKeys += this.countKeys(parsed);
          } catch {
            // Ignore parse errors for individual namespace files
          }
        }
      }

      if (totalKeys === 0 && totalBytes === 0) {
        return null;
      }

      return {
        locale,
        path: dirPath,
        keyCount: totalKeys,
        bytes: totalBytes,
        format,
      };
    } catch {
      return null;
    }
  }

  /**
   * Count keys in a parsed JSON object.
   */
  private countKeys(obj: unknown): number {
    if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
      return 1;
    }

    if (Array.isArray(obj)) {
      return obj.reduce((sum, item) => sum + this.countKeys(item), 0);
    }

    if (obj && typeof obj === 'object') {
      return Object.values(obj).reduce((sum, value) => sum + this.countKeys(value), 0);
    }

    return 0;
  }

  /**
   * Basic YAML key counting (line-based heuristic).
   */
  private countYamlKeys(content: string): number {
    const lines = content.split('\n');
    let count = 0;

    for (const line of lines) {
      // Count lines that look like key-value pairs
      if (/^\s*[\w.-]+\s*:/.test(line) && !line.trim().endsWith(':')) {
        count++;
      }
    }

    return count;
  }

  /**
   * Detect locale format from files.
   */
  private detectFormat(files: LocaleFileInfo[]): PILocaleFormat {
    if (files.length === 0) return 'auto';

    // Check if any file has nested structure
    const jsonFiles = files.filter((f) => f.format === 'json' && !f.parseError);

    // Simple heuristic: if key count is much higher than expected flat count,
    // it's likely nested
    for (const file of jsonFiles) {
      if (file.keyCount > 50) {
        // Could analyze actual structure, but for now assume auto
        return 'auto';
      }
    }

    return 'flat';
  }

  /**
   * Determine source and target languages.
   */
  private determineLanguages(
    files: LocaleFileInfo[]
  ): { sourceLanguage: string; targetLanguages: string[] } {
    const locales = files.map((f) => f.locale);

    // Find source language
    let sourceLanguage = 'en';

    // Check for common source languages
    for (const source of COMMON_SOURCE_LANGUAGES) {
      const normalized = this.normalizeLocale(source);
      if (locales.includes(normalized)) {
        sourceLanguage = normalized;
        break;
      }
    }

    // If no common source found, use the locale with most keys
    if (!locales.includes(sourceLanguage)) {
      const sorted = [...files].sort((a, b) => b.keyCount - a.keyCount);
      if (sorted.length > 0) {
        sourceLanguage = sorted[0].locale;
      }
    }

    // All other locales are targets
    const targetLanguages = locales.filter((l) => l !== sourceLanguage);

    return { sourceLanguage, targetLanguages };
  }

  /**
   * Calculate detection confidence.
   */
  private calculateConfidence(files: LocaleFileInfo[], localesDir: string): number {
    let confidence = 0;

    // Found a locale directory
    if (localesDir) {
      confidence += 0.4;
    }

    // Found locale files
    if (files.length > 0) {
      confidence += 0.3;
    }

    // Multiple locales found
    if (files.length > 1) {
      confidence += 0.2;
    }

    // Files are valid (no parse errors)
    const validFiles = files.filter((f) => !f.parseError);
    if (validFiles.length === files.length && files.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1);
  }

  /**
   * Normalize a locale string.
   */
  private normalizeLocale(locale: string): string {
    // Convert underscore to hyphen and normalize case
    return locale.replace(/_/g, '-').toLowerCase();
  }

  /**
   * Convert file extension to format type.
   */
  private extToFormat(ext: string): 'json' | 'yaml' | 'js' | 'ts' {
    switch (ext.toLowerCase()) {
      case '.json':
        return 'json';
      case '.yaml':
      case '.yml':
        return 'yaml';
      case '.js':
        return 'js';
      case '.ts':
        return 'ts';
      default:
        return 'json';
    }
  }

  /**
   * Get default detection when no locales found.
   */
  private getDefaultDetection(): LocaleDetection {
    // Get framework-specific default
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === this.frameworkType);
    const defaultDir = signature?.localesCandidates[0] ?? 'locales';

    return {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: defaultDir,
      format: 'auto',
      existingFiles: [],
      existingKeyCount: 0,
      confidence: 0,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Detection Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect locales in a directory.
 *
 * @example
 * ```typescript
 * const result = await detectLocales('/path/to/project');
 * console.log(result.sourceLanguage);   // 'en'
 * console.log(result.targetLanguages);  // ['es', 'fr']
 * console.log(result.localesDir);       // 'locales'
 * ```
 */
export async function detectLocales(
  workspaceRoot: string,
  frameworkType?: FrameworkType,
  options?: { verbose?: boolean }
): Promise<LocaleDetection> {
  const detector = new LocaleDetector({
    workspaceRoot,
    frameworkType,
    verbose: options?.verbose,
  });
  return detector.detect();
}
