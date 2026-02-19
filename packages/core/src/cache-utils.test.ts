import { describe, it, expect } from 'vitest';
import { getParsersSignature } from './cache-utils.js';

describe('getParsersSignature', () => {
  it('returns a stable 64-char hex string', () => {
    const s1 = getParsersSignature();
    const s2 = getParsersSignature();
    expect(s1).toMatch(/^[0-9a-f]{64}$/);
    expect(s1).toBe(s2);
  });
});
