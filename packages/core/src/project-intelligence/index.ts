/**
 * Project Intelligence Module
 * 
 * This module provides intelligent project analysis for automatic
 * configuration generation. It detects frameworks, file patterns,
 * existing i18n setup, and locale files to suggest optimal configuration.
 * 
 * @example
 * ```typescript
 * import { ProjectIntelligenceService, analyzeProject } from '@i18nsmith/core/project-intelligence';
 * 
 * // Using the service
 * const service = new ProjectIntelligenceService();
 * const result = await service.analyze({ workspaceRoot: '/path/to/project' });
 * 
 * // Or use the standalone function
 * const result = await analyzeProject('/path/to/project');
 * 
 * console.log(result.framework.type);        // 'next'
 * console.log(result.framework.adapter);      // 'react-i18next'
 * console.log(result.confidence.overall);     // 0.92
 * ```
 * 
 * @module @i18nsmith/core/project-intelligence
 */

// Types
export type {
  FrameworkType,
  NextRouterType,
  FrameworkDetection,
  DetectionEvidence,
  FilePatternDetection,
  ExistingSetupDetection,
  PIRuntimePackageInfo,
  TranslationUsageInfo,
  PILocaleFormat,
  LocaleDetection,
  LocaleFileInfo,
  ConfidenceScores,
  ConfidenceLevel,
  ProjectIntelligence,
  SuggestedConfig,
  DetectionWarning,
  ConfigTemplate,
  DetectionOptions,
  ProjectIntelligenceService as IProjectIntelligenceService,
  FrameworkSignature,
} from './types.js';

// Constants
export { CONFIDENCE_THRESHOLDS, DEFAULT_DETECTION_OPTIONS } from './types.js';

// Signatures
export {
  FRAMEWORK_SIGNATURES,
  getFrameworkSignature,
  getSignaturesByPriority,
  I18N_ADAPTER_HOOKS,
  getAdapterHook,
  UNIVERSAL_EXCLUDE_PATTERNS,
  BUILD_OUTPUT_PATTERNS,
  TEST_FILE_PATTERNS,
  CONFIG_FILE_PATTERNS,
  STORYBOOK_PATTERNS,
} from './signatures.js';

// Framework Detector
export { FrameworkDetector, detectFramework } from './framework-detector.js';

// File Pattern Detector
export { FilePatternDetector, detectFilePatterns } from './file-pattern-detector.js';

// Locale Detector
export { LocaleDetector, detectLocales } from './locale-detector.js';

// Confidence Scorer
export { ConfidenceScorer, calculateConfidence } from './confidence-scorer.js';

// Main Service
export { ProjectIntelligenceService, analyzeProject } from './service.js';
