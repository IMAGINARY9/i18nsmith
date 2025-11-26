import { describe, expect, it } from 'vitest';
import type { DiagnoseConflict } from '@i18nsmith/core';
import { selectExitSignal } from './diagnostics-exit';

describe('selectExitSignal', () => {
  it('returns null when there are no conflicts', () => {
    expect(selectExitSignal([])).toBeNull();
  });

  it('returns the mapped exit code for missing source locale conflicts', () => {
    const conflicts: DiagnoseConflict[] = [
      { kind: 'missing-source-locale', message: 'Source locale missing' },
    ];

    const result = selectExitSignal(conflicts);
    expect(result).toEqual({ code: 2, reason: 'Missing source locale file' });
  });

  it('prefers higher severity codes when multiple conflicts exist', () => {
    const conflicts: DiagnoseConflict[] = [
      { kind: 'missing-source-locale', message: 'Source missing' },
      { kind: 'invalid-locale-json', message: 'Invalid JSON detected' },
    ];

    const result = selectExitSignal(conflicts);
    expect(result).toEqual({ code: 3, reason: 'Locale JSON could not be parsed' });
  });

  it('falls back to a general conflict exit code for unknown kinds', () => {
    const conflicts: DiagnoseConflict[] = [
      { kind: 'custom-conflict', message: 'Something unexpected happened' },
    ];

    const result = selectExitSignal(conflicts);
    expect(result).toEqual({ code: 5, reason: 'Something unexpected happened' });
  });
});
