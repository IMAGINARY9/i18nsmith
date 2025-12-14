import * as vscode from 'vscode';

export interface ResolvedCliCommand {
  /** Full command string for display/logging */
  display: string;
  /** Executable for spawn/execFile */
  command: string;
  /** Argument array for spawn/execFile */
  args: string[];
  /** Indicates whether we used a configured cliPath */
  source: 'configured-cli' | 'npx-pass-through' | 'external';
}

interface ResolveOptions {
  preferredCliPath?: string;
}

export function resolveCliCommand(raw: string, options: ResolveOptions = {}): ResolvedCliCommand {
  const trimmed = raw.trim();
  if (!trimmed.length) {
    return { display: '', command: '', args: [], source: 'external' };
  }

  const config = vscode.workspace.getConfiguration('i18nsmith');
  const configuredPath = sanitizeCliPath(config.get<string>('cliPath', ''));
  const preferredCliPath = sanitizeCliPath(options.preferredCliPath ?? '');
  const targetsI18nsmith = trimmed.startsWith('i18nsmith');

  const commandLine = buildCommandLine(trimmed, configuredPath || preferredCliPath);
  const tokens = splitCommandLine(commandLine);
  const command = tokens.shift() ?? '';

  return {
    display: commandLine,
    command,
    args: tokens,
    source: targetsI18nsmith
      ? configuredPath || preferredCliPath
        ? 'configured-cli'
        : 'npx-pass-through'
      : 'external',
  };
}

function buildCommandLine(raw: string, cliPath?: string): string {
  if (!raw.startsWith('i18nsmith')) {
    return raw;
  }

  const rest = raw.slice('i18nsmith'.length).trim();
  if (cliPath) {
    return rest ? `node "${cliPath}" ${rest}` : `node "${cliPath}"`;
  }
  return rest ? `npx i18nsmith@latest ${rest}` : 'npx i18nsmith@latest';
}

function sanitizeCliPath(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return '';
  }
  if (/[\n\r`$;&|<>]/.test(trimmed)) {
    return '';
  }
  return trimmed;
}

function splitCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escapeNext = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (quote === '"' && char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' || char === "'") {
      if (quote === char) {
        quote = null;
      } else if (!quote) {
        quote = char;
      } else {
        current += char;
      }
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current.length) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length) {
    tokens.push(current);
  }

  return tokens;
}
