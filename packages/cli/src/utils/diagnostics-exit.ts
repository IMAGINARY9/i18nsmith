import type { DiagnoseConflict, DiagnosisReport } from '@i18nsmith/core';

export interface DiagnosisExitSignal {
  code: number;
  reason: string;
}

const DEFAULT_CONFLICT_CODE = 5;

const CONFLICT_EXIT_SIGNALS: Record<string, DiagnosisExitSignal> = {
  'missing-source-locale': {
    code: 2,
    reason: 'Missing source locale file',
  },
  'invalid-locale-json': {
    code: 3,
    reason: 'Locale JSON could not be parsed',
  },
  'unsafe-provider-clash': {
    code: 4,
    reason: 'Potential provider or adapter clash detected',
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
      code: DEFAULT_CONFLICT_CODE,
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
  return entries.concat({ code: DEFAULT_CONFLICT_CODE, reason: 'General diagnostics conflict' });
}
