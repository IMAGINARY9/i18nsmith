import * as fs from 'fs';
import * as path from 'path';
import {
  hasUnsafeConfigValue,
  isSafeLanguageTag,
  isSafeNamespace,
} from '@i18nsmith/core';
import {
  mergeAssumptions,
  normalizeManualAssumption,
  type WhitelistSuggestion,
} from './dynamic-key-whitelist';

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
  dynamicKeys?: {
    assumptions?: string[];
    globs?: string[];
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

export interface DynamicWhitelistSnapshot {
  assumptions: string[];
  globs: string[];
  normalizedEntries: string[];
}

export async function loadDynamicWhitelistSnapshot(workspaceRoot: string): Promise<DynamicWhitelistSnapshot | null> {
  const result = readWorkspaceConfigSnapshot(workspaceRoot);
  if (!result.ok) {
    return null;
  }
  const raw = result.snapshot.raw;
  const assumptions = Array.isArray(raw.dynamicKeys?.assumptions) ? (raw.dynamicKeys.assumptions as string[]) : [];
  const globs = Array.isArray(raw.dynamicKeys?.globs) ? (raw.dynamicKeys.globs as string[]) : [];
  const normalizedEntries = [
    ...assumptions.map((v) => normalizeManualAssumption(v)),
    ...globs.map((v) => normalizeManualAssumption(v)),
  ].filter(Boolean);

  return { assumptions, globs, normalizedEntries };
}

export async function persistDynamicKeyAssumptions(
  workspaceRoot: string,
  additions: WhitelistSuggestion[],
  _snapshot: DynamicWhitelistSnapshot
): Promise<{ assumptionsAdded: number; globsAdded: number } | null> {
  const configPath = path.join(workspaceRoot, 'i18n.config.json');
  let rawText: string;
  try {
    rawText = await fs.promises.readFile(configPath, 'utf8');
  } catch {
    return null;
  }

  let parsed: WorkspaceConfigShape;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return null;
  }

  if (!parsed.dynamicKeys || typeof parsed.dynamicKeys !== 'object') {
    parsed.dynamicKeys = {};
  }
  const dynamicKeys = parsed.dynamicKeys as { assumptions?: string[]; globs?: string[] };

  const newAssumptions = additions
    .filter((a) => a.bucket === 'assumptions')
    .map((a) => a.assumption);
  const newGlobs = additions
    .filter((a) => a.bucket === 'globs')
    .map((a) => a.assumption);

  const { next: nextAssumptions, added: addedAssumptions } = mergeAssumptions(
    dynamicKeys.assumptions,
    newAssumptions
  );
  const { next: nextGlobs, added: addedGlobs } = mergeAssumptions(dynamicKeys.globs, newGlobs);

  if (!addedAssumptions.length && !addedGlobs.length) {
    return { assumptionsAdded: 0, globsAdded: 0 };
  }

  dynamicKeys.assumptions = nextAssumptions;
  dynamicKeys.globs = nextGlobs;

  try {
    await fs.promises.writeFile(configPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    invalidateWorkspaceConfigCache(workspaceRoot);
    return {
      assumptionsAdded: addedAssumptions.length,
      globsAdded: addedGlobs.length,
    };
  } catch {
    return null;
  }
}

// Helper to normalize assumptions (moved from dynamic-key-whitelist.ts to avoid circular deps if needed, 
// but for now we import it. Wait, we can't import from dynamic-key-whitelist if it imports from us.
// Let's check imports. dynamic-key-whitelist imports from core. extension imports both.
// workspace-config imports core.
// We need to move loadDynamicWhitelistSnapshot and persistDynamicKeyAssumptions to workspace-config.ts 
// OR keep them in extension.ts but they need access to read/write config.
// The user said "Issues with 'Whitelist dynamic keys' action persist".
// The code I read in extension.ts calls `persistDynamicKeyAssumptions`.
// But `persistDynamicKeyAssumptions` was NOT in `extension.ts` (I read lines 1200-1300 and it called it).
// It must be imported.
// I checked `dynamic-key-whitelist.ts` and it DOES NOT export `persistDynamicKeyAssumptions`.
// Wait, I read `dynamic-key-whitelist.ts` lines 1-146. It exports `deriveWhitelistSuggestions`, `mergeAssumptions`, `normalizeManualAssumption`, `resolveWhitelistAssumption`.
// It does NOT export `persistDynamicKeyAssumptions`.
// So where is it?
// In `extension.ts` line 1214: `const persistResult = await persistDynamicKeyAssumptions(...)`.
// It must be defined in `extension.ts`.
// I read lines 1200-1300 of `extension.ts`. It calls it.
// I did NOT see the definition in the range I read.
// I will search for `function persistDynamicKeyAssumptions` in `extension.ts`.
