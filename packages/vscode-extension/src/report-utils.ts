import type { ActionableItem, CheckReport } from './diagnostics';

export type IssueSeverityLevel = 'none' | 'info' | 'warn' | 'error';

export interface SeverityCounts {
  error: number;
  warn: number;
  info: number;
}

export interface IssueSummary {
  items: ActionableItem[];
  issueCount: number;
  severityCounts: SeverityCounts;
  dominantSeverity: IssueSeverityLevel;
}

type SuggestedCommand = NonNullable<CheckReport['suggestedCommands']>[number];

export interface SuggestionSummary {
  items: SuggestedCommand[];
  total: number;
  severityCounts: SeverityCounts;
  dominantSeverity: IssueSeverityLevel;
}

export interface StatusAssessment {
  level: IssueSeverityLevel;
  reasons: string[];
  warningCount: number;
  hardcodedCount: number;
  missingKeys: number;
}

const severityRank: Record<IssueSeverityLevel, number> = {
  none: 0,
  info: 1,
  warn: 2,
  error: 3,
};

type ExtendedSyncSection = {
  missingKeys?: unknown[];
  unusedKeys?: unknown[];
  placeholderIssues?: unknown[];
  emptyValueViolations?: unknown[];
  dynamicKeyWarnings?: unknown[];
  suspiciousKeys?: unknown[];
};

function createEmptySeverityCounts(): SeverityCounts {
  return { error: 0, warn: 0, info: 0 };
}

function buildActionableItemKey(item: ActionableItem): string {
  return [
    item.kind ?? 'unknown',
    item.message ?? '',
    item.filePath ?? '',
    item.line ?? '',
    item.column ?? '',
    item.key ?? '',
  ].join('|');
}

export function collectUniqueActionableItems(report?: CheckReport | null): ActionableItem[] {
  if (!report) {
    return [];
  }

  const combined: ActionableItem[] = [
    ...(report.actionableItems ?? []),
    ...(report.diagnostics?.actionableItems ?? []),
    ...(report.sync?.actionableItems ?? []),
  ];

  const seen = new Set<string>();
  const unique: ActionableItem[] = [];

  for (const item of combined) {
    const key = buildActionableItemKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function dominantFromCounts(counts: SeverityCounts): IssueSeverityLevel {
  if (counts.error > 0) return 'error';
  if (counts.warn > 0) return 'warn';
  if (counts.info > 0) return 'info';
  return 'none';
}

export function summarizeReportIssues(report?: CheckReport | null): IssueSummary {
  const items = collectUniqueActionableItems(report);
  const severityCounts = createEmptySeverityCounts();

  for (const item of items) {
    const severity = item.severity === 'error' ? 'error' : item.severity === 'warn' ? 'warn' : 'info';
    severityCounts[severity]++;
  }

  const dominantSeverity = dominantFromCounts(severityCounts);

  return {
    items,
    issueCount: items.length,
    severityCounts,
    dominantSeverity,
  };
}

export function summarizeSuggestedCommands(report?: CheckReport | null): SuggestionSummary {
  const raw = report?.suggestedCommands;
  const items: SuggestedCommand[] = Array.isArray(raw) ? [...raw] : [];

  const severityCounts = createEmptySeverityCounts();
  for (const item of items) {
    const severity = item.severity === 'error' ? 'error' : item.severity === 'warn' ? 'warn' : 'info';
    severityCounts[severity]++;
  }

  return {
    items,
    total: items.length,
    severityCounts,
    dominantSeverity: dominantFromCounts(severityCounts),
  };
}

function escalateLevel(current: IssueSeverityLevel, next: IssueSeverityLevel): IssueSeverityLevel {
  return severityRank[next] > severityRank[current] ? next : current;
}

export function assessStatusLevel(
  report?: CheckReport | null,
  options?: {
    issueSummary?: IssueSummary;
    suggestionSummary?: SuggestionSummary;
  }
): StatusAssessment {
  const issueSummary = options?.issueSummary ?? summarizeReportIssues(report);
  const suggestionSummary = options?.suggestionSummary ?? summarizeSuggestedCommands(report);

  const syncSection: ExtendedSyncSection = (report?.sync ?? {}) as ExtendedSyncSection;
  const missingKeys: number = Array.isArray(syncSection?.missingKeys) ? syncSection.missingKeys.length : 0;
  const unusedKeys: number = Array.isArray(syncSection?.unusedKeys) ? syncSection.unusedKeys.length : 0;
  const placeholderIssues: number = Array.isArray(syncSection?.placeholderIssues)
    ? syncSection.placeholderIssues.length
    : 0;
  const emptyValueViolations: number = Array.isArray(syncSection?.emptyValueViolations)
    ? syncSection.emptyValueViolations.length
    : 0;
  const dynamicWarnings: number = Array.isArray(syncSection?.dynamicKeyWarnings)
    ? syncSection.dynamicKeyWarnings.length
    : 0;
  const suspiciousKeys: number = Array.isArray(syncSection?.suspiciousKeys)
    ? syncSection.suspiciousKeys.length
    : 0;

  const hardcodedCount = issueSummary.items.filter((item) => item.kind === 'hardcoded-text').length;

  let level: IssueSeverityLevel = suggestionSummary.total > 0 || issueSummary.issueCount > 0 ? 'info' : 'none';
  const reasons: string[] = [];

  const flag = (target: IssueSeverityLevel, reason: string) => {
    const previous = level;
    const updated = escalateLevel(level, target);
    if (severityRank[target] >= severityRank[previous]) {
      reasons.push(reason);
    }
    level = updated;
  };

  const hasRuntimeGap = suggestionSummary.items.some((item) =>
    /Install or scaffold runtime/i.test(item.label)
  );

  const hasProviderGap = suggestionSummary.items.some((item) =>
    /Generate provider shell/i.test(item.label)
  );

  if (hasRuntimeGap) {
    flag('error', 'No runtime detected');
  }

  if (placeholderIssues > 0) {
    flag('error', `${placeholderIssues} placeholder mismatch${placeholderIssues === 1 ? '' : 'es'}`);
  }

  if (missingKeys >= 50) {
    flag('error', `${missingKeys} missing translation keys`);
  }

  if (emptyValueViolations >= 100) {
    flag('error', `${emptyValueViolations} empty translation values`);
  }

  if (hardcodedCount >= 200) {
    flag('error', `${hardcodedCount} hardcoded strings detected`);
  }

  const belowError = () => severityRank[level] < severityRank.error;

  if (belowError()) {
    if (missingKeys > 0) {
      flag('warn', `${missingKeys} missing translation key${missingKeys === 1 ? '' : 's'}`);
    }

    if (unusedKeys >= 25) {
      flag('warn', `${unusedKeys} unused key${unusedKeys === 1 ? '' : 's'}`);
    }

    if (hardcodedCount >= 25) {
      flag('warn', `${hardcodedCount} hardcoded string${hardcodedCount === 1 ? '' : 's'}`);
    }

    if (dynamicWarnings > 0) {
      flag('warn', `${dynamicWarnings} dynamic key${dynamicWarnings === 1 ? '' : 's'} to whitelist`);
    }

    if (hasProviderGap) {
      flag('warn', 'Provider shell missing');
    }

    if (suspiciousKeys > 0) {
      flag('warn', `${suspiciousKeys} suspicious key${suspiciousKeys === 1 ? '' : 's'}`);
    }
  }

  if (level === 'info' && reasons.length === 0) {
    if (suggestionSummary.total > 0) {
      reasons.push(`${suggestionSummary.total} quick action${suggestionSummary.total === 1 ? '' : 's'} available`);
    } else if (issueSummary.issueCount > 0) {
      reasons.push(`${issueSummary.issueCount} diagnostic${issueSummary.issueCount === 1 ? '' : 's'}`);
    }
  }

  if (level === 'none' && reasons.length === 0) {
    reasons.push('Workspace healthy');
  }

  return {
    level,
    reasons,
    warningCount: suggestionSummary.total,
    hardcodedCount,
    missingKeys,
  };
}

export function getSeverityLabel(level: IssueSeverityLevel): string {
  switch (level) {
    case 'error':
      return 'critical';
    case 'warn':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'none';
  }
}
