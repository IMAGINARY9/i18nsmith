import { createPatch } from 'diff';
import path from 'path';

export interface LocaleDiffEntry {
  locale: string;
  path: string;
  diff: string;
  added: string[];
  updated: string[];
  removed: string[];
}

export interface SourceFileDiffEntry {
  path: string;
  relativePath: string;
  diff: string;
  changes: number;
}

export interface LocaleDiffPreview {
  locale: string;
  add: string[];
  remove: string[];
}

export function buildLocaleDiffs(
  originalData: Map<string, Record<string, string>>,
  projectedData: Map<string, Record<string, string>>,
  getFilePath: (locale: string) => string,
  workspaceRoot: string
): LocaleDiffEntry[] {
  const locales = new Set([...originalData.keys(), ...projectedData.keys()]);
  const diffs: LocaleDiffEntry[] = [];

  for (const locale of locales) {
    const before = sortLocaleData(originalData.get(locale) ?? {});
    const after = sortLocaleData(projectedData.get(locale) ?? {});

    if (areLocaleDataEqual(before, after)) {
      continue;
    }

    const beforeSerialized = `${JSON.stringify(before, null, 2)}\n`;
    const afterSerialized = `${JSON.stringify(after, null, 2)}\n`;
    const filePath = getFilePath(locale);
    const relativePath = path.relative(workspaceRoot, filePath) || filePath;
    const patch = createPatch(relativePath, beforeSerialized, afterSerialized);

    const { added, updated, removed } = computeDiffStats(before, after);

    diffs.push({
      locale,
      path: filePath,
      diff: patch,
      added,
      updated,
      removed,
    });
  }

  return diffs;
}

export function buildLocalePreview(
  projectedData: Map<string, Record<string, string>>,
  originalData: Map<string, Record<string, string>>
): LocaleDiffPreview[] {
  const allLocales = new Set([...projectedData.keys(), ...originalData.keys()]);
  const preview: LocaleDiffPreview[] = [];

  for (const locale of allLocales) {
    const projected = projectedData.get(locale) ?? {};
    const original = originalData.get(locale) ?? {};
    const projectedKeys = new Set(Object.keys(projected));
    const originalKeys = new Set(Object.keys(original));

    const added = [...projectedKeys].filter((key) => !originalKeys.has(key));
    const removed = [...originalKeys].filter((key) => !projectedKeys.has(key));

    if (added.length || removed.length) {
      preview.push({
        locale,
        add: added.sort(),
        remove: removed.sort(),
      });
    }
  }

  return preview;
}

function sortLocaleData(data: Record<string, string>): Record<string, string> {
  return Object.keys(data)
    .sort((a, b) => a.localeCompare(b))
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = data[key];
      return acc;
    }, {});
}

function areLocaleDataEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

function computeDiffStats(
  before: Record<string, string>,
  after: Record<string, string>
): { added: string[]; updated: string[]; removed: string[] } {
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const prev = before[key];
    const next = after[key];
    if (typeof prev === 'undefined' && typeof next !== 'undefined') {
      added.push(key);
      continue;
    }
    if (typeof next === 'undefined') {
      removed.push(key);
      continue;
    }
    if (prev !== next) {
      updated.push(key);
    }
  }

  return {
    added: added.sort(),
    updated: updated.sort(),
    removed: removed.sort(),
  };
}

/**
 * Create a unified diff for a source file change.
 */
export function createUnifiedDiff(
  filePath: string,
  originalContent: string,
  newContent: string,
  workspaceRoot: string
): SourceFileDiffEntry | null {
  if (originalContent === newContent) {
    return null;
  }

  const relativePath = path.relative(workspaceRoot, filePath) || filePath;
  const diff = createPatch(relativePath, originalContent, newContent);

  // Count the number of changes (lines starting with + or - that aren't headers)
  const lines = diff.split('\n');
  let changes = 0;
  for (const line of lines) {
    if ((line.startsWith('+') || line.startsWith('-')) && 
        !line.startsWith('+++') && 
        !line.startsWith('---')) {
      changes++;
    }
  }

  return {
    path: filePath,
    relativePath,
    diff,
    changes,
  };
}

/**
 * Build diffs for multiple source files.
 */
export function buildSourceFileDiffs(
  fileChanges: Array<{ path: string; original: string; modified: string }>,
  workspaceRoot: string
): SourceFileDiffEntry[] {
  const diffs: SourceFileDiffEntry[] = [];

  for (const change of fileChanges) {
    const diff = createUnifiedDiff(change.path, change.original, change.modified, workspaceRoot);
    if (diff) {
      diffs.push(diff);
    }
  }

  return diffs;
}
