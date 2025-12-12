import * as vscode from 'vscode';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import { resolveCliCommand } from './cli-utils';
import { quoteCliArg } from './command-helpers';

const execAsync = promisify(exec);

export interface PreviewPayload<TSummary> {
  type: string;
  version: number;
  command: string;
  args: string[];
  timestamp: string;
  summary: TSummary;
}

interface PreviewRunOptions {
  kind: 'sync' | 'transform' | 'rename-key' | 'translate';
  args?: string[];
  workspaceRoot: string;
  label?: string;
}

export interface PreviewRunResult<TSummary> {
  payload: PreviewPayload<TSummary>;
  previewPath: string;
  stdout: string;
  stderr: string;
  command: string;
}

export class PreviewManager {
  constructor(private readonly output: vscode.OutputChannel) {}

  async run<TSummary>(options: PreviewRunOptions): Promise<PreviewRunResult<TSummary>> {
    const { kind, args = [], workspaceRoot, label } = options;
    const previewDir = path.join(workspaceRoot, '.i18nsmith', 'previews');
    await fs.mkdir(previewDir, { recursive: true });

    const previewPath = path.join(previewDir, `${kind}-preview-${Date.now()}.json`);
    const commandParts = ['i18nsmith', kind, ...args, '--preview-output', quoteCliArg(previewPath)].filter(Boolean);
    const humanReadable = commandParts.join(' ').trim();
    const resolvedCommand = resolveCliCommand(humanReadable);

    if (label) {
      this.output.appendLine(`\n[${label}]`);
    }
    this.output.appendLine(`$ ${humanReadable}`);

    try {
      const { stdout, stderr } = await execAsync(resolvedCommand, { cwd: workspaceRoot });
      if (stdout?.trim()) {
        this.output.appendLine(stdout.trim());
      }
      if (stderr?.trim()) {
        this.output.appendLine(`[stderr] ${stderr.trim()}`);
      }

      const raw = await fs.readFile(previewPath, 'utf8');
      const payload = JSON.parse(raw) as PreviewPayload<TSummary>;

      return {
        payload,
        previewPath,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        command: humanReadable,
      };
    } catch (error) {
      if (error && typeof error === 'object') {
        const err = error as { message?: string; stdout?: string; stderr?: string };
        if (err.stdout?.trim()) {
          this.output.appendLine(err.stdout.trim());
        }
        if (err.stderr?.trim()) {
          this.output.appendLine(`[stderr] ${err.stderr.trim()}`);
        }
        if (err.message) {
          this.output.appendLine(`[error] ${err.message}`);
        }
      }
      throw error;
    }
  }
}
