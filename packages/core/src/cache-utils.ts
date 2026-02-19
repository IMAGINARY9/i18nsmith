import crypto from 'crypto';
import type { I18nConfig } from './config.js';
import { packageVersion } from './version.js';
import { VueParser } from './parsers/vue-parser.js';
import { TypeScriptParser } from './parsers/typescript-parser.js';

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
 */
export function getParsersSignature(): string {
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
