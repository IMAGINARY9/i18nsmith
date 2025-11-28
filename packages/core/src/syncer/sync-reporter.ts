import type { ActionableItem } from '../actionable.js';
import type { SuspiciousKeyPolicy } from '../config.js';
import type { DynamicKeyWarning } from '../reference-extractor.js';
import type { PlaceholderIssue, EmptyValueViolation } from './sync-validator.js';

/**
 * Missing key record from sync analysis
 */
export interface MissingKeyRecord {
  key: string;
  references: Array<{
    filePath: string;
    position: { line: number; column: number };
  }>;
  suspicious?: boolean;
}

/**
 * Unused key record from sync analysis
 */
export interface UnusedKeyRecord {
  key: string;
  locales: string[];
}

/**
 * Suspicious key warning from sync analysis
 */
export interface SuspiciousKeyWarning {
  key: string;
  filePath: string;
  position: {
    line: number;
    column: number;
  };
  reason: string;
}

/**
 * Validation state for sync operation
 */
export interface SyncValidationState {
  interpolations: boolean;
  emptyValuePolicy: 'ignore' | 'warn' | 'fail';
}

/**
 * Input for building actionable items
 */
export interface BuildActionableItemsInput {
  missingKeys: MissingKeyRecord[];
  unusedKeys: UnusedKeyRecord[];
  placeholderIssues: PlaceholderIssue[];
  emptyValueViolations: EmptyValueViolation[];
  dynamicKeyWarnings: DynamicKeyWarning[];
  suspiciousKeys: SuspiciousKeyWarning[];
  validation: SyncValidationState;
  assumedKeys: string[];
  suspiciousKeyPolicy: SuspiciousKeyPolicy;
}

/**
 * Builds a list of actionable items from sync analysis results.
 * These items are used to report issues to the user with severity levels.
 */
export function buildActionableItems(input: BuildActionableItemsInput): ActionableItem[] {
  const items: ActionableItem[] = [];

  const suspiciousSeverity = input.suspiciousKeyPolicy === 'error' ? 'error' : 'warn';
  const skipWrite = input.suspiciousKeyPolicy !== 'allow';
  input.suspiciousKeys.forEach((warning) => {
    items.push({
      kind: 'suspicious-key',
      severity: suspiciousSeverity,
      key: warning.key,
      filePath: warning.filePath,
      message: `Suspicious key format detected: "${warning.key}" (contains spaces)${
        skipWrite ? ' — auto-insert skipped until the key is renamed.' : ''
      }`,
      details: {
        reason: warning.reason,
        policy: input.suspiciousKeyPolicy,
      },
    });
  });

  input.missingKeys.forEach((record) => {
    const reference = record.references[0];
    items.push({
      kind: 'missing-key',
      severity: 'error',
      key: record.key,
      filePath: reference?.filePath,
      message: `Key "${record.key}" referenced ${record.references.length} time${record.references.length === 1 ? '' : 's'} but missing from source locale`,
      details: {
        referenceCount: record.references.length,
      },
    });
  });

  input.unusedKeys.forEach((record) => {
    items.push({
      kind: 'unused-key',
      severity: 'warn',
      key: record.key,
      message: `Key "${record.key}" is present in locales (${record.locales.join(', ')}) but not referenced in code`,
      details: {
        locales: record.locales,
      },
    });
  });

  input.placeholderIssues.forEach((issue) => {
    items.push({
      kind: 'placeholder-mismatch',
      severity: 'error',
      key: issue.key,
      locale: issue.locale,
      message: `Placeholder mismatch for "${issue.key}" in ${issue.locale}`,
      details: {
        missing: issue.missing,
        extra: issue.extra,
      },
    });
  });

  if (input.validation.emptyValuePolicy !== 'ignore') {
    input.emptyValueViolations.forEach((violation) => {
      items.push({
        kind: 'empty-value',
        severity: input.validation.emptyValuePolicy === 'fail' ? 'error' : 'warn',
        key: violation.key,
        locale: violation.locale,
        message: `Empty locale value detected for "${violation.key}" in ${violation.locale} (${violation.reason})`,
      });
    });
  }

  input.dynamicKeyWarnings.forEach((warning) => {
    items.push({
      kind: 'dynamic-key-warning',
      severity: 'warn',
      key: warning.expression,
      filePath: warning.filePath,
      message: `Dynamic translation key detected in ${warning.filePath}:${warning.position.line}`,
      details: {
        reason: warning.reason,
      },
    });
  });

  if (input.assumedKeys.length) {
    items.push({
      kind: 'assumed-keys',
      severity: 'info',
      message: `Assuming runtime-only keys: ${input.assumedKeys.join(', ')}`,
      details: {
        keys: input.assumedKeys,
      },
    });
  }

  return items;
}
