import fs from 'fs/promises';
import type { TranslationReference, DynamicKeyWarning } from '../reference-extractor.js';
import { getToolVersion } from '../cache-utils.js';

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
  /** Parser availability status when the cache was written.
   *  If parser availability changes, the cache is invalidated. */
  parserAvailability?: Record<string, boolean>;
  files: Record<string, ReferenceCacheEntry>;
}

// Bumped from 2 → 3 to invalidate stale caches that stored empty Vue references
// because vue-eslint-parser wasn't resolved from the project's node_modules.
const CACHE_VERSION = 4;
export const REFERENCE_CACHE_VERSION = CACHE_VERSION;

export async function loadReferenceCache(
  filePath: string,
  translationIdentifier: string,
  options?: boolean | { invalidate?: boolean; parserAvailability?: Record<string, boolean>; configHash?: string; toolVersion?: string }
): Promise<ReferenceCacheFile | undefined> {
  const shouldInvalidate = typeof options === 'boolean' ? options : options?.invalidate;
  const currentParserAvailability = typeof options === 'object' ? options?.parserAvailability : undefined;
  const currentConfigHash = typeof options === 'object' ? options?.configHash : undefined;
  const currentToolVersion = typeof options === 'object' ? options?.toolVersion : undefined;
  
  if (shouldInvalidate) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION || data.translationIdentifier !== translationIdentifier) {
      return undefined;
    }
    if (currentConfigHash && data.configHash !== currentConfigHash) {
      return undefined;
    }
    if (currentToolVersion && data.toolVersion !== currentToolVersion) {
      return undefined;
    }
    // Invalidate cache if parser availability changed (e.g. user installs a parser)
    if (currentParserAvailability && data.parserAvailability) {
      const hasChanged = Object.keys(currentParserAvailability).some(
        (parserId) => currentParserAvailability[parserId] !== data.parserAvailability?.[parserId]
      );
      if (hasChanged) {
        return undefined;
      }
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
  options?: { parserAvailability?: Record<string, boolean>; configHash?: string; toolVersion?: string }
): Promise<void> {
  const data: ReferenceCacheFile = {
    version: CACHE_VERSION,
    translationIdentifier,
    configHash: options?.configHash,
    toolVersion: options?.toolVersion ?? getToolVersion(),
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
