import * as path from 'path';

export function quoteCliArg(value: string): string {
  if (!value) {
    return '""';
  }
  const escaped = value.replace(/(["\\])/g, '\\$1');
  return `"${escaped}"`;
}

export function normalizeTargetForCli(absolutePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith('..')) {
    return absolutePath;
  }
  return relative.split(path.sep).join(path.posix.sep);
}

export function buildSyncApplyCommand(
  previewPath: string,
  selectionPath: string,
  workspaceRoot: string
): string {
  const previewArg = normalizeTargetForCli(previewPath, workspaceRoot);
  const selectionArg = normalizeTargetForCli(selectionPath, workspaceRoot);
  return [
    'i18nsmith sync',
    '--apply-preview',
    quoteCliArg(previewArg),
    '--selection-file',
    quoteCliArg(selectionArg),
    '--prune',
    '--yes',
  ].join(' ');
}

export function buildExportMissingTranslationsCommand(targetPath: string, workspaceRoot: string): string {
  const exportArg = normalizeTargetForCli(targetPath, workspaceRoot);
  return ['i18nsmith translate --export', quoteCliArg(exportArg)].join(' ');
}
