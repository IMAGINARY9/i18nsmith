import crypto from 'crypto';
import { createRequire } from 'module';
import type { I18nConfig } from './config.js';

const localRequire = typeof require === 'function'
  ? require
  : createRequire(import.meta.url);
const packageJson = localRequire('../package.json') as { version?: string };

export function getToolVersion(): string {
  return packageJson.version ?? '0.0.0';
}

export function hashConfig(config: I18nConfig): string {
  const serialized = stableStringify(config);
  return crypto.createHash('sha256').update(serialized).digest('hex');
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
