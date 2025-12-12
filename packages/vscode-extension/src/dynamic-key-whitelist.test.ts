import { describe, it, expect } from 'vitest';
import type { DynamicKeyWarning } from '@i18nsmith/core';
import {
  deriveWhitelistSuggestions,
  mergeAssumptions,
  normalizeManualAssumption,
} from './dynamic-key-whitelist';

function createWarning(partial: Partial<DynamicKeyWarning>): DynamicKeyWarning {
  return {
    filePath: partial.filePath ?? '/workspace/src/example.tsx',
    expression: partial.expression ?? '`example.${slug}`',
    position: partial.position ?? { line: 10, column: 5 },
    reason: partial.reason ?? 'template',
  };
}

describe('dynamic key whitelist helpers', () => {
  it('derives unique glob suggestions from template warnings', () => {
    const warnings: DynamicKeyWarning[] = [
      createWarning({ expression: '`service.orderStatuses.${status}`' }),
      createWarning({ expression: '`service.orderStatuses.${status}`', position: { line: 20, column: 1 } }),
    ];

    const suggestions = deriveWhitelistSuggestions(warnings);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].assumption).toBe('service.orderStatuses.*');
    expect(suggestions[0].bucket).toBe('globs');
  });

  it('derives exact assumptions from binary warnings', () => {
    const warnings: DynamicKeyWarning[] = [
      createWarning({
        reason: 'binary',
        expression: 'errors.name.message || `validation.invalidInput`',
      }),
    ];

    const suggestions = deriveWhitelistSuggestions(warnings);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].assumption).toBe('errors.name.message');
    expect(suggestions[0].bucket).toBe('assumptions');
  });

  it('merges and sorts assumptions without duplicates', () => {
    const existing = ['errors.name.message'];
    const additions = ['errors.name.message', 'restaurant.roles.*'];
    const result = mergeAssumptions(existing, additions);

    expect(result.added).toEqual(['restaurant.roles.*']);
    expect(result.next).toEqual(['errors.name.message', 'restaurant.roles.*']);
  });

  it('normalizes manual entries by stripping wrappers and compressing dots', () => {
    expect(normalizeManualAssumption(' `common..status.*` ')).toBe('common.status.*');
    expect(normalizeManualAssumption(' (errors.role.${kind}) ')).toBe('errors.role.*');
  });
});
