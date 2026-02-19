import { describe, it, expect } from 'vitest';
import { getParsersSignature } from './cache-utils.js';
import { BUILD_TIME_PARSER_SIGNATURE } from './parser-signature.js';

describe('Build-Time Parser Signature', () => {
  it('uses build-time signature when available', () => {
    const signature = getParsersSignature();
    
    // Should use the build-time signature (not runtime introspection)
    expect(signature).toBe(BUILD_TIME_PARSER_SIGNATURE);
    expect(signature).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it('build-time signature is stable', () => {
    // Multiple calls should return the same signature (from cache)
    const sig1 = getParsersSignature();
    const sig2 = getParsersSignature();
    expect(sig1).toBe(sig2);
  });

  it('build-time signature matches expected format', () => {
    expect(BUILD_TIME_PARSER_SIGNATURE).toBeTruthy();
    expect(BUILD_TIME_PARSER_SIGNATURE).toMatch(/^[0-9a-f]{64}$/);
  });
});
