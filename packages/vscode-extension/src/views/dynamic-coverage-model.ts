import type { CheckReport } from '../diagnostics';

export interface DynamicCoverageEntry {
  pattern: string;
  expandedKeys: string[];
  missingByLocale: Record<string, string[]>;
}

export function buildDynamicCoverageEntries(report: CheckReport | null): DynamicCoverageEntry[] {
  if (!report?.sync || !Array.isArray(report.sync.dynamicKeyCoverage)) {
    return [];
  }

  return report.sync.dynamicKeyCoverage
    .map((entry) => {
      const coverage = entry as Partial<DynamicCoverageEntry>;
      return {
        pattern: coverage.pattern ?? 'unknown',
        expandedKeys: coverage.expandedKeys ?? [],
        missingByLocale: coverage.missingByLocale ?? {},
      };
    })
    .filter((entry) => entry.pattern !== 'unknown');
}
