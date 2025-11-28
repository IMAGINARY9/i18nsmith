import type { DiagnoseConflict, DiagnosisReport } from '@i18nsmith/core';
import { DIAGNOSTICS_EXIT_CODES, DIAGNOSTICS_EXIT_DESCRIPTIONS } from './exit-codes.js';

export interface DiagnosisExitSignal {
  code: number;
  reason: string;
}

const CONFLICT_EXIT_SIGNALS: Record<string, DiagnosisExitSignal> = {
  'missing-source-locale': {
    code: DIAGNOSTICS_EXIT_CODES.MISSING_SOURCE_LOCALE,
    reason: DIAGNOSTICS_EXIT_DESCRIPTIONS[DIAGNOSTICS_EXIT_CODES.MISSING_SOURCE_LOCALE],
  },
  'invalid-locale-json': {
    code: DIAGNOSTICS_EXIT_CODES.INVALID_LOCALE_JSON,
    reason: DIAGNOSTICS_EXIT_DESCRIPTIONS[DIAGNOSTICS_EXIT_CODES.INVALID_LOCALE_JSON],
  },
  'unsafe-provider-clash': {
    code: DIAGNOSTICS_EXIT_CODES.UNSAFE_PROVIDER_CLASH,
    reason: DIAGNOSTICS_EXIT_DESCRIPTIONS[DIAGNOSTICS_EXIT_CODES.UNSAFE_PROVIDER_CLASH],
  },
};

export function getDiagnosisExitSignal(report: Pick<DiagnosisReport, 'conflicts'>): DiagnosisExitSignal | null {
  return selectExitSignal(report.conflicts);
}

export function selectExitSignal(conflicts: DiagnoseConflict[]): DiagnosisExitSignal | null {
  if (!conflicts.length) {
    return null;
  }

  let chosen: DiagnosisExitSignal | null = null;

  for (const conflict of conflicts) {
    const knownSignal = CONFLICT_EXIT_SIGNALS[conflict.kind];
    if (knownSignal) {
      if (!chosen || knownSignal.code > chosen.code) {
        chosen = knownSignal;
      }
      continue;
    }

    const fallbackSignal: DiagnosisExitSignal = {
      code: DIAGNOSTICS_EXIT_CODES.GENERAL_CONFLICT,
      reason: conflict.message,
    };

    if (!chosen || fallbackSignal.code > chosen.code) {
      chosen = fallbackSignal;
    }
  }

  return chosen;
}

export function describeDiagnosisExitCodes(): Array<{ code: number; reason: string }> {
  const entries = Object.values(CONFLICT_EXIT_SIGNALS).sort((a, b) => a.code - b.code);
  return entries.concat({
    code: DIAGNOSTICS_EXIT_CODES.GENERAL_CONFLICT,
    reason: DIAGNOSTICS_EXIT_DESCRIPTIONS[DIAGNOSTICS_EXIT_CODES.GENERAL_CONFLICT],
  });
}
