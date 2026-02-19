import crypto from 'crypto';
import type { I18nConfig } from './config.js';
import { packageVersion } from './version.js';
import { VueParser } from './parsers/vue-parser.js';
import { TypeScriptParser } from './parsers/typescript-parser.js';

/**
 * Import build-time signature if available.
 * Falls back to undefined if file doesn't exist (development mode).
 */
let BUILD_TIME_SIGNATURE: string | undefined;
try {
  // Dynamic import at module load time
  const mod = await import('./parser-signature.js');
  BUILD_TIME_SIGNATURE = mod.BUILD_TIME_PARSER_SIGNATURE;
} catch {
  // File doesn't exist yet (development mode before first build)
  BUILD_TIME_SIGNATURE = undefined;
}

export function getToolVersion(): string {
  return packageVersion ?? '0.0.0';
}

export function hashConfig(config: I18nConfig): string {
  const serialized = stableStringify(config);
  return crypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Compute a stable signature representing the current implementation of the
 * built-in parsers used for reference extraction. This allows caches to be
 * invalidated automatically when parser logic changes (without a manual
 * CACHE_VERSION bump).
 * 
 * Prefers build-time signature (zero runtime overhead) with fallback to
 * runtime introspection in development mode.
 */
export function getParsersSignature(): string {
  // Use build-time signature if available (production builds)
  if (BUILD_TIME_SIGNATURE) {
    return BUILD_TIME_SIGNATURE;
  }
  
  // Fall back to runtime introspection (development mode)
  return computeRuntimeParserSignature();
}

/**
 * Compute parser signature at runtime via reflection.
 * Used as fallback when build-time signature is not available.
 */
function computeRuntimeParserSignature(): string {
  const parts: string[] = [];
  try {
    // Vue parser important methods (cast prototype to any so TypeScript's
    // access modifiers don't block our runtime introspection).
    const vproto = (VueParser as unknown as { prototype: Record<string, unknown> }).prototype;
    if (vproto) {
      for (const name of ['walkVueAST', 'isTranslationCall', 'extractKeyFromVueCall']) {
  const fn = vproto[name] as ((...args: unknown[]) => unknown) | undefined;
        if (typeof fn === 'function') parts.push(fn.toString());
      }
    }
  } catch (e) {
    // ignore
  }

  try {
    const tproto = (TypeScriptParser as unknown as { prototype: Record<string, unknown> }).prototype;
    if (tproto) {
      for (const name of ['extractKeyFromCall', 'extractReferencesFromFile']) {
  const fn = tproto[name] as ((...args: unknown[]) => unknown) | undefined;
        if (typeof fn === 'function') parts.push(fn.toString());
      }
    }
  } catch (e) {
    // ignore
  }

  const combined = parts.join('\n');
  return crypto.createHash('sha256').update(combined).digest('hex');
}

/**
 * Compute cache version number based on schema version and parser signature.
 * This eliminates the need for manual CACHE_VERSION bumps when parser code changes.
 * 
 * Schema version should only be incremented when the cache structure itself changes
 * (new required fields, removed fields, type changes, etc.).
 * 
 * Parser signature automatically tracks parser implementation changes, so cache
 * invalidates when parser behavior changes without manual intervention.
 * 
 * @param parserSignature - SHA-256 hash of parser implementations
 * @param schemaVersion - Version of the cache structure (default: 1)
 * @returns Computed cache version number
 */
export function computeCacheVersion(
  parserSignature: string,
  schemaVersion: number = 1
): number {
  // Use first 8 hex chars of parser signature as numeric component
  // This gives us 4 billion possible values (16^8 / 2)
  const signaturePrefix = parseInt(parserSignature.substring(0, 8), 16);
  
  // Schema version in millions place, signature in lower places
  // Example: schema=1, sig=0x12345678 -> 1000000 + (0x12345678 % 1000000)
  return schemaVersion * 1000000 + (signaturePrefix % 1000000);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${entries.join(',')}}`;
}
