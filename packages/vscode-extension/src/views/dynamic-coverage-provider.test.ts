import { describe, it, expect } from 'vitest';
import { buildDynamicCoverageEntries } from './dynamic-coverage-model';

describe('DynamicCoverageProvider helpers', () => {
  it('normalizes dynamic key coverage entries from report', () => {
    const report: any = {
      sync: {
        dynamicKeyCoverage: [
          {
            pattern: 'workingHours.*',
            expandedKeys: ['workingHours.monday'],
            missingByLocale: { en: ['workingHours.monday'] },
          },
        ],
      },
    };

    const entries = buildDynamicCoverageEntries(report);
    expect(entries).toHaveLength(1);
    expect(entries[0].pattern).toBe('workingHours.*');
    expect(entries[0].missingByLocale.en).toEqual(['workingHours.monday']);
  });

  it('returns empty list when report has no coverage', () => {
    const entries = buildDynamicCoverageEntries(null);
    expect(entries).toEqual([]);
  });
});
