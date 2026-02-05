/**
 * Framework Support Types for i18nsmith
 *
 * Defines the core abstractions for multi-framework scanning and mutation.
 * Each framework (React, Vue, Svelte, etc.) implements the FrameworkAdapter
 * interface to provide framework-specific parsing and code transformation.
 */

import type { I18nConfig } from '../config/index.js';
import type { ScanCandidate } from '../scanner.js';

/**
 * Status of a transformation candidate.
 */
export type CandidateStatus =
  | 'pending'
  | 'duplicate'
  | 'existing'
  | 'applied'
  | 'skipped';

/**
 * A candidate for transformation, extending ScanCandidate with transformation metadata.
 */
export interface TransformCandidate extends ScanCandidate {
  suggestedKey: string;
  hash: string;
  status: CandidateStatus;
  reason?: string;
}

/**
 * Capabilities that a framework adapter can declare.
 * Used for preflight checks and feature detection.
 */
export interface AdapterCapabilities {
  /** Adapter can scan files to produce candidates */
  scan: boolean;
  /** Adapter can apply AST-safe mutations (transform/rename) */
  mutate: boolean;
  /** Adapter can generate source-level diffs */
  diff: boolean;
}

/**
 * Result of checking if a dependency is available at runtime.
 */
export interface AdapterDependencyCheck {
  /** Human-readable name of the dependency */
  name: string;
  /** Install command hint for the user */
  installHint: string;
  /** Whether it's available at runtime */
  available: boolean;
}

/**
 * A single edit operation to apply to source code.
 */
export interface MutationEdit {
  /** 0-based byte offset — start */
  start: number;
  /** 0-based byte offset — end (exclusive) */
  end: number;
  /** Replacement text */
  replacement: string;
}

/**
 * Result of applying mutations to a file.
 */
export interface MutationResult {
  /** Whether any edits were applied */
  didMutate: boolean;
  /** The resulting file content after all edits */
  content: string;
  /** Individual edits applied (for diff generation) */
  edits: MutationEdit[];
}

/**
 * Core adapter interface that every framework must implement.
 * Provides a uniform API for scanning and mutating files across frameworks.
 */
export interface FrameworkAdapter {
  /** Unique adapter id, e.g. 'react', 'vue', 'svelte' */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Declare what this adapter can do */
  readonly capabilities: AdapterCapabilities;

  /** File extensions this adapter handles (e.g. ['.tsx','.jsx'] or ['.vue']) */
  readonly extensions: string[];

  /**
   * Check that all runtime dependencies (parsers, compilers) are available.
   * Returns a list of dependency statuses.  Transformer uses this for
   * preflight validation before mutating operations.
   */
  checkDependencies(): AdapterDependencyCheck[];

  /**
   * Scan a single file and return framework-agnostic ScanCandidates.
   * The adapter is responsible for parsing the file using whatever
   * framework-specific tooling it needs.
   */
  scan(filePath: string, content: string, options?: AdapterScanOptions): ScanCandidate[];

  /**
   * Apply a batch of mutations to a single file.
   * The adapter receives the original content and a list of candidates
   * with their suggested keys, and returns the mutated content.
   *
   * The adapter is responsible for:
   * - Locating each candidate in the file
   * - Replacing text with t('key') / $t('key') / equivalent
   * - Inserting imports/bindings as needed by the framework
   * - Returning the full mutated content
   */
  mutate(
    filePath: string,
    content: string,
    candidates: TransformCandidate[],
    options: AdapterMutateOptions
  ): MutationResult;
}

/**
 * Options passed to adapter.scan()
 */
export interface AdapterScanOptions {
  /** Whether to scan for function calls (e.g., t('key')) */
  scanCalls?: boolean;
  /** The i18n configuration */
  config: I18nConfig;
  /** Root directory of the workspace */
  workspaceRoot: string;
}

/**
 * Options passed to adapter.mutate()
 */
export interface AdapterMutateOptions {
  /** The i18n configuration */
  config: I18nConfig;
  /** Root directory of the workspace */
  workspaceRoot: string;
  /** Translation adapter configuration (module, hookName) */
  translationAdapter: { module: string; hookName: string };
  /** When false, adapter must fail-fast if dependencies are missing */
  allowFallback?: boolean;
}