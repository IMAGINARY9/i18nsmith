import { describe, it, expect } from 'vitest';
import { computeCacheVersion, getParsersSignature } from './cache-utils.js';

describe('computeCacheVersion', () => {
  it('generates consistent version for same signature', () => {
    const sig = 'abc123def456';
    const v1 = computeCacheVersion(sig, 1);
    const v2 = computeCacheVersion(sig, 1);
    
    expect(v1).toBe(v2);
  });

  it('generates different versions for different signatures', () => {
    const sig1 = 'abc123def456';
    const sig2 = 'xyz789uvw012';
    
    const v1 = computeCacheVersion(sig1, 1);
    const v2 = computeCacheVersion(sig2, 1);
    
    expect(v1).not.toBe(v2);
  });

  it('includes schema version in millions place', () => {
    const sig = 'abc123def456';
    
    const v1 = computeCacheVersion(sig, 1);
    const v2 = computeCacheVersion(sig, 2);
    
    // Schema version 1 should start with 1...
    expect(Math.floor(v1 / 1000000)).toBe(1);
    
    // Schema version 2 should start with 2...
    expect(Math.floor(v2 / 1000000)).toBe(2);
  });

  it('handles full 64-char SHA-256 signatures', () => {
    const fullSig = 'a'.repeat(64);
    const version = computeCacheVersion(fullSig, 1);
    
    expect(version).toBeGreaterThan(1000000);
    expect(version).toBeLessThan(2000000);
  });

  it('produces numeric versions', () => {
    const sig = getParsersSignature();
    const version = computeCacheVersion(sig, 1);
    
    expect(typeof version).toBe('number');
    expect(Number.isInteger(version)).toBe(true);
    expect(version).toBeGreaterThan(0);
  });

  it('uses default schema version of 1', () => {
    const sig = 'abc123';
    const v1 = computeCacheVersion(sig);
    const v2 = computeCacheVersion(sig, 1);
    
    expect(v1).toBe(v2);
  });

  it('automatically invalidates when parser signature changes', () => {
    // Simulate parser implementation change
    const oldSig = 'abc123def456';
    const newSig = 'xyz789uvw012';
    
    const oldVersion = computeCacheVersion(oldSig, 1);
    const newVersion = computeCacheVersion(newSig, 1);
    
    // Different signatures = different versions = cache invalidated
    expect(oldVersion).not.toBe(newVersion);
  });

  it('preserves schema version across parser changes', () => {
    const sig1 = 'abc123';
    const sig2 = 'def456';
    
    const v1_schema1 = computeCacheVersion(sig1, 1);
    const v2_schema1 = computeCacheVersion(sig2, 1);
    
    // Both should have schema version 1 in millions place
    expect(Math.floor(v1_schema1 / 1000000)).toBe(1);
    expect(Math.floor(v2_schema1 / 1000000)).toBe(1);
  });
});

describe('auto-versioning integration', () => {
  it('real parser signature produces valid cache version', () => {
    const parserSig = getParsersSignature();
    const version = computeCacheVersion(parserSig, 1);
    
    expect(version).toBeGreaterThan(1000000);
    expect(version).toBeLessThan(2000000);
    expect(Number.isInteger(version)).toBe(true);
  });

  it('version changes when parser implementation changes', () => {
    // This test documents the auto-invalidation behavior
    // When parser code changes, getParsersSignature() returns different value
    // which causes computeCacheVersion() to return different version
    // which causes CacheValidator to invalidate the cache
    
    const sig = getParsersSignature();
    const version = computeCacheVersion(sig, 1);
    
    // Version is deterministic for given signature
    expect(computeCacheVersion(sig, 1)).toBe(version);
    
    // Different signature = different version
    const differentSig = sig.split('').reverse().join('');
    expect(computeCacheVersion(differentSig, 1)).not.toBe(version);
  });
});
