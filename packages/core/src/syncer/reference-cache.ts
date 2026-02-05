import fs from 'fs/promises';
import type { TranslationReference, DynamicKeyWarning } from '../reference-extractor.js';

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
  files: Record<string, ReferenceCacheEntry>;
}

const CACHE_VERSION = 2;
export const REFERENCE_CACHE_VERSION = CACHE_VERSION;

export async function loadReferenceCache(
  filePath: string,
  translationIdentifier: string,
  options?: boolean | { invalidate?: boolean }
): Promise<ReferenceCacheFile | undefined> {
  const shouldInvalidate = typeof options === 'boolean' ? options : options?.invalidate;
  
  if (shouldInvalidate) {
    return undefined;
  }

  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.version !== CACHE_VERSION || data.translationIdentifier !== translationIdentifier) {
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
  entries: Record<string, ReferenceCacheEntry>
): Promise<void> {
  const data: ReferenceCacheFile = {
    version: CACHE_VERSION,
    translationIdentifier,
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
