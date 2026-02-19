# Cache System Redesign Plan

## Executive Summary

The current cache system has accumulated technical debt that causes testing difficulties and production bugs. This document analyzes the issues and proposes a refactored solution that improves reliability without major feature additions.

## Current State Analysis

### Cache Architecture

**Two Cache Files:**
1. **Extractor Cache** (`node_modules/.cache/i18nsmith/references.json`) - ReferenceExtractor per-file parsing cache
2. **Sync Cache** (`.i18nsmith/cache/sync-references.json`) - Syncer per-file reference cache

**Cache Structure:**
```typescript
interface ReferenceCacheFile {
  version: number;                      // Manual bump (CACHE_VERSION = 5)
  translationIdentifier: string;        // e.g., 't'
  configHash?: string;                  // SHA-256 of config
  toolVersion?: string;                 // package version
  parserSignature?: string;             // SHA-256 of parser methods (NEW)
  parserAvailability?: Record<string, boolean>; // vue-eslint-parser present?
  files: Record<string, ReferenceCacheEntry>;   // per-file cache entries
}

interface ReferenceCacheEntry {
  fingerprint: FileFingerprint;         // { mtimeMs, size }
  references: TranslationReference[];
  dynamicKeyWarnings: DynamicKeyWarning[];
}
```

**Validation Layers (in order):**
1. `version` - Manual CACHE_VERSION constant
2. `translationIdentifier` - Must match current config
3. `configHash` - Config changes invalidate
4. `toolVersion` - Package version changes invalidate
5. `parserSignature` - Parser implementation changes invalidate
6. `parserAvailability` - Parser install/uninstall invalidates
7. Per-file `fingerprint` (mtimeMs + size) - File changes invalidate individual entries

### Problems Identified

#### 1. **Manual Version Bump Burden**
**Symptom:** Developer fixes parser bug, cache serves stale results until manual CACHE_VERSION bump remembered.

**Root Cause:** `CACHE_VERSION` is a hidden constant that developers must remember to increment.

**Impact:** 
- Bugs persist in testing even after code fixes
- Wasted debugging time chasing "phantom" bugs
- No clear signal when bump is needed

**Example from recent history:**
```typescript
// Bumped from 4 → 5 to invalidate stale caches that missed `:bound-attr="$t(...)"` 
// references because walkVueAST did not traverse VElement.startTag.attributes.
const CACHE_VERSION = 5;
```

#### 2. **Duplicate Cache Logic**
**Symptom:** Same validation logic exists in two places with subtle differences.

**Locations:**
- `reference-extractor.ts` - loadCache() method
- `syncer/reference-cache.ts` - loadReferenceCache() function

**Issues:**
- Different optional field handling
- Different validation order
- Maintenance burden (must update both)
- Risk of divergence bugs

#### 3. **Weak Cache Invalidation Signals**
**Symptom:** Cache returns `undefined` silently - caller doesn't know WHY it was invalidated.

**Impact:**
- Debugging is difficult (was it version? config? file change?)
- No telemetry for cache effectiveness
- Can't provide user feedback on cache misses

#### 4. **Parser Signature Performance Cost**
**Symptom:** `getParsersSignature()` uses runtime introspection + string hashing on every cache load.

**Cost:**
```typescript
// Runs on EVERY cache load:
- Access VueParser.prototype (runtime reflection)
- Extract 3 method implementations as strings
- Access TypeScriptParser.prototype
- Extract 2 method implementations as strings  
- Concatenate strings
- SHA-256 hash
```

**Impact:**
- Unnecessary CPU cycles in production
- Could be pre-computed at build time

#### 5. **Testing Pain Points**
**Symptom:** Tests must use `invalidateCache: true` everywhere to avoid cross-test pollution.

**Evidence from codebase:**
```typescript
// Found in 15+ test files:
await extractor.extract({ invalidateCache: true });
await syncer.run({ invalidateCache: true });
```

**Root Cause:** 
- Cache persists in temp directories across test runs
- Test isolation requires explicit cache clearing
- Easy to forget and get flaky tests

#### 6. **Missing Cache Observability**
**Symptom:** No way to know cache hit/miss rates or reasons for invalidation.

**Impact:**
- Can't measure cache effectiveness
- Can't debug performance issues
- No production telemetry

#### 7. **Inconsistent Cache Paths**
**Extractor:** `node_modules/.cache/i18nsmith/references.json`
**Syncer:** `.i18nsmith/cache/sync-references.json`

**Issues:**
- node_modules typically gitignored (good)
- .i18nsmith may or may not be gitignored (inconsistent)
- Different cleanup semantics

## Redesign Proposal

### Goals

1. **Eliminate manual CACHE_VERSION bumps** - Make cache self-invalidating
2. **Unify cache logic** - Single source of truth for validation
3. **Add observability** - Track why/when cache invalidates
4. **Improve test ergonomics** - Auto-clean caches in test mode
5. **Minimal breaking changes** - Refactor, don't rebuild

### Solution Architecture

#### Phase 1: Unified Cache Validation Service ⭐ **PRIORITY**

**Create:** `packages/core/src/cache/cache-validator.ts`

```typescript
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

export class CacheValidator {
  constructor(private context: CacheValidationContext) {}

  validate(cacheData: unknown): CacheValidationResult {
    const reasons: CacheInvalidationReason[] = [];
    
    // Version check
    if (cacheData.version !== this.context.currentVersion) {
      reasons.push({
        type: 'version',
        message: 'Cache version mismatch',
        oldValue: String(cacheData.version),
        newValue: String(this.context.currentVersion)
      });
    }
    
    // Translation identifier check
    if (cacheData.translationIdentifier !== this.context.expectedTranslationIdentifier) {
      reasons.push({
        type: 'translationIdentifier',
        message: 'Translation identifier changed',
        oldValue: cacheData.translationIdentifier,
        newValue: this.context.expectedTranslationIdentifier
      });
    }
    
    // Config hash check
    if (cacheData.configHash && cacheData.configHash !== this.context.currentConfigHash) {
      reasons.push({
        type: 'config',
        message: 'Configuration changed',
        oldValue: cacheData.configHash,
        newValue: this.context.currentConfigHash
      });
    }
    
    // Tool version check
    if (cacheData.toolVersion && cacheData.toolVersion !== this.context.currentToolVersion) {
      reasons.push({
        type: 'toolVersion',
        message: 'Tool version changed',
        oldValue: cacheData.toolVersion,
        newValue: this.context.currentToolVersion
      });
    }
    
    // Parser signature check
    if (cacheData.parserSignature && 
        this.context.currentParserSignature &&
        cacheData.parserSignature !== this.context.currentParserSignature) {
      reasons.push({
        type: 'parserSignature',
        message: 'Parser implementation changed',
        oldValue: cacheData.parserSignature,
        newValue: this.context.currentParserSignature
      });
    }
    
    // Parser availability check
    if (this.context.currentParserAvailability && cacheData.parserAvailability) {
      const changed = Object.keys(this.context.currentParserAvailability).some(
        key => this.context.currentParserAvailability[key] !== cacheData.parserAvailability?.[key]
      );
      if (changed) {
        reasons.push({
          type: 'parserAvailability',
          message: 'Parser availability changed (installed/uninstalled)'
        });
      }
    }
    
    return {
      valid: reasons.length === 0,
      reasons
    };
  }
}
```

**Benefits:**
- ✅ Single source of truth for validation logic
- ✅ Structured invalidation reasons for logging/debugging
- ✅ Easy to test in isolation
- ✅ Consistent behavior across both caches

#### Phase 2: Remove Manual CACHE_VERSION

**Strategy:** Make `version` field computed from critical inputs

```typescript
// cache-utils.ts
export function computeCacheVersion(
  parserSignature: string,
  schemaVersion: number = 1  // Only bump for breaking schema changes
): number {
  // Use first 8 chars of parser signature + schema version
  const signaturePrefix = parseInt(parserSignature.substring(0, 8), 16);
  return schemaVersion * 1000000 + (signaturePrefix % 1000000);
}
```

**Migration:**
```typescript
// OLD:
const CACHE_VERSION = 5;  // Manual bump needed

// NEW:
const SCHEMA_VERSION = 1;  // Only bump for breaking schema changes
const version = computeCacheVersion(parserSignature, SCHEMA_VERSION);
```

**Benefits:**
- ✅ Automatic invalidation when parser code changes
- ✅ Explicit signal when schema changes (SCHEMA_VERSION)
- ✅ No hidden cache bugs during development

**Trade-off:** Cache invalidates more often (acceptable for correctness)

#### Phase 3: Build-Time Parser Signature

**Problem:** Runtime `getParsersSignature()` adds overhead

**Solution:** Compute signature at build time

```typescript
// prebuild.mjs (new build script)
import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';

function computeParserSignature() {
  const vuePath = './src/parsers/vue-parser.ts';
  const tsPath = './src/parsers/typescript-parser.ts';
  
  const vueSource = readFileSync(vuePath, 'utf8');
  const tsSource = readFileSync(tsPath, 'utf8');
  
  const combined = vueSource + '\n' + tsSource;
  return createHash('sha256').update(combined).digest('hex');
}

const signature = computeParserSignature();
const code = `// Auto-generated by prebuild.mjs - DO NOT EDIT\nexport const PARSER_SIGNATURE = '${signature}';\n`;

writeFileSync('./src/parser-signature.ts', code);
console.log('✓ Generated parser signature:', signature);
```

**package.json:**
```json
{
  "scripts": {
    "prebuild": "node prebuild.mjs",
    "build": "npm run prebuild && tsc"
  }
}
```

**Usage:**
```typescript
// cache-utils.ts
import { PARSER_SIGNATURE } from './parser-signature.js';

export function getParsersSignature(): string {
  return PARSER_SIGNATURE;  // No runtime introspection!
}
```

**Benefits:**
- ✅ Zero runtime overhead
- ✅ More reliable (no reflection edge cases)
- ✅ Signature tracks actual source changes

#### Phase 4: Cache Telemetry & Observability

**Add:** `packages/core/src/cache/cache-stats.ts`

```typescript
export interface CacheStats {
  hits: number;
  misses: number;
  invalidations: { [reason: string]: number };
  lastInvalidationReason?: CacheInvalidationReason;
}

export class CacheStatsCollector {
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    invalidations: {}
  };

  recordHit(): void {
    this.stats.hits++;
  }

  recordMiss(): void {
    this.stats.misses++;
  }

  recordInvalidation(reasons: CacheInvalidationReason[]): void {
    for (const reason of reasons) {
      this.stats.invalidations[reason.type] = 
        (this.stats.invalidations[reason.type] || 0) + 1;
    }
    this.stats.lastInvalidationReason = reasons[0];
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? this.stats.hits / total : 0;
  }
}
```

**Integration:**
```typescript
// ReferenceExtractor
private cacheStats = new CacheStatsCollector();

private async loadCache(invalidate?: boolean): Promise<ReferenceCacheFile | undefined> {
  if (invalidate) {
    this.cacheStats.recordMiss();
    await this.clearCache();
    return undefined;
  }

  try {
    const raw = await fs.readFile(this.referenceCachePath, 'utf8');
    const parsed = JSON.parse(raw);
    
    const validation = this.validator.validate(parsed);
    if (!validation.valid) {
      this.cacheStats.recordInvalidation(validation.reasons);
      this.cacheStats.recordMiss();
      return undefined;
    }
    
    this.cacheStats.recordHit();
    return parsed;
  } catch {
    this.cacheStats.recordMiss();
    return undefined;
  }
}

// Expose stats for debugging
public getCacheStats(): CacheStats {
  return this.cacheStats.getStats();
}
```

**Benefits:**
- ✅ Debug cache effectiveness
- ✅ Telemetry for production monitoring
- ✅ Identify frequent invalidation reasons

#### Phase 5: Test-Friendly Cache Management

**Problem:** Tests need `invalidateCache: true` everywhere

**Solution:** Auto-detect test environment and use isolated cache paths

```typescript
// cache-utils.ts
export function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    typeof (globalThis as any).it === 'function'
  );
}

export function getCachePath(
  workspaceRoot: string, 
  cacheType: 'extractor' | 'sync'
): string {
  if (isTestEnvironment()) {
    // Use process-isolated temp cache in tests
    const testId = process.pid;
    return path.join(
      os.tmpdir(), 
      'i18nsmith-test-cache', 
      String(testId),
      cacheType,
      'references.json'
    );
  }
  
  // Production paths
  if (cacheType === 'extractor') {
    return path.join(workspaceRoot, 'node_modules', '.cache', 'i18nsmith', 'references.json');
  }
  return path.join(workspaceRoot, '.i18nsmith', 'cache', 'sync-references.json');
}
```

**Test cleanup hook:**
```typescript
// packages/core/src/test-setup.ts
import { afterAll } from 'vitest';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

afterAll(async () => {
  // Clean up test caches
  const testCacheDir = join(tmpdir(), 'i18nsmith-test-cache', String(process.pid));
  await rm(testCacheDir, { recursive: true, force: true });
});
```

**Benefits:**
- ✅ Tests no longer need `invalidateCache: true`
- ✅ Perfect test isolation by default
- ✅ Automatic cleanup
- ✅ Production cache paths unchanged

#### Phase 6: Cache Consistency Validation

**Problem:** File fingerprint (mtime + size) can give false hits if file restored

**Enhancement:** Add content hash for critical files

```typescript
export interface FileFingerprint {
  mtimeMs: number;
  size: number;
  contentHash?: string;  // SHA-256 of first 1KB (optional, for locale files)
}

export async function computeFileFingerprint(
  filePath: string,
  includeContentHash: boolean = false
): Promise<FileFingerprint> {
  const stats = await fs.stat(filePath);
  const fingerprint: FileFingerprint = {
    mtimeMs: stats.mtimeMs,
    size: stats.size
  };
  
  if (includeContentHash) {
    // Hash first 1KB for fast validation
    const handle = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(Math.min(1024, stats.size));
    await handle.read(buffer, 0, buffer.length, 0);
    await handle.close();
    
    fingerprint.contentHash = crypto
      .createHash('sha256')
      .update(buffer)
      .digest('hex')
      .substring(0, 16);  // First 16 chars sufficient
  }
  
  return fingerprint;
}
```

**Benefits:**
- ✅ Catches file restoration scenarios
- ✅ Optional (only for locale files if needed)
- ✅ Minimal performance impact (1KB hash)

### Implementation Phases

#### Phase 1: Foundation (1-2 hours)
- [ ] Create `cache/cache-validator.ts` with unified validation
- [ ] Create `cache/cache-stats.ts` for telemetry
- [ ] Add tests for both modules

#### Phase 2: Migration (2-3 hours)
- [ ] Refactor `reference-extractor.ts` to use CacheValidator
- [ ] Refactor `syncer/reference-cache.ts` to use CacheValidator  
- [ ] Update all tests to verify behavior unchanged
- [ ] Add cache stats collection

#### Phase 3: Auto-Versioning (1-2 hours)
- [ ] Implement `computeCacheVersion()` in cache-utils
- [ ] Replace `CACHE_VERSION = 5` with computed version
- [ ] Update tests for new versioning scheme
- [ ] Document SCHEMA_VERSION usage

#### Phase 4: Build-Time Signature (1 hour)
- [ ] Create `prebuild.mjs` script
- [ ] Generate `parser-signature.ts` at build time
- [ ] Update package.json scripts
- [ ] Remove runtime `getParsersSignature()` introspection

#### Phase 5: Test Ergonomics (1 hour)
- [ ] Implement test-aware cache paths
- [ ] Add test cleanup hooks
- [ ] Remove `invalidateCache: true` from tests (separate PR)

#### Phase 6: Documentation (1 hour)
- [ ] Update ARCHITECTURE.md with cache design
- [ ] Add troubleshooting guide for cache issues
- [ ] Document SCHEMA_VERSION bump policy

**Total Estimated Time:** 7-10 hours

### Migration Strategy

**Backwards Compatibility:**
- Phase 1-2: Refactor without breaking changes
- Phase 3: Old caches auto-invalidate (version mismatch) - acceptable
- Phase 4-6: Pure improvements, no breaking changes

**Rollout:**
1. Deploy Phase 1-2 first (validation refactor)
2. Collect telemetry for 1 week
3. Deploy Phase 3 (auto-versioning) after confidence gained
4. Deploy Phase 4-6 as quality-of-life improvements

### Success Metrics

**Before (Current State):**
- Manual CACHE_VERSION bumps: ~4 needed in last 3 months
- Test cache pollution bugs: ~15 `invalidateCache: true` scattered
- Cache invalidation debugging: No visibility
- Runtime parser signature overhead: ~5ms per cache load

**After (Target State):**
- Manual version bumps: 0 (only SCHEMA_VERSION for breaking changes)
- Test cache pollution: 0 (automatic isolation)
- Cache debugging: Full invalidation reason tracking
- Runtime overhead: 0ms (build-time signature)

### Risks & Mitigations

**Risk 1:** Auto-versioning invalidates cache too often
- **Mitigation:** Track cache hit rate via telemetry, adjust if < 70%
- **Acceptable:** Correctness > performance for development tool

**Risk 2:** Build-time signature misses runtime edge cases  
- **Mitigation:** Keep runtime fallback for non-bundled scenarios
- **Detection:** Add runtime assertion to compare build vs runtime signature

**Risk 3:** Test environment detection false positives
- **Mitigation:** Make test cache paths opt-in via env var
- **Fallback:** Production paths still work if detection fails

## Conclusion

This refactor addresses the root causes of cache-related bugs while maintaining backwards compatibility. The work is broken into small, testable phases that can be validated independently. The end result is a cache system that "just works" without manual intervention.

**Recommended Action:** Proceed with implementation in phases, starting with Phase 1 (unified validation) to establish foundation.
