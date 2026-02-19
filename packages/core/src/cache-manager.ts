import fs from 'fs/promises';
import path from 'path';
import type { I18nConfig } from './config.js';
import { getToolVersion, hashConfig, getParsersSignature, getCachePath } from './cache-utils.js';
import type { ReferenceCacheFile as ExtractorCacheFile } from './reference-extractor.js';
import type { ReferenceCacheFile as SyncCacheFile } from './syncer/reference-cache.js';

export interface CacheStatus {
  stale: boolean;
  reasons: string[];
  cachePaths: string[];
}

export class CacheManager {
  private readonly workspaceRoot: string;
  private readonly configHash: string;
  private readonly toolVersion: string;
  private readonly parserSignature: string;
  private readonly extractorCachePath: string;
  private readonly syncCachePath: string;
  private readonly previewDir: string;

  constructor(workspaceRoot: string, config: I18nConfig) {
    this.workspaceRoot = workspaceRoot;
    this.configHash = hashConfig(config);
    this.toolVersion = getToolVersion();
  this.parserSignature = getParsersSignature();
    this.extractorCachePath = getCachePath(workspaceRoot, 'extractor');
    this.syncCachePath = getCachePath(workspaceRoot, 'sync');
    this.previewDir = path.join(workspaceRoot, '.i18nsmith', 'previews');
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      fs.rm(path.dirname(this.extractorCachePath), { recursive: true, force: true }).catch(() => {}),
      fs.rm(path.dirname(this.syncCachePath), { recursive: true, force: true }).catch(() => {}),
      fs.rm(this.previewDir, { recursive: true, force: true }).catch(() => {}),
    ]);
  }

  async isStale(): Promise<{ stale: boolean; reason?: string }> {
    const status = await this.getStatus();
    if (!status.stale) {
      return { stale: false };
    }
    return { stale: true, reason: status.reasons.join(' | ') };
  }

  async autoInvalidate(): Promise<string[]> {
    const status = await this.getStatus();
    if (!status.stale) {
      return [];
    }
    await this.clearAll();
    return status.reasons;
  }

  async getStatus(): Promise<CacheStatus> {
    const reasons: string[] = [];
    const cachePaths = [this.extractorCachePath, this.syncCachePath];

    const extractorStatus = await this.checkCacheFile<ExtractorCacheFile>(this.extractorCachePath);
    if (extractorStatus) {
      reasons.push(`reference-cache: ${extractorStatus}`);
    }

    const syncStatus = await this.checkCacheFile<SyncCacheFile>(this.syncCachePath);
    if (syncStatus) {
      reasons.push(`sync-cache: ${syncStatus}`);
    }

    return {
      stale: reasons.length > 0,
      reasons,
      cachePaths,
    };
  }

  private async checkCacheFile<T extends { configHash?: string; toolVersion?: string }>(filePath: string): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as T;
      if (parsed.configHash && parsed.configHash !== this.configHash) {
        return 'config changed';
      }
      if (parsed.toolVersion && parsed.toolVersion !== this.toolVersion) {
        return 'tool version changed';
      }
      // If the cache stores a parser signature and it differs from the current
      // runtime parser signature, consider the cache stale.
      // (Use a type-unsafe access because different cache file shapes may or
      // may not include parserSignature.)
      const maybe = parsed as unknown as { parserSignature?: string };
      if (maybe.parserSignature && maybe.parserSignature !== this.parserSignature) {
        return 'parser implementation changed';
      }
      return undefined;
    } catch {
      return undefined;
    }
  }
}
