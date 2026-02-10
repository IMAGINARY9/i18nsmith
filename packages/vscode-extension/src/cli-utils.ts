import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ResolvedCliCommand {
  /** Full command string for display/logging */
  display: string;
  /** Executable for spawn/execFile */
  command: string;
  /** Argument array for spawn/execFile */
  args: string[];
  /** Indicates whether we used a configured cliPath */
  source: 'configured-cli' | 'workspace-local' | 'global' | 'npx-pass-through' | 'external';
}

interface ResolveOptions {
  preferredCliPath?: string;
  workspaceRoot?: string;
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

  let resolvedCliPath = configuredPath || preferredCliPath;
  let resolvedSource: ResolvedCliCommand['source'] | null = resolvedCliPath
    ? configuredPath
      ? 'configured-cli'
      : 'workspace-local'
    : null;

  // If no configured CLI path and targeting i18nsmith, try to auto-detect workspace-local CLI
  if (!resolvedCliPath && targetsI18nsmith && options.workspaceRoot) {
    resolvedCliPath = findWorkspaceLocalCli(options.workspaceRoot);
    if (resolvedCliPath) {
      resolvedSource = 'workspace-local';
    }
  }

  // If still unresolved, try to locate a bundled CLI from the extension (dev host / packaged)
  if (!resolvedCliPath && targetsI18nsmith) {
    resolvedCliPath = findExtensionBundledCli();
    if (resolvedCliPath) {
      resolvedSource = 'workspace-local';
    }
  }

  if (!resolvedCliPath && targetsI18nsmith) {
    resolvedCliPath = findGlobalCliOnPath();
    if (resolvedCliPath) {
      resolvedSource = 'global';
    }
  }

  const commandLine = buildCommandLine(trimmed, resolvedCliPath);
  const tokens = splitCommandLine(commandLine);
  const command = tokens.shift() ?? '';

  return {
    display: commandLine,
    command,
    args: tokens,
    source: targetsI18nsmith
      ? resolvedCliPath
        ? (resolvedSource ?? 'workspace-local')
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
    // Only prefix with node for javascript files
    const needsNode = /\.(js|cjs|mjs)$/i.test(cliPath);
    const cmd = needsNode ? `node "${cliPath}"` : `"${cliPath}"`;
    return rest ? `${cmd} ${rest}` : cmd;
  }
  // Prefer local version if available, otherwise npx will fetch latest
  // Use npx without @latest to allow the local npx cache to be reused
  return rest ? `npx i18nsmith ${rest}` : 'npx i18nsmith';
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

function findWorkspaceLocalCli(workspaceRoot: string): string {
  // Candidate paths in order of preference
  const candidates = [
    path.join(workspaceRoot, '.i18nsmith', 'cli.js'), // project-scoped custom CLI
    path.join(workspaceRoot, 'node_modules', '.bin', 'i18nsmith'), // installed via npm/yarn/pnpm
    path.join(workspaceRoot, 'packages', 'cli', 'dist', 'index.js'), // monorepo layout
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        // Basic safety check: ensure no shell metacharacters
        if (!/[\n\r`$;&|<>]/.test(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Ignore errors and continue to next candidate
    }
  }

  return '';
}

function findExtensionBundledCli(): string {
  try {
    const extension = vscode.extensions.getExtension('ArturLavrov.i18nsmith-vscode');
    if (!extension) return '';
    const extensionPath = extension.extensionPath;
    const candidates = [
      path.join(extensionPath, '..', 'cli', 'dist', 'index.js'),
    ];
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          if (!/[\n\r`$;&|<>]/.test(candidate)) {
            return candidate;
          }
        }
      } catch {
        // continue
      }
    }
  } catch {
    // ignore
  }
  return '';
}

function findGlobalCliOnPath(): string {
  const pathValue = process.env.PATH ?? '';
  if (!pathValue) {
    return '';
  }
  const candidateNames = process.platform === 'win32'
    ? ['i18nsmith.cmd', 'i18nsmith.exe', 'i18nsmith']
    : ['i18nsmith'];
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);

  for (const entry of pathEntries) {
    for (const name of candidateNames) {
      const candidate = path.join(entry, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          if (!/[\n\r`$;&|<>]/.test(candidate)) {
            return candidate;
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return '';
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
