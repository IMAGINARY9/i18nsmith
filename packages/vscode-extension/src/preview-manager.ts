import * as vscode from 'vscode';
import * as path from 'path';
import { promises as fs } from 'fs';
import { quoteCliArg } from './command-helpers';
import { CliService } from './services/cli-service';

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
  constructor(
    private readonly cliService: CliService,
    private readonly output: vscode.OutputChannel
  ) {}

  async run<TSummary>(options: PreviewRunOptions): Promise<PreviewRunResult<TSummary>> {
    const { kind, args = [], workspaceRoot, label } = options;
    const previewDir = path.join(workspaceRoot, '.i18nsmith', 'previews');
    await fs.mkdir(previewDir, { recursive: true });

    // Cleanup old previews (older than 1 hour)
    this.cleanupOldPreviews(previewDir).catch(() => {});

    const previewPath = path.join(previewDir, `${kind}-preview-${Date.now()}.json`);
    const commandParts = ['i18nsmith', kind, ...args, '--preview-output', quoteCliArg(previewPath)].filter(Boolean);
    const humanReadable = commandParts.join(' ').trim();
    if (label) {
      this.output.appendLine(`\n[${label}]`);
    }
    this.output.appendLine(`$ ${humanReadable}`);

    try {
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const result = await this.cliService.runCliCommand(humanReadable, {
        cwd: workspaceRoot,
        showOutput: false,
        label,
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
        suppressNotifications: true,
        skipReportRefresh: true,
      });

      if (!result?.success) {
        const message = result?.stderr || 'Preview command failed';
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
        command: humanReadable,
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

  private async cleanupOldPreviews(previewDir: string): Promise<void> {
    try {
      const files = await fs.readdir(previewDir);
      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }
        const filePath = path.join(previewDir, file);
        try {
          const stats = await fs.stat(filePath);
          if (now - stats.mtimeMs > ONE_HOUR) {
            await fs.unlink(filePath);
          }
        } catch {
          // Ignore errors for individual files
        }
      }
    } catch {
      // Ignore errors reading directory
    }
  }
}
