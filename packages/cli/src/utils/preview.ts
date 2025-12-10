import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export interface PreviewPayload<TSummary> {
  type: string;
  version: number;
  command: string;
  args: string[];
  timestamp: string;
  summary: TSummary;
}

export type PreviewKind = 'sync' | 'transform' | 'rename-key' | 'translate';

export async function writePreviewFile<TSummary>(
  kind: PreviewKind,
  summary: TSummary,
  outputPath: string
): Promise<string> {
  const resolvedPath = path.resolve(process.cwd(), outputPath);
  const payload: PreviewPayload<TSummary> = {
  type: `${kind}-preview`,
    version: 1,
    command: buildCommandString(),
    args: process.argv.slice(2),
    timestamp: new Date().toISOString(),
    summary,
  };

  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, JSON.stringify(payload, null, 2), 'utf8');
  return resolvedPath;
}

export async function readPreviewFile<TSummary>(
  expectedKind: PreviewKind,
  previewPath: string
): Promise<PreviewPayload<TSummary>> {
  const resolved = path.resolve(process.cwd(), previewPath);
  const raw = await fs.readFile(resolved, 'utf8');
  const payload = JSON.parse(raw) as PreviewPayload<TSummary>;
  if (!payload?.type?.startsWith(`${expectedKind}-preview`)) {
    throw new Error(`Preview kind mismatch. Expected ${expectedKind}, got ${payload?.type ?? 'unknown'}.`);
  }
  if (!Array.isArray(payload.args) || payload.args.length === 0) {
    throw new Error('Preview file is missing recorded CLI arguments.');
  }
  return payload;
}

export async function applyPreviewFile(
  expectedKind: PreviewKind,
  previewPath: string,
  extraArgs: string[] = []
): Promise<void> {
  const payload = await readPreviewFile(expectedKind, previewPath);
  const sanitizedArgs = sanitizePreviewArgs(payload.args);
  const [command, ...rest] = sanitizedArgs;
  if (!command) {
    throw new Error('Preview file does not include the original command.');
  }
  if (command !== expectedKind) {
    throw new Error(`Preview command mismatch. Expected ${expectedKind}, got ${command}.`);
  }

  const replayArgs = [command, ...rest];
  if (!replayArgs.some((arg) => arg === '--write' || arg.startsWith('--write='))) {
    replayArgs.push('--write');
  }
  for (const extra of extraArgs) {
    if (!replayArgs.includes(extra)) {
      replayArgs.push(extra);
    }
  }

  console.log(`Applying preview from ${path.relative(process.cwd(), path.resolve(previewPath))}…`);
  await spawnCli(replayArgs);
}

function sanitizePreviewArgs(args: string[]): string[] {
  const sanitized: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--preview-output') {
      i += 1;
      continue;
    }
    if (token?.startsWith('--preview-output=')) {
      continue;
    }
    sanitized.push(token);
  }
  return sanitized;
}

function spawnCli(args: string[]): Promise<void> {
  const entry = process.argv[1];
  if (!entry) {
    return Promise.reject(new Error('Unable to determine CLI entry point for preview apply.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.argv[0], [entry, ...args], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Preview apply command exited with code ${code ?? 'unknown'}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

function buildCommandString(): string {
  // Ignore the node + script path, keep user arguments only
  const args = process.argv.slice(2);
  return args.length ? `i18nsmith ${args.join(' ')}` : 'i18nsmith';
}
