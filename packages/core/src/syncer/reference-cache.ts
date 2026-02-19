import fs from 'fs/promises';
import type { TranslationReference, DynamicKeyWarning } from '../reference-extractor.js';
import { getToolVersion } from '../cache-utils.js';
import { CacheValidator, type CacheValidationContext, type CacheInvalidationReason } from '../cache/index.js';

export interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

export interface ReferenceCacheEntry {
  fingerprint: FileFingerprint;
  references: TranslationReference[];
  dynamicKeyWarnings: DynamicKeyWarning[];
}

export interface ReferenceCacheFile {
  version: number;
  translationIdentifier: string;
  configHash?: string;
  toolVersion?: string;
  /** Signature/hash of parser implementations used when cache was written. */
  parserSignature?: string;
  /** Parser availability status when the cache was written.
   *  If parser availability changes, the cache is invalidated. */
  parserAvailability?: Record<string, boolean>;
  files: Record<string, ReferenceCacheEntry>;
}

// Bumped from 2 → 3 to invalidate stale caches that stored empty Vue references
// because vue-eslint-parser wasn't resolved from the project's node_modules.
// Bumped from 4 → 5 to invalidate stale caches that missed `:bound-attr="$t(...)"` references
// because walkVueAST did not traverse VElement.startTag.attributes.
const CACHE_VERSION = 5;
export const REFERENCE_CACHE_VERSION = CACHE_VERSION;

export interface LoadReferenceCacheResult {
  cache?: ReferenceCacheFile;
  invalidationReasons?: CacheInvalidationReason[];
}

/**
 * Load reference cache with validation.
 * Returns cache data if valid, or undefined with invalidation reasons if invalid.
 */
export async function loadReferenceCache(
  filePath: string,
  translationIdentifier: string,
  options?: boolean | { invalidate?: boolean; parserAvailability?: Record<string, boolean>; configHash?: string; toolVersion?: string; parserSignature?: string }
): Promise<ReferenceCacheFile | undefined> {
  const shouldInvalidate = typeof options === 'boolean' ? options : options?.invalidate;
  const currentParserAvailability = typeof options === 'object' ? options?.parserAvailability : undefined;
  const currentConfigHash = typeof options === 'object' ? options?.configHash : undefined;
  const currentToolVersion = typeof options === 'object' ? options?.toolVersion : undefined;
  const currentParserSignature = typeof options === 'object' ? options?.parserSignature : undefined;
  
  if (shouldInvalidate) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    
    // Build validation context - only include fields that should be validated
    const validationContext: CacheValidationContext = {
      currentVersion: CACHE_VERSION,
      expectedTranslationIdentifier: translationIdentifier,
      // Only include these if explicitly provided for validation
      currentConfigHash: currentConfigHash ?? (data.configHash as string | undefined) ?? '',
      currentToolVersion: currentToolVersion ?? (data.toolVersion as string | undefined) ?? '',
      currentParserSignature: currentParserSignature ?? (data.parserSignature as string | undefined) ?? '',
      currentParserAvailability,
    };
    
    // Validate using unified validator
    const validator = new CacheValidator(validationContext);
    const validation = validator.validate(data);
    
    if (!validation.valid) {
      return undefined;
    }
    
    return data as ReferenceCacheFile;
  } catch {
    return undefined;
  }
}

export async function saveReferenceCache(
  filePath: string,
  cacheDir: string,
  translationIdentifier: string,
  entries: Record<string, ReferenceCacheEntry>,
  options?: { parserAvailability?: Record<string, boolean>; configHash?: string; toolVersion?: string; parserSignature?: string }
): Promise<void> {
  const data: ReferenceCacheFile = {
    version: CACHE_VERSION,
    translationIdentifier,
    configHash: options?.configHash,
    toolVersion: options?.toolVersion ?? getToolVersion(),
    parserSignature: options?.parserSignature,
    parserAvailability: options?.parserAvailability,
    files: entries,
  };
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function clearReferenceCache(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore if not exists
  }
}

export async function computeFileFingerprint(filePath: string): Promise<FileFingerprint> {
  const stats = await fs.stat(filePath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

export function getCachedEntry(
  cache: ReferenceCacheFile,
  relativePath: string,
  fingerprint: FileFingerprint
): ReferenceCacheEntry | undefined {
  const entry = cache.files[relativePath];
  if (!entry) return undefined;
  
  if (entry.fingerprint.mtimeMs !== fingerprint.mtimeMs || entry.fingerprint.size !== fingerprint.size) {
    return undefined;
  }
  return entry;
}
