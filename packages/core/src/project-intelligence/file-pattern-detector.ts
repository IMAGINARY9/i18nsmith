/**
 * File Pattern Detector
 *
 * Analyzes project structure to determine optimal include/exclude patterns
 * for scanning source files.
 *
 * @module @i18nsmith/core/project-intelligence
 */

import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import type { FrameworkType, FilePatternDetection } from './types.js';
import {
  FRAMEWORK_SIGNATURES,
  UNIVERSAL_EXCLUDE_PATTERNS,
  BUILD_OUTPUT_PATTERNS,
  TEST_FILE_PATTERNS,
  CONFIG_FILE_PATTERNS,
  STORYBOOK_PATTERNS,
} from './signatures.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Common source directories to check */
const SOURCE_DIR_CANDIDATES = [
  'src',
  'app',
  'pages',
  'components',
  'lib',
  'features',
  'modules',
  'views',
  'screens',
  'layouts',
  'composables',
  'hooks',
];

/** Monorepo source patterns */
const MONOREPO_PATTERNS = [
  'packages/*/src',
  'apps/*/src',
  'libs/*/src',
];

/** File extensions by category */
const EXTENSIONS = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.jsx'],
  vue: ['.vue'],
  svelte: ['.svelte'],
  angular: ['.html'], // Angular templates
};

/** Maximum files to sample for detection */
const MAX_SAMPLE_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FilePatternDetectorOptions {
  workspaceRoot: string;
  frameworkType?: FrameworkType;
  verbose?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// File Pattern Detector Class
// ─────────────────────────────────────────────────────────────────────────────

export class FilePatternDetector {
  private readonly workspaceRoot: string;
  private readonly frameworkType: FrameworkType;
  private readonly verbose: boolean;

  constructor(options: FilePatternDetectorOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.frameworkType = options.frameworkType ?? 'unknown';
    this.verbose = options.verbose ?? false;
  }

  /**
   * Detect optimal file patterns for the project.
   */
  async detect(): Promise<FilePatternDetection> {
    // Detect source directories
    const sourceDirectories = await this.detectSourceDirectories();

    // Detect file extensions in use
    const extensionInfo = await this.detectExtensions(sourceDirectories);

    // Build include patterns
    const include = this.buildIncludePatterns(sourceDirectories, extensionInfo);

    // Build exclude patterns
    const exclude = await this.buildExcludePatterns();

    // Count source files
    const sourceFileCount = await this.countSourceFiles(include, exclude);

    // Calculate confidence
    const confidence = this.calculateConfidence(sourceDirectories, extensionInfo, sourceFileCount);

    return {
      include,
      exclude,
      sourceDirectories,
      hasTypeScript: extensionInfo.hasTypeScript,
      hasJsx: extensionInfo.hasJsx,
      hasVue: extensionInfo.hasVue,
      hasSvelte: extensionInfo.hasSvelte,
      sourceFileCount,
      confidence,
    };
  }

  /**
   * Detect source directories that exist in the project.
   */
  private async detectSourceDirectories(): Promise<string[]> {
    const found: string[] = [];

    // Check standard source directories
    for (const dir of SOURCE_DIR_CANDIDATES) {
      if (await this.directoryExists(dir)) {
        found.push(dir);
      }
    }

    // Check for monorepo patterns
    for (const pattern of MONOREPO_PATTERNS) {
      const matches = await fg(pattern, {
        cwd: this.workspaceRoot,
        onlyDirectories: true,
        suppressErrors: true,
        unique: true,
      });
      found.push(...matches);
    }

    // If no directories found, check for files at root level
    if (found.length === 0) {
      const rootFiles = await fg('*.{ts,tsx,js,jsx,vue,svelte}', {
        cwd: this.workspaceRoot,
        onlyFiles: true,
        suppressErrors: true,
      });
      if (rootFiles.length > 0) {
        found.push('.'); // Current directory
      }
    }

    return [...new Set(found)]; // Remove duplicates
  }

  /**
   * Detect file extensions used in the project.
   */
  private async detectExtensions(
    sourceDirectories: string[]
  ): Promise<{
    hasTypeScript: boolean;
    hasJsx: boolean;
    hasVue: boolean;
    hasSvelte: boolean;
    extensions: Set<string>;
  }> {
    const extensions = new Set<string>();
    const patterns = sourceDirectories.length > 0
      ? sourceDirectories.map((dir) => `${dir}/**/*`)
      : ['**/*'];

    // Sample files to detect extensions
    const files = await fg(patterns, {
      cwd: this.workspaceRoot,
      onlyFiles: true,
      suppressErrors: true,
      ignore: UNIVERSAL_EXCLUDE_PATTERNS,
      deep: 5, // Limit depth for performance
    });

    // Analyze extensions from sampled files
    const sampled = files.slice(0, MAX_SAMPLE_SIZE);
    for (const file of sampled) {
      const ext = path.extname(file).toLowerCase();
      if (ext) {
        extensions.add(ext);
      }
    }

    return {
      hasTypeScript: EXTENSIONS.typescript.some((ext) => extensions.has(ext)),
      hasJsx: extensions.has('.jsx') || extensions.has('.tsx'),
      hasVue: extensions.has('.vue'),
      hasSvelte: extensions.has('.svelte'),
      extensions,
    };
  }

  /**
   * Build include patterns based on detected directories and extensions.
   */
  private buildIncludePatterns(
    sourceDirectories: string[],
    extensionInfo: { hasTypeScript: boolean; hasJsx: boolean; hasVue: boolean; hasSvelte: boolean }
  ): string[] {
    // Get framework-specific patterns if available
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === this.frameworkType);
    if (signature && sourceDirectories.length > 0) {
      // Use framework patterns but adapt to detected directories
      return signature.includePatterns;
    }

    // Build dynamic patterns from detected info
    const patterns: string[] = [];
    const dirs = sourceDirectories.length > 0 ? sourceDirectories : ['.'];

    // Build extension glob
    const extParts: string[] = [];
    if (extensionInfo.hasTypeScript) {
      extParts.push('ts', 'tsx');
    }
    if (!extensionInfo.hasTypeScript || extensionInfo.hasJsx) {
      extParts.push('js', 'jsx');
    }
    if (extensionInfo.hasVue) {
      extParts.push('vue');
    }
    if (extensionInfo.hasSvelte) {
      extParts.push('svelte');
    }

    // Default to common extensions if nothing detected
    if (extParts.length === 0) {
      extParts.push('ts', 'tsx', 'js', 'jsx');
    }

    const extGlob = extParts.length === 1 ? extParts[0] : `{${extParts.join(',')}}`;

    for (const dir of dirs) {
      if (dir === '.') {
        patterns.push(`**/*.${extGlob}`);
      } else {
        patterns.push(`${dir}/**/*.${extGlob}`);
      }
    }

    return patterns;
  }

  /**
   * Build exclude patterns based on project structure.
   */
  private async buildExcludePatterns(): Promise<string[]> {
    const patterns: string[] = [...UNIVERSAL_EXCLUDE_PATTERNS];

    // Add framework-specific excludes
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === this.frameworkType);
    if (signature) {
      patterns.push(...signature.excludePatterns);
    }

    // Check for build directories
    for (const pattern of BUILD_OUTPUT_PATTERNS) {
      const dir = pattern.replace('/**', '');
      if (await this.directoryExists(dir)) {
        patterns.push(pattern);
      }
    }

    // Add test patterns
    patterns.push(...TEST_FILE_PATTERNS);

    // Add config patterns
    patterns.push(...CONFIG_FILE_PATTERNS);

    // Check for Storybook
    if (await this.directoryExists('.storybook')) {
      patterns.push(...STORYBOOK_PATTERNS);
    }

    return [...new Set(patterns)]; // Remove duplicates
  }

  /**
   * Count source files matching the patterns.
   */
  private async countSourceFiles(include: string[], exclude: string[]): Promise<number> {
    try {
      const files = await fg(include, {
        cwd: this.workspaceRoot,
        ignore: exclude,
        onlyFiles: true,
        suppressErrors: true,
      });
      return files.length;
    } catch {
      return 0;
    }
  }

  /**
   * Calculate detection confidence.
   */
  private calculateConfidence(
    sourceDirectories: string[],
    extensionInfo: { extensions: Set<string> },
    sourceFileCount: number
  ): number {
    let confidence = 0;

    // Source directories found
    if (sourceDirectories.length > 0) {
      confidence += 0.4;
    }

    // Found relevant extensions
    if (extensionInfo.extensions.size > 0) {
      confidence += 0.3;
    }

    // Reasonable file count (not 0, not excessive)
    if (sourceFileCount > 0 && sourceFileCount < 10000) {
      confidence += 0.3;
    } else if (sourceFileCount > 0) {
      confidence += 0.15;
    }

    return Math.min(confidence, 1);
  }

  /**
   * Check if a directory exists.
   */
  private async directoryExists(relativePath: string): Promise<boolean> {
    try {
      const absolutePath = path.join(this.workspaceRoot, relativePath);
      const stats = await fs.stat(absolutePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Detection Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect file patterns in a directory.
 *
 * @example
 * ```typescript
 * const result = await detectFilePatterns('/path/to/project', 'next');
 * console.log(result.include);  // ['app/**\/*.tsx', ...]
 * console.log(result.exclude);  // ['node_modules/**', ...]
 * ```
 */
export async function detectFilePatterns(
  workspaceRoot: string,
  frameworkType?: FrameworkType,
  options?: { verbose?: boolean }
): Promise<FilePatternDetection> {
  const detector = new FilePatternDetector({
    workspaceRoot,
    frameworkType,
    verbose: options?.verbose,
  });
  return detector.detect();
}
