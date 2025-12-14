import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { resolveCliCommand } from './cli-utils';
import { quoteCliArg } from './command-helpers';
import { runResolvedCliCommand } from './cli-runner';

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
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const result = await runResolvedCliCommand(resolvedCommand, {
        cwd: workspaceRoot,
        onStdout: (text) => {
          stdoutChunks.push(text);
          if (text.trim()) {
            this.output.appendLine(text.trim());
          }
        },
        onStderr: (text) => {
          stderrChunks.push(text);
          if (text.trim()) {
            this.output.appendLine(`[stderr] ${text.trim()}`);
          }
        },
      });

      if (result.code !== 0 || result.error) {
        const message = result.error?.message || `Command exited with code ${result.code}`;
        this.output.appendLine(`[error] ${message}`);
        throw new Error(message);
      }

      const raw = await fs.readFile(previewPath, 'utf8');
      const payload = JSON.parse(raw) as PreviewPayload<TSummary>;

      return {
        payload,
        previewPath,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        command: resolvedCommand.display,
      };
    } catch (error) {
      if (error && typeof error === 'object') {
        const err = error as { message?: string; stdout?: string; stderr?: string };
        if (err.message) {
          this.output.appendLine(`[error] ${err.message}`);
        }
      }
      throw error;
    }
  }
}
