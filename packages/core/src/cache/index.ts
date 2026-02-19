/**
 * Cache utilities module
 * 
 * Provides unified cache validation, statistics collection, and management
 * for reference caches in the i18nsmith system.
 */

export {
  CacheValidator,
  type CacheValidationContext,
  type CacheValidationResult,
  type CacheInvalidationReason,
} from './cache-validator.js';

export {
  CacheStatsCollector,
  type CacheStats,
} from './cache-stats.js';
