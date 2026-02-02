/**
 * Confidence Scorer
 *
 * Calculates overall confidence scores from individual detector results.
 *
 * @module @i18nsmith/core/project-intelligence
 */

import type {
  FrameworkDetection,
  FilePatternDetection,
  LocaleDetection,
  ExistingSetupDetection,
  ConfidenceScores,
  ConfidenceLevel,
} from './types.js';
import { CONFIDENCE_THRESHOLDS } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoringInput {
  framework: FrameworkDetection;
  filePatterns: FilePatternDetection;
  locales: LocaleDetection;
  existingSetup?: ExistingSetupDetection;
}

// ─────────────────────────────────────────────────────────────────────────────
// Confidence Scorer Class
// ─────────────────────────────────────────────────────────────────────────────

export class ConfidenceScorer {
  /**
   * Calculate confidence scores from detection results.
   */
  calculate(input: ScoringInput): ConfidenceScores {
    const frameworkScore = input.framework.confidence;
    const filePatternsScore = input.filePatterns.confidence;
    const localesScore = input.locales.confidence;

    // Calculate existing setup score if available
    const existingSetupScore = input.existingSetup
      ? this.calculateExistingSetupScore(input.existingSetup)
      : 0;

    // Calculate weighted overall score
    const overall = this.calculateOverallScore({
      framework: frameworkScore,
      filePatterns: filePatternsScore,
      locales: localesScore,
      existingSetup: existingSetupScore,
    });

    // Determine confidence level
    const level = this.determineLevel(overall);

    return {
      framework: frameworkScore,
      filePatterns: filePatternsScore,
      existingSetup: existingSetupScore,
      locales: localesScore,
      overall,
      level,
    };
  }

  /**
   * Calculate existing setup confidence score.
   */
  private calculateExistingSetupScore(setup: ExistingSetupDetection): number {
    let score = 0;

    // Has i18n runtime packages
    if (setup.runtimePackages.length > 0) {
      score += 0.3;
    }

    // Has existing locales
    if (setup.hasExistingLocales) {
      score += 0.3;
    }

    // Has i18n provider
    if (setup.hasI18nProvider) {
      score += 0.2;
    }

    // Has translation usage in code
    if (setup.translationUsage.filesWithHooks > 0 || setup.translationUsage.translationCalls > 0) {
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  /**
   * Calculate weighted overall score.
   */
  private calculateOverallScore(scores: {
    framework: number;
    filePatterns: number;
    locales: number;
    existingSetup: number;
  }): number {
    // Weights for each component
    const weights = {
      framework: 0.35, // Framework detection is most important
      filePatterns: 0.25, // File patterns are important for scanning
      locales: 0.25, // Locale detection affects config
      existingSetup: 0.15, // Existing setup is a bonus
    };

    const weighted =
      scores.framework * weights.framework +
      scores.filePatterns * weights.filePatterns +
      scores.locales * weights.locales +
      scores.existingSetup * weights.existingSetup;

    // Boost if multiple high-confidence detections
    let boost = 0;
    const highConfidenceCount = [
      scores.framework,
      scores.filePatterns,
      scores.locales,
    ].filter((s) => s >= CONFIDENCE_THRESHOLDS.HIGH).length;

    if (highConfidenceCount >= 2) {
      boost = 0.1;
    }

    return Math.min(weighted + boost, 1);
  }

  /**
   * Determine confidence level from score.
   */
  private determineLevel(score: number): ConfidenceLevel {
    if (score >= CONFIDENCE_THRESHOLDS.HIGH) {
      return 'high';
    }
    if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      return 'medium';
    }
    if (score >= CONFIDENCE_THRESHOLDS.LOW) {
      return 'low';
    }
    return 'uncertain';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate confidence scores from detection results.
 *
 * @example
 * ```typescript
 * const scores = calculateConfidence({
 *   framework: frameworkResult,
 *   filePatterns: filePatternsResult,
 *   locales: localesResult,
 * });
 * console.log(scores.overall); // 0.85
 * console.log(scores.level);   // 'high'
 * ```
 */
export function calculateConfidence(input: ScoringInput): ConfidenceScores {
  const scorer = new ConfidenceScorer();
  return scorer.calculate(input);
}
