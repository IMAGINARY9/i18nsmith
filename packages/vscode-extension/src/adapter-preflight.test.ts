import { describe, it, expect, vi } from 'vitest';
import { AdapterRegistry } from '@i18nsmith/core';
import { runAdapterPreflightCheck } from './utils/adapter-preflight';

describe('Adapter preflight utility', () => {
  it('returns missing deps when registry reports unavailable packages', () => {
    const fake = new Map();
    fake.set('vue', [{ name: 'vue-eslint-parser', installHint: 'npm i -D vue-eslint-parser', available: false }]);
    const spy = vi.spyOn(AdapterRegistry.prototype, 'preflightCheck').mockReturnValue(fake as any);

    const missing = runAdapterPreflightCheck();
    expect(missing).toHaveLength(1);
    expect(missing[0].adapter).toBe('vue');
    expect(missing[0].dependency).toBe('vue-eslint-parser');

    spy.mockRestore();
  });
});
