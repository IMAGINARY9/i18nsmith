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

    // Check each framework signature in priority order
    const signatures = getSignaturesByPriority();
    const evidence: DetectionEvidence[] = [];

    for (const signature of signatures) {
      const result = await this.checkFramework(signature.type);
      if (result.matched) {
        evidence.push(...result.evidence);

        // Detect additional features
        const features = await this.detectFeatures(signature.type);
        const routerType = signature.type === 'next' ? await this.detectNextRouter() : undefined;

        // Find i18n adapter
        const { adapter, adapterEvidence } = this.detectI18nAdapter(signature.type);
        evidence.push(...adapterEvidence);

        // Calculate confidence
        const confidence = this.calculateConfidence(evidence);

        return {
          type: signature.type,
          version: this.getPackageVersion(signature.packages[0]),
          adapter,
          hookName: getAdapterHook(adapter),
          features,
          routerType,
          confidence,
          evidence,
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
      return { matched: false, evidence };
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

    // Check for known i18n packages
    for (const i18nPkg of signature.i18nPackages) {
      if (this.hasPackage(i18nPkg)) {
        const version = this.getPackageVersion(i18nPkg);
        evidence.push({
          type: 'package',
          source: i18nPkg,
          weight: 0.3,
          description: `Found i18n package ${i18nPkg}${version ? `@${version}` : ''}`,
        });
        return { adapter: i18nPkg, adapterEvidence: evidence };
      }
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
