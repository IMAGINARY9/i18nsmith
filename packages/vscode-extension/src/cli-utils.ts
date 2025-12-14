import * as vscode from 'vscode';

export function resolveCliCommand(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.length) {
    return trimmed;
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] !== 'i18nsmith') {
    return trimmed;
  }

  const rest = tokens.slice(1).join(' ');
  const config = vscode.workspace.getConfiguration('i18nsmith');
  const configuredPath = (config.get<string>('cliPath', '') ?? '').trim();

  if (configuredPath) {
    // cliPath is user-configurable and later executed via `exec(...)`.
    // We quote it, but still reject obvious shell metacharacters to reduce injection risk.
    if (/[\n\r`$;&|<>]/.test(configuredPath)) {
      return rest ? 'npx i18nsmith@latest ' + rest : 'npx i18nsmith@latest';
    }
    return rest ? `node "${configuredPath}" ${rest}` : `node "${configuredPath}"`;
  }

  return rest ? 'npx i18nsmith@latest ' + rest : 'npx i18nsmith@latest';
}
