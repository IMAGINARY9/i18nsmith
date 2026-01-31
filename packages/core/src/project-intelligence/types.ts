/**
 * Project Intelligence Types
 * 
 * These types define the structure for automatic project configuration detection.
 * Used by both CLI and VS Code extension for smart config generation.
 * 
 * @module @i18nsmith/core/project-intelligence
 */

// ─────────────────────────────────────────────────────────────────────────────
// Framework Detection Types
// ─────────────────────────────────────────────────────────────────────────────

export type FrameworkType = 
  | 'react' 
  | 'vue' 
  | 'next' 
  | 'nuxt' 
  | 'svelte' 
  | 'angular' 
  | 'unknown';

export type NextRouterType = 'app' | 'pages' | 'hybrid' | 'unknown';

export interface FrameworkDetection {
  /** Detected framework type */
  type: FrameworkType;
  
  /** Framework version if detectable */
  version?: string;
  
  /** Recommended i18n adapter module */
  adapter: string;
  
  /** Recommended translation hook name */
  hookName: string;
  
  /** Framework-specific features detected */
  features: string[];
  
  /** For Next.js: which router is in use */
  routerType?: NextRouterType;
  
  /** Detection confidence (0-1) */
  confidence: number;
  
  /** Evidence that led to this detection */
  evidence: DetectionEvidence[];
}

export interface DetectionEvidence {
  /** Type of evidence */
  type: 'package' | 'file' | 'pattern' | 'content';
  
  /** What was found */
  source: string;
  
  /** How much this contributed to confidence */
  weight: number;
  
  /** Human-readable description */
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// File Pattern Detection Types
// ─────────────────────────────────────────────────────────────────────────────

export interface FilePatternDetection {
  /** Recommended include glob patterns */
  include: string[];
  
  /** Recommended exclude glob patterns */
  exclude: string[];
  
  /** Main source directories found */
  sourceDirectories: string[];
  
  /** Project uses TypeScript */
  hasTypeScript: boolean;
  
  /** Project uses JSX/TSX files */
  hasJsx: boolean;
  
  /** Project has Vue SFC files */
  hasVue: boolean;
  
  /** Project has Svelte files */
  hasSvelte: boolean;
  
  /** Approximate count of source files */
  sourceFileCount: number;
  
  /** Detection confidence (0-1) */
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Existing Setup Detection Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ExistingSetupDetection {
  /** Config file already exists */
  hasExistingConfig: boolean;
  
  /** Path to existing config file */
  configPath?: string;
  
  /** Project has existing locale files */
  hasExistingLocales: boolean;
  
  /** Detected locales directory */
  localesDir?: string;
  
  /** Project has i18n provider component */
  hasI18nProvider: boolean;
  
  /** Path to provider component */
  providerPath?: string;
  
  /** i18n runtime packages found in dependencies */
  runtimePackages: RuntimePackageInfo[];
  
  /** Existing translation usage in code */
  translationUsage: TranslationUsageInfo;
}

export interface RuntimePackageInfo {
  /** Package name */
  name: string;
  
  /** Package version */
  version?: string;
  
  /** Found in dependencies or devDependencies */
  source: 'dependencies' | 'devDependencies';
}

export interface TranslationUsageInfo {
  /** Translation hook name in use */
  hookName: string;
  
  /** Translation function identifier (e.g., 't') */
  translationIdentifier: string;
  
  /** Number of files using translation hooks */
  filesWithHooks: number;
  
  /** Number of t() calls found */
  translationCalls: number;
  
  /** Example files using translations */
  exampleFiles: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Locale Detection Types
// ─────────────────────────────────────────────────────────────────────────────

export type LocaleFormat = 'flat' | 'nested' | 'namespaced' | 'auto';

export interface LocaleDetection {
  /** Detected/suggested source language */
  sourceLanguage: string;
  
  /** Detected target languages */
  targetLanguages: string[];
  
  /** Detected/suggested locales directory */
  localesDir: string;
  
  /** Locale file format */
  format: LocaleFormat;
  
  /** Existing locale files found */
  existingFiles: LocaleFileInfo[];
  
  /** Total count of existing translation keys */
  existingKeyCount: number;
  
  /** Detection confidence (0-1) */
  confidence: number;
}

export interface LocaleFileInfo {
  /** Locale code (e.g., 'en', 'en-US') */
  locale: string;
  
  /** Absolute path to file */
  path: string;
  
  /** Number of keys in file */
  keyCount: number;
  
  /** File size in bytes */
  bytes: number;
  
  /** File format */
  format: 'json' | 'yaml' | 'js' | 'ts';
  
  /** Parse errors if any */
  parseError?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Scores
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfidenceScores {
  /** Framework detection confidence */
  framework: number;
  
  /** File pattern detection confidence */
  filePatterns: number;
  
  /** Existing setup detection confidence */
  existingSetup: number;
  
  /** Locale detection confidence */
  locales: number;
  
  /** Overall detection confidence */
  overall: number;
  
  /** Confidence level classification */
  level: ConfidenceLevel;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'uncertain';

// ─────────────────────────────────────────────────────────────────────────────
// Complete Project Intelligence Result
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectIntelligence {
  /** Framework detection results */
  framework: FrameworkDetection;
  
  /** File pattern detection results */
  filePatterns: FilePatternDetection;
  
  /** Existing setup detection results */
  existingSetup: ExistingSetupDetection;
  
  /** Locale detection results */
  locales: LocaleDetection;
  
  /** Confidence scores */
  confidence: ConfidenceScores;
  
  /** Suggested configuration based on detection */
  suggestedConfig: SuggestedConfig;
  
  /** Warnings or issues found */
  warnings: DetectionWarning[];
  
  /** Recommended next steps */
  recommendations: string[];
}

export interface SuggestedConfig {
  sourceLanguage: string;
  targetLanguages: string[];
  localesDir: string;
  include: string[];
  exclude: string[];
  translationAdapter: {
    module: string;
    hookName: string;
  };
  keyGeneration: {
    namespace: string;
    shortHashLen: number;
  };
}

export interface DetectionWarning {
  /** Warning severity */
  severity: 'error' | 'warn' | 'info';
  
  /** Warning code for programmatic handling */
  code: string;
  
  /** Human-readable message */
  message: string;
  
  /** Related file path if applicable */
  filePath?: string;
  
  /** Suggested fix */
  suggestion?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Templates
// ─────────────────────────────────────────────────────────────────────────────

export interface ConfigTemplate {
  /** Template identifier */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Template description */
  description: string;
  
  /** Tags for filtering */
  tags: string[];
  
  /** Template configuration */
  config: Partial<SuggestedConfig>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection Options
// ─────────────────────────────────────────────────────────────────────────────

export interface DetectionOptions {
  /** Workspace root directory */
  workspaceRoot?: string;
  
  /** Skip certain detection phases */
  skip?: {
    framework?: boolean;
    filePatterns?: boolean;
    existingSetup?: boolean;
    locales?: boolean;
  };
  
  /** Use cached results if available */
  useCache?: boolean;
  
  /** Cache duration in milliseconds */
  cacheDuration?: number;
  
  /** Verbose logging */
  verbose?: boolean;
  
  /** Force specific framework (skip detection) */
  forceFramework?: FrameworkType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service Interface
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectIntelligenceService {
  /**
   * Analyze a project and return comprehensive intelligence.
   */
  analyze(options?: DetectionOptions): Promise<ProjectIntelligence>;
  
  /**
   * Get available configuration templates.
   */
  getTemplates(): ConfigTemplate[];
  
  /**
   * Get a specific template by ID.
   */
  getTemplate(id: string): ConfigTemplate | undefined;
  
  /**
   * Generate a configuration from detection results.
   */
  generateConfig(intelligence: ProjectIntelligence): SuggestedConfig;
  
  /**
   * Apply a template to detection results.
   */
  applyTemplate(templateId: string, intelligence: ProjectIntelligence): SuggestedConfig;
  
  /**
   * Clear detection cache.
   */
  clearCache(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Framework Signatures (for detection)
// ─────────────────────────────────────────────────────────────────────────────

export interface FrameworkSignature {
  /** Framework type */
  type: FrameworkType;
  
  /** Detection priority (lower = higher priority) */
  priority: number;
  
  /** Required packages (any match) */
  packages: string[];
  
  /** Optional packages that increase confidence */
  optionalPackages?: string[];
  
  /** Known i18n packages for this framework */
  i18nPackages: string[];
  
  /** Default adapter when no i18n package found */
  defaultAdapter: string;
  
  /** Default hook name */
  defaultHook: string;
  
  /** Default include patterns */
  includePatterns: string[];
  
  /** Default exclude patterns */
  excludePatterns: string[];
  
  /** Common locale directory locations */
  localesCandidates: string[];
  
  /** Files that indicate specific features */
  featureIndicators?: Record<string, string[]>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.3,
} as const;

export const DEFAULT_DETECTION_OPTIONS: Required<DetectionOptions> = {
  workspaceRoot: process.cwd(),
  skip: {},
  useCache: true,
  cacheDuration: 30000, // 30 seconds
  verbose: false,
  forceFramework: undefined as unknown as FrameworkType,
};
