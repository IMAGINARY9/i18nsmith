import type { DynamicKeyWarning } from '@i18nsmith/core';

export type WhitelistBucket = 'assumptions' | 'globs';

export interface WhitelistSuggestion {
  id: string;
  expression: string;
  assumption: string;
  bucket: WhitelistBucket;
  filePath: string;
  position: { line: number; column: number };
}

export function deriveWhitelistSuggestions(warnings: DynamicKeyWarning[]): WhitelistSuggestion[] {
  const seen = new Set<string>();
  const suggestions: WhitelistSuggestion[] = [];

  warnings.forEach((warning, index) => {
    const derived = deriveAssumption(warning);
    if (!derived) {
      return;
    }
    const key = `${derived.bucket}:${derived.assumption}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    suggestions.push({
      id: `${index}-${key}`,
      expression: warning.expression,
      assumption: derived.assumption,
      bucket: derived.bucket,
      filePath: warning.filePath,
      position: warning.position,
    });
  });

  return suggestions;
}

export function mergeAssumptions(
  existing: string[] | undefined,
  additions: string[]
): { next: string[]; added: string[] } {
  const normalizedExisting = new Set(
    (existing ?? []).map((value) => normalizeManualAssumption(value)).filter(Boolean)
  );
  const added: string[] = [];

  for (const addition of additions) {
    const normalized = normalizeManualAssumption(addition);
    if (!normalized || normalizedExisting.has(normalized)) {
      continue;
    }
    normalizedExisting.add(normalized);
    added.push(normalized);
  }

  const next = Array.from(normalizedExisting).sort((a, b) => a.localeCompare(b));
  return { next, added };
}

export function normalizeManualAssumption(value: string): string {
  const trimmed = stripWrapper(value.trim());
  const templated = trimmed.replace(/\$\{[^}]+}/g, '*');
  const condensedDots = templated.replace(/\.{2,}/g, '.');
  const squeezed = condensedDots.replace(/\*{2,}/g, '*');
  return squeezed.replace(/^\./, '').replace(/\.$/, '');
}

function deriveAssumption(
  warning: DynamicKeyWarning
): { assumption: string; bucket: WhitelistBucket } | null {
  const rawExpression = warning.expression?.trim();
  if (!rawExpression) {
    return null;
  }

  if (warning.reason === 'template') {
    const glob = convertTemplateToGlob(rawExpression);
    return glob ? { assumption: glob, bucket: 'globs' } : null;
  }

  if (warning.reason === 'binary') {
    const lhs = rawExpression.split('||')[0] ?? rawExpression;
    const normalized = normalizeStaticPath(lhs);
    return normalized ? { assumption: normalized, bucket: 'assumptions' } : null;
  }

  if (rawExpression.includes('${')) {
    const glob = convertTemplateToGlob(rawExpression);
    return glob ? { assumption: glob, bucket: 'globs' } : null;
  }

  const normalized = normalizeStaticPath(rawExpression);
  if (normalized) {
    const bucket: WhitelistBucket = normalized.includes('*') ? 'globs' : 'assumptions';
    return { assumption: normalized, bucket };
  }

  return null;
}

function convertTemplateToGlob(expression: string): string | null {
  const stripped = stripWrapper(expression);
  if (!stripped) {
    return null;
  }
  const replaced = stripped.replace(/\$\{[^}]+}/g, '*');
  return normalizeStaticPath(replaced);
}

function normalizeStaticPath(input: string): string {
  const stripped = stripWrapper(input);
  if (!stripped) {
    return '';
  }
  const sanitized = stripped
    .replace(/\$\{[^}]+}/g, '*')
    .replace(/[^A-Za-z0-9_*.-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/\*{2,}/g, '*')
    .replace(/^\./, '')
    .replace(/\.$/, '');
  return sanitized;
}

function stripWrapper(value: string): string {
  let result = value.trim();
  const quotePairs: [string, string][] = [
    ['`', '`'],
    ['"', '"'],
    ['\'', '\''],
  ];
  for (const [open, close] of quotePairs) {
    if (result.startsWith(open) && result.endsWith(close)) {
      result = result.slice(open.length, -close.length).trim();
      break;
    }
  }
  if (result.startsWith('(') && result.endsWith(')')) {
    result = result.slice(1, -1).trim();
  }
  return result;
}
