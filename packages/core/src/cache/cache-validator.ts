/**
 * Unified cache validation logic
 * 
 * Centralizes all cache invalidation checks and provides structured reasons
 * for cache invalidation, enabling better debugging and telemetry.
 */

export interface CacheInvalidationReason {
  type: 'version' | 'config' | 'toolVersion' | 'parserSignature' | 'parserAvailability' | 'translationIdentifier';
  message: string;
  oldValue?: string;
  newValue?: string;
}

export interface CacheValidationResult {
  valid: boolean;
  reasons: CacheInvalidationReason[];
}

export interface CacheValidationContext {
  currentVersion: number;
  expectedTranslationIdentifier: string;
  currentConfigHash: string;
  currentToolVersion: string;
  currentParserSignature: string;
  currentParserAvailability?: Record<string, boolean>;
}

/**
 * Validates cache data against current runtime context.
 * Returns structured invalidation reasons for debugging and telemetry.
 */
export class CacheValidator {
  constructor(private context: CacheValidationContext) {}

  /**
   * Validate cache data against current context.
   * Returns validation result with detailed reasons if invalid.
   */
  validate(cacheData: unknown): CacheValidationResult {
    // Type guard: cache data should be an object
    if (!cacheData || typeof cacheData !== 'object') {
      return {
        valid: false,
        reasons: [{
          type: 'version',
          message: 'Invalid cache data structure',
        }]
      };
    }
    
    const cache = cacheData as Record<string, unknown>;
    const reasons: CacheInvalidationReason[] = [];
    
    // Version check - must match exactly
    if (typeof cache.version !== 'number' || cache.version !== this.context.currentVersion) {
      reasons.push({
        type: 'version',
        message: 'Cache version mismatch',
        oldValue: String(cache.version ?? 'undefined'),
        newValue: String(this.context.currentVersion)
      });
    }
    
    // Translation identifier check - must match exactly
    if (cache.translationIdentifier !== this.context.expectedTranslationIdentifier) {
      reasons.push({
        type: 'translationIdentifier',
        message: 'Translation identifier changed',
        oldValue: String(cache.translationIdentifier ?? 'undefined'),
        newValue: this.context.expectedTranslationIdentifier
      });
    }
    
    // Config hash check - only if present in cache
    if (typeof cache.configHash === 'string' && cache.configHash !== this.context.currentConfigHash) {
      reasons.push({
        type: 'config',
        message: 'Configuration changed',
        oldValue: cache.configHash,
        newValue: this.context.currentConfigHash
      });
    }
    
    // Tool version check - only if present in cache
    if (typeof cache.toolVersion === 'string' && cache.toolVersion !== this.context.currentToolVersion) {
      reasons.push({
        type: 'toolVersion',
        message: 'Tool version changed',
        oldValue: cache.toolVersion,
        newValue: this.context.currentToolVersion
      });
    }
    
    // Parser signature check - only if both present
    if (typeof cache.parserSignature === 'string' && 
        this.context.currentParserSignature &&
        cache.parserSignature !== this.context.currentParserSignature) {
      reasons.push({
        type: 'parserSignature',
        message: 'Parser implementation changed',
        oldValue: cache.parserSignature,
        newValue: this.context.currentParserSignature
      });
    }
    
    // Parser availability check - only if both present
    if (this.context.currentParserAvailability && 
        cache.parserAvailability &&
        typeof cache.parserAvailability === 'object' &&
        cache.parserAvailability !== null) {
      const availabilityChanged = this.hasParserAvailabilityChanged(
        cache.parserAvailability as Record<string, boolean>,
        this.context.currentParserAvailability
      );
      if (availabilityChanged) {
        reasons.push({
          type: 'parserAvailability',
          message: 'Parser availability changed (installed/uninstalled)',
          oldValue: JSON.stringify(cache.parserAvailability),
          newValue: JSON.stringify(this.context.currentParserAvailability)
        });
      }
    }
    
    return {
      valid: reasons.length === 0,
      reasons
    };
  }

  /**
   * Check if parser availability has changed between cache and current state
   */
  private hasParserAvailabilityChanged(
    cached: Record<string, boolean>,
    current: Record<string, boolean>
  ): boolean {
    // Check all parsers in current state
    for (const parserId of Object.keys(current)) {
      if (current[parserId] !== cached[parserId]) {
        return true;
      }
    }
    
    // Check all parsers in cached state (in case some were removed)
    for (const parserId of Object.keys(cached)) {
      if (!(parserId in current)) {
        // Parser existed in cache but not in current state
        return true;
      }
    }
    
    return false;
  }

  /**
   * Format invalidation reasons as human-readable string
   */
  static formatReasons(reasons: CacheInvalidationReason[]): string {
    if (reasons.length === 0) {
      return 'Valid cache';
    }
    
    return reasons
      .map(r => {
        if (r.oldValue && r.newValue) {
          return `${r.message}: ${r.oldValue} → ${r.newValue}`;
        }
        return r.message;
      })
      .join('; ');
  }
}
