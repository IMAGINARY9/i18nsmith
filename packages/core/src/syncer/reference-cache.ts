import fs from 'fs/promises';
import path from 'path';
import type { TranslationReference, DynamicKeyWarning, ReferenceCacheFile } from '../reference-extractor.js';

/**
 * File fingerprint for cache validation
 */
export interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

/**
 * Cache entry for a single source file
 */
export interface ReferenceCacheEntry {
  fingerprint: FileFingerprint;
  references: TranslationReference[];
  dynamicKeyWarnings: DynamicKeyWarning[];
}

export const REFERENCE_CACHE_VERSION = 2;

// Optional extractor signature file name placed at workspace/.i18nsmith/extractor-version
const EXTRACTOR_VERSION_FILE = 'extractor-version';

function getWorkspaceDirFromCachePath(cachePath: string): string {
  // cachePath is typically: <workspace>/.i18nsmith/reference-cache.json
  // so workspace dir is one level above cache dir.
  const cacheDir = path.dirname(cachePath);
  return path.resolve(cacheDir, '..');
}

async function readWorkspaceExtractorVersion(workspaceDir: string): Promise<string | undefined> {
  try {
    const extractorPath = path.join(workspaceDir, EXTRACTOR_VERSION_FILE);
    const exists = await fs
      .stat(extractorPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return undefined;
    }
    const value = (await fs.readFile(extractorPath, 'utf8')).trim();
    return value.length ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Loads the reference cache from disk.
 * Returns undefined if cache is invalid, outdated, or doesn't exist.
 */
export async function loadReferenceCache(
  cachePath: string,
  translationIdentifier: string,
  invalidate?: boolean
): Promise<ReferenceCacheFile | undefined> {
  if (invalidate) {
    await clearReferenceCache(cachePath);
    return undefined;
  }

  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as ReferenceCacheFile;
    // If an extractor-version file exists in the workspace, require the cached
    // payload to include a matching extractorVersion field. This lets a repo
    // opt into explicit cache-busting when the extractor logic changes.
    const workspaceDir = getWorkspaceDirFromCachePath(cachePath);
    const extractorValue = await readWorkspaceExtractorVersion(workspaceDir);
    if (extractorValue) {
      const parsedExt = parsed as ReferenceCacheFile & { extractorVersion?: string };
      if (parsedExt.extractorVersion !== extractorValue) {
        return undefined;
      }
    }

    if (parsed.version !== REFERENCE_CACHE_VERSION) {
      return undefined;
    }
    if (parsed.translationIdentifier !== translationIdentifier) {
      return undefined;
    }
    if (!parsed.files || typeof parsed.files !== 'object') {
      return undefined;
    }
    
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Saves the reference cache to disk.
 */
export async function saveReferenceCache(
  cachePath: string,
  cacheDir: string,
  translationIdentifier: string,
  entries: Record<string, ReferenceCacheEntry>
): Promise<void> {
  const payload: ReferenceCacheFile & { extractorVersion?: string } = {
    version: REFERENCE_CACHE_VERSION,
    translationIdentifier,
    files: entries,
  };

  // If workspace contains a `.i18nsmith/extractor-version` file, include its value
  // in the cache payload so future loads can detect mismatches and invalidate.
  const workspaceDir = path.resolve(cacheDir, '..');
  const extractorValue = await readWorkspaceExtractorVersion(workspaceDir);
  if (extractorValue) {
    payload.extractorVersion = extractorValue;
  }

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(payload), 'utf8');
}

/**
 * Clears the reference cache file.
 */
export async function clearReferenceCache(cachePath: string): Promise<void> {
  await fs.rm(cachePath, { force: true }).catch(() => {});
}

/**
 * Computes a file fingerprint for cache validation.
 */
export async function computeFileFingerprint(filePath: string): Promise<FileFingerprint> {
  const stats = await fs.stat(filePath);
  return {
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  };
}

/**
 * Gets a cached entry if it exists and matches the fingerprint.
 */
export function getCachedEntry(
  cache: ReferenceCacheFile,
  relativePath: string,
  fingerprint: FileFingerprint
): ReferenceCacheEntry | undefined {
  const entry = cache.files[relativePath];
  if (!entry) {
    return undefined;
  }
  if (
    entry.fingerprint.mtimeMs !== fingerprint.mtimeMs ||
    entry.fingerprint.size !== fingerprint.size
  ) {
    return undefined;
  }
  return entry;
}
