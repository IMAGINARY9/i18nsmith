export interface TranslateRunOptions {
  locales?: string[];
  provider?: string;
  force?: boolean;
  skipEmpty?: boolean;
  strictPlaceholders?: boolean;
  estimate?: boolean;
}

export type PreviewableCommand =
  | { kind: 'sync' | 'transform'; targets?: string[] }
  | { kind: 'rename-key'; from: string; to: string }
  | { kind: 'translate'; options: TranslateRunOptions };

const SUPPORTED_SUBCOMMANDS = new Set<PreviewableCommand['kind']>([
  'sync',
  'transform',
  'rename-key',
  'translate',
]);

type SubcommandInvocation = {
  kind: PreviewableCommand['kind'];
  args: string[];
};

export function parsePreviewableCommand(rawCommand: string): PreviewableCommand | null {
  const tokens = tokenizeCliCommand(rawCommand);
  if (!tokens.length) {
    return null;
  }

  const invocation = findCliInvocation(tokens);
  if (!invocation) {
    return null;
  }

  const { kind, args } = invocation;

  if (kind === 'sync' || kind === 'transform') {
    const targets = parseTargetArgs(args);
    return { kind, targets: targets.length ? targets : undefined };
  }

  if (kind === 'rename-key') {
    const renameArgs = parseRenameArgs(args);
    if (!renameArgs) {
      return null;
    }
    return { kind: 'rename-key', ...renameArgs };
  }

  if (kind === 'translate') {
    const translateOptions = parseTranslateOptions(args);
    if (!translateOptions) {
      return null;
    }
    return { kind: 'translate', options: translateOptions };
  }

  return null;
}

function findCliInvocation(tokens: string[]): SubcommandInvocation | null {
  const executableIndex = tokens.findIndex(isCliExecutableToken);
  if (executableIndex === -1) {
    return null;
  }

  const subcommand = tokens[executableIndex + 1];
  if (!isSupportedSubcommand(subcommand)) {
    return null;
  }

  return {
    kind: subcommand,
    args: tokens.slice(executableIndex + 2),
  };
}

function isSupportedSubcommand(token: string | undefined): token is PreviewableCommand['kind'] {
  return Boolean(token && SUPPORTED_SUBCOMMANDS.has(token as PreviewableCommand['kind']));
}

function isCliExecutableToken(token: string): boolean {
  if (!token) {
    return false;
  }
  const normalized = token.replace(/^['"]|['"]$/g, '');
  if (!normalized) {
    return false;
  }
  if (normalized === 'i18nsmith') {
    return true;
  }
  if (normalized.startsWith('i18nsmith@')) {
    return true;
  }
  if (/[/\\]i18nsmith([/\\]|$)/i.test(normalized)) {
    return true;
  }
  if (/i18nsmith.*\.c?js$/i.test(normalized)) {
    return true;
  }
  return false;
}

function parseTargetArgs(args: string[]): string[] {
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' && args[i + 1]) {
      targets.push(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--target=')) {
      const value = arg.slice('--target='.length);
      if (value) {
        targets.push(value);
      }
    }
  }
  return targets;
}

function parseRenameArgs(args: string[]): { from: string; to: string } | null {
  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (positionals.length < 2) {
    return null;
  }
  const [from, to] = positionals;
  if (!from || !to || from === to) {
    return null;
  }
  return { from, to };
}

function parseTranslateOptions(args: string[]): TranslateRunOptions | null {
  const options: TranslateRunOptions = {};
  const locales: string[] = [];

  const addLocales = (value: string) => {
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((locale) => locales.push(locale));
  };

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith('-')) {
      continue;
    }

    if (token === '--write' || token === '--yes' || token === '-y') {
      continue;
    }

    if (token === '--force') {
      options.force = true;
      continue;
    }

    if (token === '--estimate') {
      options.estimate = true;
      continue;
    }

    if (token === '--strict-placeholders') {
      options.strictPlaceholders = true;
      continue;
    }

    if (token === '--no-skip-empty') {
      options.skipEmpty = false;
      continue;
    }

    if (token === '--locales') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return null;
      }
      addLocales(value);
      i += 1;
      continue;
    }

    if (token.startsWith('--locales=')) {
      addLocales(token.slice('--locales='.length));
      continue;
    }

    if (token === '--provider') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return null;
      }
      options.provider = value;
      i += 1;
      continue;
    }

    if (token.startsWith('--provider=')) {
      options.provider = token.slice('--provider='.length);
      continue;
    }

    if (
      token === '--preview-output' ||
      token.startsWith('--preview-output=') ||
      token === '--report' ||
      token.startsWith('--report=') ||
      token === '--json' ||
      token === '--export' ||
      token.startsWith('--export=') ||
      token === '--import' ||
      token.startsWith('--import=') ||
      token === '--config' ||
      token === '-c' ||
      token.startsWith('--config=')
    ) {
      return null;
    }

    if (token.startsWith('-')) {
      return null;
    }
  }

  if (locales.length) {
    options.locales = locales;
  }

  return options;
}

export function tokenizeCliCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  const pushToken = () => {
    if (current.length) {
      tokens.push(current);
      current = '';
    }
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) {
        pushToken();
        quote = null;
      } else if (char === '\\' && i + 1 < command.length) {
        i += 1;
        current += command[i];
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === '\'') {
        quote = char;
        if (current.length) {
          pushToken();
        }
      } else if (/\s/.test(char)) {
        pushToken();
      } else {
        current += char;
      }
    }
  }

  if (quote) {
    pushToken();
  }

  pushToken();
  return tokens;
}
