import * as fs from 'fs';
import * as path from 'path';
import {
  hasUnsafeConfigValue,
  isSafeLanguageTag,
  isSafeNamespace,
} from '@i18nsmith/core';

export interface WorkspaceConfigShape {
  localesDir?: string;
  sourceLanguage?: string;
  keyGeneration?: {
    namespace?: string;
    shortHashLen?: number;
  };
  globs?: {
    localesDir?: string;
  };
  [key: string]: unknown;
}

export interface WorkspaceConfigSnapshot {
  configPath: string;
  localesDir: string;
  sourceLanguage: string;
  keyGeneration?: WorkspaceConfigShape['keyGeneration'];
  raw: WorkspaceConfigShape;
}

export type WorkspaceConfigResult =
  | { ok: true; snapshot: WorkspaceConfigSnapshot }
  | { ok: false; error: Error };

interface CacheEntry {
  mtimeMs: number;
  snapshot: WorkspaceConfigSnapshot;
}

const cache = new Map<string, CacheEntry>();

export function getWorkspaceConfigSnapshot(workspaceRoot?: string): WorkspaceConfigSnapshot | null {
  const result = readWorkspaceConfigSnapshot(workspaceRoot);
  return result.ok ? result.snapshot : null;
}

export function readWorkspaceConfigSnapshot(workspaceRoot?: string): WorkspaceConfigResult {
  if (!workspaceRoot) {
    return { ok: false, error: new Error('Workspace root is not defined') };
  }

  const configPath = path.join(workspaceRoot, 'i18n.config.json');

  let stats: fs.Stats;
  try {
    stats = fs.statSync(configPath);
  } catch (error) {
    cache.delete(configPath);
    return { ok: false, error: toError(error, 'Unable to access i18n.config.json') };
  }

  const cached = cache.get(configPath);
  if (cached && cached.mtimeMs === stats.mtimeMs) {
    return { ok: true, snapshot: cloneSnapshot(cached.snapshot) };
  }

  try {
    const rawText = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(rawText) as WorkspaceConfigShape;
    const snapshot = buildSnapshot(configPath, parsed);
    cache.set(configPath, { mtimeMs: stats.mtimeMs, snapshot });
    return { ok: true, snapshot: cloneSnapshot(snapshot) };
  } catch (error) {
    cache.delete(configPath);
    return { ok: false, error: toError(error, 'Failed to read i18n.config.json') };
  }
}

export function invalidateWorkspaceConfigCache(workspaceRoot?: string) {
  if (!workspaceRoot) {
    return;
  }
  const configPath = path.join(workspaceRoot, 'i18n.config.json');
  cache.delete(configPath);
}

function buildSnapshot(configPath: string, raw: WorkspaceConfigShape): WorkspaceConfigSnapshot {
  validateWorkspaceConfig(raw);
  const localesDir =
    typeof raw?.localesDir === 'string' && raw.localesDir?.trim()
      ? raw.localesDir
      : typeof raw?.globs?.localesDir === 'string' && raw.globs.localesDir?.trim()
        ? raw.globs.localesDir
        : 'locales';

  const sourceLanguage =
    typeof raw?.sourceLanguage === 'string' && raw.sourceLanguage?.trim() ? raw.sourceLanguage : 'en';

  return {
    configPath,
    localesDir,
    sourceLanguage,
    keyGeneration: raw?.keyGeneration,
    raw,
  };
}

function validateWorkspaceConfig(raw: WorkspaceConfigShape): void {
  const errors: string[] = [];

  const candidateLocalesDir =
    typeof raw?.localesDir === 'string' && raw.localesDir?.trim()
      ? raw.localesDir
      : typeof raw?.globs?.localesDir === 'string' && raw.globs.localesDir?.trim()
        ? raw.globs.localesDir
        : undefined;
  if (candidateLocalesDir && hasUnsafeConfigValue(candidateLocalesDir)) {
    errors.push('localesDir cannot include control characters or shell metacharacters');
  }

  if (typeof raw?.sourceLanguage === 'string' && raw.sourceLanguage.trim()) {
    if (!isSafeLanguageTag(raw.sourceLanguage.trim())) {
      errors.push('sourceLanguage must use letters, numbers, dashes, or underscores only');
    }
  }

  const namespace = raw?.keyGeneration?.namespace;
  if (typeof namespace === 'string' && namespace.trim()) {
    if (!isSafeNamespace(namespace.trim())) {
      errors.push('keyGeneration.namespace may only contain letters, numbers, dot, dash, or underscore');
    }
  }

  const shortHashLen = raw?.keyGeneration?.shortHashLen;
  if (typeof shortHashLen !== 'undefined') {
    if (typeof shortHashLen !== 'number' || !Number.isFinite(shortHashLen)) {
      errors.push('keyGeneration.shortHashLen must be a number');
    } else if (shortHashLen < 4 || shortHashLen > 32) {
      errors.push('keyGeneration.shortHashLen must be between 4 and 32');
    }
  }

  if (errors.length) {
    throw new Error(`Invalid i18n.config.json:\n- ${errors.join('\n- ')}`);
  }
}

function cloneSnapshot(snapshot: WorkspaceConfigSnapshot): WorkspaceConfigSnapshot {
  return {
    ...snapshot,
    keyGeneration: snapshot.keyGeneration ? { ...snapshot.keyGeneration } : undefined,
    raw: clone(snapshot.raw),
  };
}

function clone<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function toError(value: unknown, fallbackMessage: string): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(`${fallbackMessage}: ${String(value)}`);
}
