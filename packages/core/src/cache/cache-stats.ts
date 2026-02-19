/**
 * Cache statistics and telemetry
 * 
 * Tracks cache hits, misses, and invalidation reasons for debugging
 * and performance monitoring.
 */

import type { CacheInvalidationReason } from './cache-validator.js';

export interface CacheStats {
  hits: number;
  misses: number;
  invalidations: { [reason: string]: number };
  lastInvalidationReasons?: CacheInvalidationReason[];
}

/**
 * Collects statistics about cache usage for debugging and telemetry
 */
export class CacheStatsCollector {
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    invalidations: {},
  };

  /**
   * Record a cache hit (data loaded successfully from cache)
   */
  recordHit(): void {
    this.stats.hits++;
  }

  /**
   * Record a cache miss (data not found or not usable)
   */
  recordMiss(): void {
    this.stats.misses++;
  }

  /**
   * Record cache invalidation with reasons
   */
  recordInvalidation(reasons: CacheInvalidationReason[]): void {
    for (const reason of reasons) {
      this.stats.invalidations[reason.type] = 
        (this.stats.invalidations[reason.type] || 0) + 1;
    }
    this.stats.lastInvalidationReasons = reasons;
  }

  /**
   * Get current statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Calculate cache hit rate (0-1)
   */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }

  /**
   * Reset all statistics
   */
  reset(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      invalidations: {},
    };
  }

  /**
   * Format statistics as human-readable string
   */
  format(): string {
    const total = this.stats.hits + this.stats.misses;
    if (total === 0) {
      return 'No cache operations recorded';
    }

    const hitRate = (this.getHitRate() * 100).toFixed(1);
    const lines = [
      `Cache Statistics:`,
      `  Hits: ${this.stats.hits}`,
      `  Misses: ${this.stats.misses}`,
      `  Hit Rate: ${hitRate}%`,
    ];

    const invalidationTypes = Object.keys(this.stats.invalidations);
    if (invalidationTypes.length > 0) {
      lines.push(`  Invalidations:`);
      for (const type of invalidationTypes) {
        lines.push(`    ${type}: ${this.stats.invalidations[type]}`);
      }
    }

    return lines.join('\n');
  }
}
