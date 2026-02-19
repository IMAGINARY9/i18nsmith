import { describe, it, expect } from 'vitest';
import { CacheStatsCollector } from './cache-stats.js';
import type { CacheInvalidationReason } from './cache-validator.js';

describe('CacheStatsCollector', () => {
  it('starts with zero stats', () => {
    const collector = new CacheStatsCollector();
    const stats = collector.getStats();
    
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(Object.keys(stats.invalidations)).toHaveLength(0);
    expect(collector.getHitRate()).toBe(0);
  });

  it('records hits', () => {
    const collector = new CacheStatsCollector();
    
    collector.recordHit();
    collector.recordHit();
    collector.recordHit();
    
    const stats = collector.getStats();
    expect(stats.hits).toBe(3);
    expect(stats.misses).toBe(0);
  });

  it('records misses', () => {
    const collector = new CacheStatsCollector();
    
    collector.recordMiss();
    collector.recordMiss();
    
    const stats = collector.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(2);
  });

  it('records invalidations', () => {
    const collector = new CacheStatsCollector();
    
    const reasons: CacheInvalidationReason[] = [
      {
        type: 'version',
        message: 'Version changed',
      },
      {
        type: 'config',
        message: 'Config changed',
      },
    ];
    
    collector.recordInvalidation(reasons);
    
    const stats = collector.getStats();
    expect(stats.invalidations['version']).toBe(1);
    expect(stats.invalidations['config']).toBe(1);
    expect(stats.lastInvalidationReasons).toEqual(reasons);
  });

  it('accumulates invalidation counts', () => {
    const collector = new CacheStatsCollector();
    
    collector.recordInvalidation([{ type: 'version', message: 'v1' }]);
    collector.recordInvalidation([{ type: 'version', message: 'v2' }]);
    collector.recordInvalidation([{ type: 'config', message: 'c1' }]);
    
    const stats = collector.getStats();
    expect(stats.invalidations['version']).toBe(2);
    expect(stats.invalidations['config']).toBe(1);
  });

  it('calculates hit rate', () => {
    const collector = new CacheStatsCollector();
    
    collector.recordHit();
    collector.recordHit();
    collector.recordHit();
    collector.recordMiss();
    
    expect(collector.getHitRate()).toBe(0.75); // 3/4 = 0.75
  });

  it('returns 0 hit rate when no operations', () => {
    const collector = new CacheStatsCollector();
    expect(collector.getHitRate()).toBe(0);
  });

  it('resets statistics', () => {
    const collector = new CacheStatsCollector();
    
    collector.recordHit();
    collector.recordMiss();
    collector.recordInvalidation([{ type: 'version', message: 'v1' }]);
    
    collector.reset();
    
    const stats = collector.getStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(Object.keys(stats.invalidations)).toHaveLength(0);
    expect(stats.lastInvalidationReasons).toBeUndefined();
  });

  it('formats statistics', () => {
    const collector = new CacheStatsCollector();
    
    collector.recordHit();
    collector.recordHit();
    collector.recordHit();
    collector.recordMiss();
    collector.recordInvalidation([
      { type: 'version', message: 'v1' },
      { type: 'config', message: 'c1' },
    ]);
    
    const formatted = collector.format();
    
    expect(formatted).toContain('Cache Statistics:');
    expect(formatted).toContain('Hits: 3');
    expect(formatted).toContain('Misses: 1');
    expect(formatted).toContain('Hit Rate: 75.0%');
    expect(formatted).toContain('Invalidations:');
    expect(formatted).toContain('version: 1');
    expect(formatted).toContain('config: 1');
  });

  it('formats when no operations', () => {
    const collector = new CacheStatsCollector();
    const formatted = collector.format();
    
    expect(formatted).toBe('No cache operations recorded');
  });

  it('formats without invalidations', () => {
    const collector = new CacheStatsCollector();
    
    collector.recordHit();
    collector.recordMiss();
    
    const formatted = collector.format();
    
    expect(formatted).toContain('Hits: 1');
    expect(formatted).toContain('Misses: 1');
    expect(formatted).not.toContain('Invalidations:');
  });

  it('returns copy of stats to prevent mutation', () => {
    const collector = new CacheStatsCollector();
    collector.recordHit();
    
    const stats1 = collector.getStats();
    stats1.hits = 999;
    
    const stats2 = collector.getStats();
    expect(stats2.hits).toBe(1); // Original unchanged
  });
});
