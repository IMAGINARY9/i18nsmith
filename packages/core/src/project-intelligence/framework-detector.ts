/**
 * Framework Detector
 *
 * Detects the framework used in a project by analyzing package.json
 * and file structure.
 *
 * @module @i18nsmith/core/project-intelligence
 */

import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import { readFileSync } from 'fs';
import type {
  FrameworkType,
  FrameworkDetection,
  DetectionEvidence,
  NextRouterType,
} from './types.js';
import {
  FRAMEWORK_SIGNATURES,
  getSignaturesByPriority,
  getAdapterHook,
} from './signatures.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface FrameworkDetectorOptions {
  workspaceRoot: string;
  verbose?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Framework Detector Class
// ─────────────────────────────────────────────────────────────────────────────

export class FrameworkDetector {
  private readonly workspaceRoot: string;
  private readonly verbose: boolean;
  private packageJson: PackageJson | null = null;
  private allDependencies: Record<string, string> = {};

  constructor(options: FrameworkDetectorOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.verbose = options.verbose ?? false;
  }

  /**
   * Detect the framework used in the project.
   */
  async detect(): Promise<FrameworkDetection> {
    // Load package.json
    await this.loadPackageJson();

    // Check each framework signature and collect evidence from all
    const signatures = getSignaturesByPriority();
    const frameworkResults: Array<{
      type: FrameworkType;
      matched: boolean;
      evidence: DetectionEvidence[];
      confidence: number;
    }> = [];

    for (const signature of signatures) {
      const result = await this.checkFramework(signature.type);
      const confidence = this.calculateConfidence(result.evidence);
      
      // Debug logging
      if (process.env.DEBUG_FRAMEWORK_DETECTION) {
        console.log(`[Framework Detection] ${signature.type}:`, {
          matched: result.matched,
          confidence,
          evidence: result.evidence,
        });
      }
      
      frameworkResults.push({
        type: signature.type,
        matched: result.matched,
        evidence: result.evidence,
        confidence,
      });
    }

    // Find the framework with the highest confidence
    const bestMatch = frameworkResults.reduce((best, current) => {
      // Prefer matched frameworks, but also consider confidence from evidence
      const shouldPreferCurrent = 
        (current.matched && !best.matched) || // Prefer matched over unmatched
        (current.matched === best.matched && current.confidence > best.confidence) || // Same match status, higher confidence
        (!best.matched && current.confidence > best.confidence); // Both unmatched, higher confidence
      
      return shouldPreferCurrent ? current : best;
    }, { type: 'unknown' as FrameworkType, matched: false, evidence: [] as DetectionEvidence[], confidence: 0 });

    if (bestMatch.confidence > 0) {
      const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === bestMatch.type);
      
      if (signature) {
        // Detect additional features
        const features = await this.detectFeatures(bestMatch.type);
        const routerType = bestMatch.type === 'next' ? await this.detectNextRouter() : undefined;

        // Find i18n adapter
        const { adapter, adapterEvidence } = this.detectI18nAdapter(bestMatch.type);
        bestMatch.evidence.push(...adapterEvidence);

        return {
          type: bestMatch.type,
          version: this.getPackageVersion(signature.packages[0]),
          adapter,
          hookName: getAdapterHook(adapter),
          features,
          routerType,
          confidence: this.calculateConfidence(bestMatch.evidence),
          evidence: bestMatch.evidence,
        };
      }
    }

    // No framework detected
    return {
      type: 'unknown',
      adapter: 'react-i18next',
      hookName: 'useTranslation',
      features: [],
      confidence: 0,
      evidence: [
        {
          type: 'package',
          source: 'package.json',
          weight: 0,
          description: 'No recognized framework packages found',
        },
      ],
    };
  }

  /**
   * Load and parse package.json.
   */
  private async loadPackageJson(): Promise<void> {
    const pkgPath = path.join(this.workspaceRoot, 'package.json');

    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      this.packageJson = JSON.parse(content);
      this.allDependencies = {
        ...this.packageJson?.dependencies,
        ...this.packageJson?.devDependencies,
      };
    } catch {
      this.packageJson = null;
      this.allDependencies = {};
    }
  }

  /**
   * Check if a specific framework is present.
   */
  private async checkFramework(
    type: FrameworkType
  ): Promise<{ matched: boolean; evidence: DetectionEvidence[] }> {
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === type);
    if (!signature) {
      return { matched: false, evidence: [] };
    }

    const evidence: DetectionEvidence[] = [];
    let hasRequiredPackage = false;

    // Check required packages
    for (const pkg of signature.packages) {
      if (this.hasPackage(pkg)) {
        hasRequiredPackage = true;
        const version = this.getPackageVersion(pkg);
        evidence.push({
          type: 'package',
          source: pkg,
          weight: 0.5,
          description: `Found ${pkg}${version ? `@${version}` : ''} in dependencies`,
        });
        break; // Only need one required package
      }
    }

    if (!hasRequiredPackage) {
      // If no required package is present, try to detect framework by
      // presence of characteristic files (e.g., .vue files for Vue).
      // This helps detection in minimal test projects that don't list
      // framework packages in package.json (common in temp fixtures).
      // First, check for explicit feature indicators (config files, dirs)
      let matchedFeatureIndicator = false;
      if (signature.featureIndicators) {
        for (const indicators of Object.values(signature.featureIndicators)) {
          for (const indicator of indicators) {
            // eslint-disable-next-line no-await-in-loop
            if (await this.pathExists(indicator)) {
              matchedFeatureIndicator = true;
              evidence.push({
                type: 'file',
                source: indicator,
                weight: 0.25,
                description: `Found feature indicator ${indicator}`,
              });
              break;
            }
          }
          if (matchedFeatureIndicator) break;
        }
      }

      // Check file patterns and add evidence, but be strict about what
      // constitutes a "match" to avoid false positives.
      // 
      // Without the required package, we only match on truly framework-specific
      // file types that cannot be confused with other frameworks:
      // - .vue files = Vue
      // - .svelte files = Svelte
      // - .component.html (Angular templates)
      // 
      // Generic files like .ts, .js, .tsx, .jsx are NOT sufficient without
      // the framework package, as they could belong to any framework.
      let matchedFrameworkSpecificPattern = false;
      for (const pattern of signature.includePatterns ?? []) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await this.pathExists(pattern);
        if (exists) {
          // Check if this pattern is for framework-specific file extensions.
          // Patterns containing .vue, .svelte, etc. are strong indicators.
          // Patterns with only .ts/.js/.tsx/.jsx are NOT framework-specific
          // (they could be any framework or vanilla TypeScript).
          const hasVueExtension = pattern.includes('.vue');
          const hasSvelteExtension = pattern.includes('.svelte');
          const hasAngularExtension = pattern.includes('.component.html') || pattern.includes('.component.ts');
          
          const isFrameworkSpecific = hasVueExtension || hasSvelteExtension || hasAngularExtension;
          
          const weight = isFrameworkSpecific ? 0.3 : 0.1; // Lower weight for generic patterns
          
          evidence.push({
            type: 'file',
            source: pattern,
            weight,
            description: `Found files matching ${pattern}`,
          });
          
          if (isFrameworkSpecific) {
            matchedFrameworkSpecificPattern = true;
          }
        }
      }
      
      // Only set hasRequiredPackage if we found framework-specific indicators
      hasRequiredPackage = matchedFeatureIndicator || matchedFrameworkSpecificPattern;
      
      // Heuristic: for high-level frameworks that encompass others (e.g., Nuxt
      // includes Vue), require a feature indicator (nuxt.config.* or pages/)
      // in addition to generic file matches to avoid misclassification.
      if (!hasRequiredPackage) {
        // Return evidence even if no match, for aggregate scoring
        return { matched: false, evidence };
      }
      if (signature.type === 'nuxt' && !matchedFeatureIndicator) {
        // Return evidence even if demoted, for aggregate scoring
        return { matched: false, evidence };
      }
    }

    // Check optional packages for additional confidence
    if (signature.optionalPackages) {
      for (const pkg of signature.optionalPackages) {
        if (this.hasPackage(pkg)) {
          evidence.push({
            type: 'package',
            source: pkg,
            weight: 0.1,
            description: `Found optional package ${pkg}`,
          });
        }
      }
    }

    // Check for feature indicator files
    if (signature.featureIndicators) {
      for (const [feature, indicators] of Object.entries(signature.featureIndicators)) {
        for (const indicator of indicators) {
          const exists = await this.pathExists(indicator);
          if (exists) {
            evidence.push({
              type: 'file',
              source: indicator,
              weight: 0.15,
              description: `Found ${feature} indicator: ${indicator}`,
            });
          }
        }
      }
    }

    return { matched: true, evidence };
  }

  /**
   * Detect i18n adapter for the framework.
   */
  private detectI18nAdapter(
    frameworkType: FrameworkType
  ): { adapter: string; adapterEvidence: DetectionEvidence[] } {
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === frameworkType);
    const evidence: DetectionEvidence[] = [];

    if (!signature) {
      return { adapter: 'react-i18next', adapterEvidence: evidence };
    }

    // First, check for existing config and prefer it
    const existingAdapter = this.detectExistingAdapterConfig();
    if (existingAdapter) {
      evidence.push({
        type: 'file',
        source: 'i18n.config.json',
        weight: 1.0,
        description: `Found existing adapter config: ${existingAdapter}`,
      });
      return { adapter: existingAdapter, adapterEvidence: evidence };
    }

    // Second, check for custom adapters in source code
    const customAdapter = this.detectCustomAdapter();
    if (customAdapter) {
      // Check if we also have conflicting package-based adapters
      const hasConflictingPackage = signature.i18nPackages.some(pkg => this.hasPackage(pkg));
      if (hasConflictingPackage) {
        evidence.push({
          type: 'pattern',
          source: 'conflict',
          weight: -0.1, // Reduce confidence due to potential conflict
          description: `Custom adapter detected but conflicting i18n packages also found`,
        });
      }

      evidence.push({
        type: 'code',
        source: customAdapter.source,
        weight: 0.8,
        description: `Found custom adapter import: ${customAdapter.adapter}`,
      });
      return { adapter: customAdapter.adapter, adapterEvidence: evidence };
    }

    // Check for known i18n packages
    let packageAdapter: string | null = null;
    for (const i18nPkg of signature.i18nPackages) {
      if (this.hasPackage(i18nPkg)) {
        const version = this.getPackageVersion(i18nPkg);
        evidence.push({
          type: 'package',
          source: i18nPkg,
          weight: 0.3,
          description: `Found i18n package ${i18nPkg}${version ? `@${version}` : ''}`,
        });
        packageAdapter = i18nPkg;
        break; // Return the first found package
      }
    }

    // If we found a package adapter but also detected custom adapters earlier,
    // the custom adapter would have already been returned. But if we get here,
    // it means no custom adapter was found, so return the package adapter.
    if (packageAdapter) {
      return { adapter: packageAdapter, adapterEvidence: evidence };
    }

    // No i18n package found, use default
    evidence.push({
      type: 'pattern',
      source: 'default',
      weight: 0.1,
      description: `Using default adapter for ${frameworkType}: ${signature.defaultAdapter}`,
    });

    return { adapter: signature.defaultAdapter, adapterEvidence: evidence };
  }

  /**
   * Detect existing adapter configuration from i18n.config.json.
   */
  private detectExistingAdapterConfig(): string | null {
    const configPath = path.join(this.workspaceRoot, 'i18n.config.json');

    try {
      const content = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(content);

      // Check for translationAdapter in the config
      if (config.translationAdapter?.module) {
        return config.translationAdapter.module;
      }
    } catch {
      // If config doesn't exist or is invalid, return null
    }

    return null;
  }

  /**
   * Detect custom i18n adapters by scanning source code for hook imports.
   */
  private detectCustomAdapter(): { adapter: string; source: string } | null {
    // Common custom adapter patterns to look for
    const customAdapterPatterns = [
      // React custom contexts
      { pattern: /import\s*\{[^}]*useTranslation[^}]*\}\s*from\s*['"]([^'"]+)['"]/g, type: 'react' },
      // Vue custom composables
      { pattern: /import\s*\{[^}]*useI18n[^}]*\}\s*from\s*['"]([^'"]+)['"]/g, type: 'vue' },
      // Direct hook imports
      { pattern: /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/g, type: 'react' },
      // Custom translation functions
      { pattern: /import\s*\{[^}]*translate[^}]*\}\s*from\s*['"]([^'"]+)['"]/g, type: 'react' },
    ];

    try {
      // Get source files to scan (limit to common entry points and components)
      const sourceFiles = fg.sync([
        'src/**/*.{ts,tsx,js,jsx,vue}',
        'app/**/*.{ts,tsx,js,jsx}',
        'pages/**/*.{ts,tsx,js,jsx,vue}',
        'components/**/*.{ts,tsx,js,jsx,vue}',
        'composables/**/*.{ts,js}',
        'hooks/**/*.{ts,js}',
        'contexts/**/*.{ts,tsx,js,jsx}',
        'lib/**/*.{ts,js}',
        'utils/**/*.{ts,js}',
      ], {
        cwd: this.workspaceRoot,
        onlyFiles: true,
        absolute: true,
        followSymbolicLinks: false,
      });

      // Limit scanning to avoid performance issues (scan first 50 files)
      const filesToScan = sourceFiles.slice(0, 50);

      for (const filePath of filesToScan) {
        try {
          const content = readFileSync(filePath, 'utf-8');

          for (const { pattern, type } of customAdapterPatterns) {
            const matches = content.match(pattern);
            if (matches) {
              // Extract the module path from the first match
              const match = matches[0];
              const moduleMatch = match.match(/from\s*['"`]([^'"`]+)['"`]/);
              if (moduleMatch) {
                const modulePath = moduleMatch[1];
                return {
                  adapter: modulePath,
                  source: `${filePath}:${match}`,
                };
              }
            }
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }
    } catch {
      // If scanning fails, return null
    }

    return null;
  }

  /**
   * Detect features specific to the framework.
   */
  private async detectFeatures(frameworkType: FrameworkType): Promise<string[]> {
    const features: string[] = [];
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === frameworkType);

    if (!signature?.featureIndicators) {
      return features;
    }

    for (const [feature, indicators] of Object.entries(signature.featureIndicators)) {
      for (const indicator of indicators) {
        // Handle package-based indicators
        if (!indicator.includes('/') && !indicator.includes('.')) {
          if (this.hasPackage(indicator)) {
            features.push(feature);
            break;
          }
        } else {
          // File-based indicator
          const exists = await this.pathExists(indicator);
          if (exists) {
            features.push(feature);
            break;
          }
        }
      }
    }

    // Add standard features based on detected packages
    if (this.hasPackage('typescript') || await this.pathExists('tsconfig.json')) {
      features.push('typescript');
    }

    return features;
  }

  /**
   * Detect Next.js router type.
   */
  private async detectNextRouter(): Promise<NextRouterType> {
    const hasAppDir = await this.pathExists('app') || await this.pathExists('src/app');
    const hasPagesDir = await this.pathExists('pages') || await this.pathExists('src/pages');

    // Check for App Router indicators
    const hasAppLayout =
      (await this.pathExists('app/layout.tsx')) ||
      (await this.pathExists('app/layout.ts')) ||
      (await this.pathExists('app/layout.js')) ||
      (await this.pathExists('src/app/layout.tsx')) ||
      (await this.pathExists('src/app/layout.ts'));

    // Check for Pages Router indicators
    const hasPagesApp =
      (await this.pathExists('pages/_app.tsx')) ||
      (await this.pathExists('pages/_app.ts')) ||
      (await this.pathExists('pages/_app.js')) ||
      (await this.pathExists('src/pages/_app.tsx'));

    if (hasAppLayout && hasPagesApp) {
      return 'hybrid';
    }

    if (hasAppLayout || (hasAppDir && !hasPagesDir)) {
      return 'app';
    }

    if (hasPagesApp || hasPagesDir) {
      return 'pages';
    }

    return 'unknown';
  }

  /**
   * Calculate overall confidence from evidence.
   */
  private calculateConfidence(evidence: DetectionEvidence[]): number {
    const totalWeight = evidence.reduce((sum, e) => sum + e.weight, 0);
    // Normalize to 0-1 range, capping at 1
    return Math.min(totalWeight, 1);
  }

  /**
   * Check if a package exists in dependencies.
   */
  private hasPackage(name: string): boolean {
    return name in this.allDependencies;
  }

  /**
   * Get version of a package from dependencies.
   */
  private getPackageVersion(name: string): string | undefined {
    return this.allDependencies[name];
  }

  /**
   * Check if a path exists relative to workspace root.
   */
  private async pathExists(relativePath: string): Promise<boolean> {
    try {
      // Handle glob patterns
      if (relativePath.includes('*')) {
        const matches = await fg(relativePath, {
          cwd: this.workspaceRoot,
          onlyFiles: false,
          unique: true,
          suppressErrors: true,
        });
        return matches.length > 0;
      }

      // Direct path check
      const absolutePath = path.join(this.workspaceRoot, relativePath);
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Detection Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect framework in a directory.
 *
 * @example
 * ```typescript
 * const result = await detectFramework('/path/to/project');
 * console.log(result.type);    // 'next'
 * console.log(result.adapter); // 'react-i18next'
 * ```
 */
export async function detectFramework(
  workspaceRoot: string,
  options?: { verbose?: boolean }
): Promise<FrameworkDetection> {
  const detector = new FrameworkDetector({
    workspaceRoot,
    verbose: options?.verbose,
  });
  return detector.detect();
}
