/**
 * Project Intelligence Service
 *
 * Main service that orchestrates all detectors to provide comprehensive
 * project analysis for automatic configuration generation.
 *
 * @module @i18nsmith/core/project-intelligence
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  ProjectIntelligence,
  DetectionOptions,
  SuggestedConfig,
  DetectionWarning,
  ConfigTemplate,
  ExistingSetupDetection,
  PIRuntimePackageInfo,
  TranslationUsageInfo,
  ProjectIntelligenceService as IProjectIntelligenceService,
} from './types.js';
import { DEFAULT_DETECTION_OPTIONS } from './types.js';
import { FrameworkDetector } from './framework-detector.js';
import { FilePatternDetector } from './file-pattern-detector.js';
import { LocaleDetector } from './locale-detector.js';
import { ConfidenceScorer } from './confidence-scorer.js';
import { FRAMEWORK_SIGNATURES, getAdapterHook } from './signatures.js';

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Templates
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG_TEMPLATES: ConfigTemplate[] = [
  {
    id: 'react',
    name: 'React with react-i18next',
    description: 'Standard React app using react-i18next',
    tags: ['react', 'hooks', 'spa'],
    config: {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'src/locales',
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['**/*.test.*', '**/*.spec.*'],
      translationAdapter: {
        module: 'react-i18next',
        hookName: 'useTranslation',
      },
      keyGeneration: {
        namespace: 'translation',
        shortHashLen: 6,
      },
    },
  },
  {
    id: 'next-app',
    name: 'Next.js App Router',
    description: 'Next.js 13+ with App Router',
    tags: ['next', 'react', 'app-router', 'ssr'],
    config: {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'messages',
      include: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
      exclude: ['.next/**', '**/*.test.*'],
      translationAdapter: {
        module: 'next-intl',
        hookName: 'useTranslations',
      },
      keyGeneration: {
        namespace: 'common',
        shortHashLen: 6,
      },
    },
  },
  {
    id: 'next-pages',
    name: 'Next.js Pages Router',
    description: 'Next.js with Pages Router and react-i18next',
    tags: ['next', 'react', 'pages-router'],
    config: {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'public/locales',
      include: ['pages/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
      exclude: ['.next/**', '**/*.test.*'],
      translationAdapter: {
        module: 'react-i18next',
        hookName: 'useTranslation',
      },
      keyGeneration: {
        namespace: 'common',
        shortHashLen: 6,
      },
    },
  },
  {
    id: 'vue3',
    name: 'Vue 3 with vue-i18n',
    description: 'Vue 3 SFC application with Composition API',
    tags: ['vue', 'vue3', 'composition-api', 'sfc'],
    config: {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'src/locales',
      include: ['src/**/*.vue', 'src/**/*.{ts,js}'],
      exclude: ['**/*.test.*', '**/*.spec.*'],
      translationAdapter: {
        module: 'vue-i18n',
        hookName: 'useI18n',
      },
      keyGeneration: {
        namespace: 'common',
        shortHashLen: 6,
      },
    },
  },
  {
    id: 'nuxt3',
    name: 'Nuxt 3',
    description: 'Nuxt 3 with @nuxtjs/i18n module',
    tags: ['nuxt', 'vue', 'ssr', 'auto-imports'],
    config: {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      include: ['**/*.vue', 'composables/**/*.ts', 'pages/**/*.ts', 'components/**/*.ts'],
      exclude: ['.nuxt/**', '.output/**', '**/*.test.*'],
      translationAdapter: {
        module: 'vue-i18n',
        hookName: 'useI18n',
      },
      keyGeneration: {
        namespace: 'common',
        shortHashLen: 6,
      },
    },
  },
  {
    id: 'svelte',
    name: 'Svelte with svelte-i18n',
    description: 'Svelte/SvelteKit application',
    tags: ['svelte', 'sveltekit', 'stores'],
    config: {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'src/lib/locales',
      include: ['src/**/*.svelte', 'src/**/*.{ts,js}'],
      exclude: ['.svelte-kit/**', '**/*.test.*'],
      translationAdapter: {
        module: 'svelte-i18n',
        hookName: 't',
      },
      keyGeneration: {
        namespace: 'common',
        shortHashLen: 6,
      },
    },
  },
  {
    id: 'minimal',
    name: 'Minimal Setup',
    description: 'Basic configuration for any JavaScript project',
    tags: ['generic', 'minimal'],
    config: {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      include: ['**/*.{ts,tsx,js,jsx}'],
      exclude: ['node_modules/**', 'dist/**', '**/*.test.*'],
      translationAdapter: {
        module: 'react-i18next',
        hookName: 'useTranslation',
      },
      keyGeneration: {
        namespace: 'common',
        shortHashLen: 6,
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Project Intelligence Service
// ─────────────────────────────────────────────────────────────────────────────

export class ProjectIntelligenceService implements IProjectIntelligenceService {
  private cache: Map<string, { result: ProjectIntelligence; timestamp: number }> = new Map();

  /**
   * Analyze a project and return comprehensive intelligence.
   */
  async analyze(options?: DetectionOptions): Promise<ProjectIntelligence> {
    const opts = { ...DEFAULT_DETECTION_OPTIONS, ...options };
    const workspaceRoot = opts.workspaceRoot;

    // Check cache
    if (opts.useCache) {
      const cached = this.cache.get(workspaceRoot);
      if (cached && Date.now() - cached.timestamp < (opts.cacheDuration ?? 30000)) {
        return cached.result;
      }
    }

    // Run detectors
    const framework = opts.skip?.framework
      ? this.getDefaultFramework()
      : await new FrameworkDetector({ workspaceRoot, verbose: opts.verbose }).detect();

    const filePatterns = opts.skip?.filePatterns
      ? this.getDefaultFilePatterns()
      : await new FilePatternDetector({
          workspaceRoot,
          frameworkType: framework.type,
          verbose: opts.verbose,
        }).detect();

    const locales = opts.skip?.locales
      ? this.getDefaultLocales()
      : await new LocaleDetector({
          workspaceRoot,
          frameworkType: framework.type,
          verbose: opts.verbose,
        }).detect();

    // Detect existing setup
    const existingSetup = opts.skip?.existingSetup
      ? this.getDefaultExistingSetup()
      : await this.detectExistingSetup(workspaceRoot, framework.adapter);

    // Calculate confidence scores
    const confidence = new ConfidenceScorer().calculate({
      framework,
      filePatterns,
      locales,
      existingSetup,
    });

    // Generate suggested config
    const suggestedConfig = this.generateConfig({
      framework,
      filePatterns,
      existingSetup,
      locales,
      confidence,
      suggestedConfig: {} as SuggestedConfig,
      warnings: [],
      recommendations: [],
    });

    // Generate warnings
    const warnings = this.generateWarnings(framework, filePatterns, locales, existingSetup);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      framework,
      filePatterns,
      locales,
      existingSetup,
      confidence.level
    );

    const result: ProjectIntelligence = {
      framework,
      filePatterns,
      existingSetup,
      locales,
      confidence,
      suggestedConfig,
      warnings,
      recommendations,
    };

    // Update cache
    this.cache.set(workspaceRoot, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * Get available configuration templates.
   */
  getTemplates(): ConfigTemplate[] {
    return CONFIG_TEMPLATES;
  }

  /**
   * Get a specific template by ID.
   */
  getTemplate(id: string): ConfigTemplate | undefined {
    return CONFIG_TEMPLATES.find((t) => t.id === id);
  }

  /**
   * Generate a configuration from detection results.
   */
  generateConfig(intelligence: ProjectIntelligence): SuggestedConfig {
    const { framework, filePatterns, locales } = intelligence;

    // Get framework signature for defaults
    const signature = FRAMEWORK_SIGNATURES.find((s) => s.type === framework.type);

    return {
      sourceLanguage: locales.sourceLanguage,
      targetLanguages: locales.targetLanguages,
      localesDir: locales.localesDir,
      include: filePatterns.include.length > 0
        ? filePatterns.include
        : signature?.includePatterns ?? ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: filePatterns.exclude.length > 0
        ? filePatterns.exclude
        : signature?.excludePatterns ?? ['node_modules/**', '**/*.test.*'],
      translationAdapter: {
        module: framework.adapter,
        hookName: framework.hookName,
      },
      keyGeneration: {
        namespace: 'common',
        shortHashLen: 6,
      },
    };
  }

  /**
   * Apply a template to detection results.
   */
  applyTemplate(templateId: string, intelligence: ProjectIntelligence): SuggestedConfig {
    const template = this.getTemplate(templateId);
    if (!template) {
      return this.generateConfig(intelligence);
    }

    // Merge template with detected values
    return {
      sourceLanguage: intelligence.locales.sourceLanguage || template.config.sourceLanguage || 'en',
      targetLanguages:
        intelligence.locales.targetLanguages.length > 0
          ? intelligence.locales.targetLanguages
          : template.config.targetLanguages || [],
      localesDir: intelligence.locales.localesDir || template.config.localesDir || 'locales',
      include: template.config.include || intelligence.filePatterns.include,
      exclude: template.config.exclude || intelligence.filePatterns.exclude,
      translationAdapter: template.config.translationAdapter || {
        module: intelligence.framework.adapter,
        hookName: intelligence.framework.hookName,
      },
      keyGeneration: template.config.keyGeneration || {
        namespace: 'common',
        shortHashLen: 6,
      },
    };
  }

  /**
   * Clear detection cache.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Detect existing i18n setup in the project.
   */
  private async detectExistingSetup(
    workspaceRoot: string,
    adapter: string
  ): Promise<ExistingSetupDetection> {
    const configPath = path.join(workspaceRoot, 'i18n.config.json');
    let hasExistingConfig = false;

    try {
      await fs.access(configPath);
      hasExistingConfig = true;
    } catch {
      hasExistingConfig = false;
    }

    // Detect runtime packages
    const runtimePackages = await this.detectRuntimePackages(workspaceRoot);

    // Detect translation usage (simplified)
    const translationUsage = await this.detectTranslationUsage(workspaceRoot, adapter);

    return {
      hasExistingConfig,
      configPath: hasExistingConfig ? configPath : undefined,
      hasExistingLocales: false, // Will be filled by locale detector
      localesDir: undefined,
      hasI18nProvider: false, // Simplified for now
      providerPath: undefined,
      runtimePackages,
      translationUsage,
    };
  }

  /**
   * Detect i18n runtime packages from package.json.
   */
  private async detectRuntimePackages(workspaceRoot: string): Promise<PIRuntimePackageInfo[]> {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const i18nPackages = [
      'react-i18next',
      'i18next',
      'next-i18next',
      'next-intl',
      'vue-i18n',
      '@nuxtjs/i18n',
      'svelte-i18n',
      '@lingui/core',
      '@lingui/react',
      'react-intl',
      '@ngx-translate/core',
    ];

    try {
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const deps = pkg.dependencies || {};
      const devDeps = pkg.devDependencies || {};
      const result: PIRuntimePackageInfo[] = [];

      for (const name of i18nPackages) {
        if (deps[name]) {
          result.push({ name, version: deps[name], source: 'dependencies' });
        } else if (devDeps[name]) {
          result.push({ name, version: devDeps[name], source: 'devDependencies' });
        }
      }

      return result;
    } catch {
      return [];
    }
  }

  /**
   * Detect translation usage in source files.
   */
  private async detectTranslationUsage(
    _workspaceRoot: string,
    adapter: string
  ): Promise<TranslationUsageInfo> {
    // Simplified implementation - full implementation would scan files
    const hookName = getAdapterHook(adapter);

    return {
      hookName,
      translationIdentifier: 't',
      filesWithHooks: 0,
      translationCalls: 0,
      exampleFiles: [],
    };
  }

  /**
   * Generate warnings from detection results.
   */
  private generateWarnings(
    framework: ProjectIntelligence['framework'],
    filePatterns: ProjectIntelligence['filePatterns'],
    locales: ProjectIntelligence['locales'],
    existingSetup: ExistingSetupDetection
  ): DetectionWarning[] {
    const warnings: DetectionWarning[] = [];

    // No framework detected
    if (framework.type === 'unknown') {
      warnings.push({
        severity: 'warn',
        code: 'NO_FRAMEWORK',
        message: 'Could not detect framework from package.json',
        suggestion: 'Ensure your project has a package.json with framework dependencies',
      });
    }

    // No source files found
    if (filePatterns.sourceFileCount === 0) {
      warnings.push({
        severity: 'error',
        code: 'NO_SOURCE_FILES',
        message: 'No source files found matching the include patterns',
        suggestion: 'Check that your source directory exists and contains .ts/.tsx/.js/.jsx files',
      });
    }

    // No i18n package
    if (existingSetup.runtimePackages.length === 0) {
      warnings.push({
        severity: 'info',
        code: 'NO_I18N_PACKAGE',
        message: 'No i18n runtime package detected',
        suggestion: `Consider installing ${framework.adapter} for your ${framework.type} project`,
      });
    }

    // Existing config found
    if (existingSetup.hasExistingConfig) {
      warnings.push({
        severity: 'info',
        code: 'CONFIG_EXISTS',
        message: 'An i18n.config.json file already exists',
        filePath: existingSetup.configPath,
        suggestion: 'Use --force to overwrite or --merge to update existing config',
      });
    }

    // Parse errors in locale files
    for (const file of locales.existingFiles) {
      if (file.parseError) {
        warnings.push({
          severity: 'error',
          code: 'LOCALE_PARSE_ERROR',
          message: `Failed to parse locale file: ${file.parseError}`,
          filePath: file.path,
          suggestion: 'Fix the JSON syntax error in the locale file',
        });
      }
    }

    return warnings;
  }

  /**
   * Generate recommendations based on detection results.
   */
  private generateRecommendations(
    framework: ProjectIntelligence['framework'],
    filePatterns: ProjectIntelligence['filePatterns'],
    locales: ProjectIntelligence['locales'],
    existingSetup: ExistingSetupDetection,
    confidenceLevel: string
  ): string[] {
    const recommendations: string[] = [];

    // Low confidence
    if (confidenceLevel === 'low' || confidenceLevel === 'uncertain') {
      recommendations.push('Run "i18nsmith init" interactively to customize the configuration');
    }

    // No locales found
    if (locales.existingFiles.length === 0) {
      recommendations.push(
        `Create a locales directory at ${locales.localesDir}/ with your source locale file`
      );
    }

    // Missing target locales
    if (locales.targetLanguages.length === 0 && locales.existingFiles.length > 0) {
      recommendations.push('Add target languages to translate your content to');
    }

    // No i18n package installed
    if (existingSetup.runtimePackages.length === 0) {
      const installCmd = this.getInstallCommand(framework.adapter);
      recommendations.push(`Install the i18n runtime: ${installCmd}`);
    }

    // Large number of source files
    if (filePatterns.sourceFileCount > 1000) {
      recommendations.push(
        'Consider narrowing your include patterns for better performance'
      );
    }

    // TypeScript project without .tsx in patterns
    if (filePatterns.hasTypeScript && !filePatterns.include.some((p) => p.includes('tsx'))) {
      recommendations.push('Add .tsx extension to include patterns for React components');
    }

    return recommendations;
  }

  /**
   * Get install command for an adapter.
   */
  private getInstallCommand(adapter: string): string {
    const packages: Record<string, string[]> = {
      'react-i18next': ['react-i18next', 'i18next'],
      'next-intl': ['next-intl'],
      'vue-i18n': ['vue-i18n'],
      'svelte-i18n': ['svelte-i18n'],
      '@lingui/react': ['@lingui/core', '@lingui/react'],
    };

    const deps = packages[adapter] || [adapter];
    return `npm install ${deps.join(' ')}`;
  }

  /**
   * Default framework when detection is skipped.
   */
  private getDefaultFramework(): ProjectIntelligence['framework'] {
    return {
      type: 'unknown',
      adapter: 'react-i18next',
      hookName: 'useTranslation',
      features: [],
      confidence: 0,
      evidence: [],
    };
  }

  /**
   * Default file patterns when detection is skipped.
   */
  private getDefaultFilePatterns(): ProjectIntelligence['filePatterns'] {
    return {
      include: ['src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['node_modules/**', '**/*.test.*'],
      sourceDirectories: ['src'],
      hasTypeScript: false,
      hasJsx: false,
      hasVue: false,
      hasSvelte: false,
      sourceFileCount: 0,
      confidence: 0,
    };
  }

  /**
   * Default locales when detection is skipped.
   */
  private getDefaultLocales(): ProjectIntelligence['locales'] {
    return {
      sourceLanguage: 'en',
      targetLanguages: [],
      localesDir: 'locales',
      format: 'auto',
      existingFiles: [],
      existingKeyCount: 0,
      confidence: 0,
    };
  }

  /**
   * Default existing setup when detection is skipped.
   */
  private getDefaultExistingSetup(): ExistingSetupDetection {
    return {
      hasExistingConfig: false,
      hasExistingLocales: false,
      hasI18nProvider: false,
      runtimePackages: [],
      translationUsage: {
        hookName: 'useTranslation',
        translationIdentifier: 't',
        filesWithHooks: 0,
        translationCalls: 0,
        exampleFiles: [],
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze a project and return comprehensive intelligence.
 *
 * @example
 * ```typescript
 * const result = await analyzeProject('/path/to/project');
 * console.log(result.framework.type);    // 'next'
 * console.log(result.confidence.level);  // 'high'
 * console.log(result.suggestedConfig);   // { ... }
 * ```
 */
export async function analyzeProject(
  workspaceRoot: string,
  options?: Omit<DetectionOptions, 'workspaceRoot'>
): Promise<ProjectIntelligence> {
  const service = new ProjectIntelligenceService();
  return service.analyze({ ...options, workspaceRoot });
}
