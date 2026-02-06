import { AdapterRegistry } from '@i18nsmith/core';

export interface MissingDep { adapter: string; dependency: string; installHint: string }

export function runAdapterPreflightCheck(): MissingDep[] {
  const registry = new AdapterRegistry();
  const results = registry.preflightCheck();

  const missing: MissingDep[] = [];
  for (const [adapterId, checks] of results) {
    for (const check of checks) {
      if (!check.available) {
        missing.push({ adapter: adapterId, dependency: check.name, installHint: check.installHint });
      }
    }
  }
  return missing;
}
