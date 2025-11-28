import { describe, expect, it } from 'vitest';
import type { DiagnoseConflict } from '@i18nsmith/core';
import { selectExitSignal } from './diagnostics-exit';
import { DIAGNOSTICS_EXIT_CODES, DIAGNOSTICS_EXIT_DESCRIPTIONS } from './exit-codes';

describe('selectExitSignal', () => {
  it('returns null when there are no conflicts', () => {
    expect(selectExitSignal([])).toBeNull();
  });

  it('returns the mapped exit code for missing source locale conflicts', () => {
    const conflicts: DiagnoseConflict[] = [
      { kind: 'missing-source-locale', message: 'Source locale missing' },
    ];

    const result = selectExitSignal(conflicts);
    expect(result).toEqual({
      code: DIAGNOSTICS_EXIT_CODES.MISSING_SOURCE_LOCALE,
      reason: DIAGNOSTICS_EXIT_DESCRIPTIONS[DIAGNOSTICS_EXIT_CODES.MISSING_SOURCE_LOCALE],
    });
  });

  it('prefers higher severity codes when multiple conflicts exist', () => {
    const conflicts: DiagnoseConflict[] = [
      { kind: 'missing-source-locale', message: 'Source missing' },
      { kind: 'invalid-locale-json', message: 'Invalid JSON detected' },
    ];

    const result = selectExitSignal(conflicts);
    expect(result).toEqual({
      code: DIAGNOSTICS_EXIT_CODES.INVALID_LOCALE_JSON,
      reason: DIAGNOSTICS_EXIT_DESCRIPTIONS[DIAGNOSTICS_EXIT_CODES.INVALID_LOCALE_JSON],
    });
  });

  it('falls back to a general conflict exit code for unknown kinds', () => {
    const conflicts: DiagnoseConflict[] = [
      { kind: 'custom-conflict', message: 'Something unexpected happened' },
    ];

    const result = selectExitSignal(conflicts);
    expect(result).toEqual({
      code: DIAGNOSTICS_EXIT_CODES.GENERAL_CONFLICT,
      reason: 'Something unexpected happened',
    });
  });
});
