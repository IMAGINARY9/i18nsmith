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
    return rest ? `node "${configuredPath}" ${rest}` : `node "${configuredPath}"`;
  }

  return rest ? 'npx i18nsmith@latest ' + rest : 'npx i18nsmith@latest';
}

export function quoteCliArg(value: string): string {
  if (!value) {
    return '""';
  }
  const escaped = value.replace(/(["\\])/g, '\\$1');
  return `"${escaped}"`;
}
