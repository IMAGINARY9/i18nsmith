import * as vscode from 'vscode';
import { resolveCliCommand } from '../cli-utils';
import { runResolvedCliCommand } from '../cli-runner';
import type { TransformProgress } from '@i18nsmith/transformer';
import { ensureGitignore } from '@i18nsmith/core';
import { SmartScanner } from '../scanner';
import { ReportWatcher } from '../watcher';

export interface CliRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  warnings: string[];
}

export class CliService {
  private interactiveTerminal: vscode.Terminal | undefined;
  private verboseOutputChannel: vscode.OutputChannel;
  private smartScanner: SmartScanner;
  private reportWatcher: ReportWatcher;

  constructor(
    verboseOutputChannel: vscode.OutputChannel,
    smartScanner: SmartScanner,
    reportWatcher: ReportWatcher
  ) {
    this.verboseOutputChannel = verboseOutputChannel;
    this.smartScanner = smartScanner;
    this.reportWatcher = reportWatcher;

    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === this.interactiveTerminal) {
        this.interactiveTerminal = undefined;
      }
    });
  }

  public async runCliCommand(
    rawCommand: string,
    options: {
      interactive?: boolean;
      confirmMessage?: string;
      progress?: vscode.Progress<{ message?: string; increment?: number }>;
      showOutput?: boolean;
    } = {}
  ): Promise<CliRunResult | undefined> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const resolved = resolveCliCommand(rawCommand);
    if (!resolved.command) {
      vscode.window.showErrorMessage('Unable to determine CLI command to run.');
      return;
    }

    this.logVerbose(`runCliCommand: raw='${rawCommand}' resolved='${resolved.display}'`);

    if (options.confirmMessage || options.interactive) {
      const detailLines: string[] = [];
      if (options.confirmMessage) {
        detailLines.push(options.confirmMessage);
      }
      if (options.interactive) {
        detailLines.push('This command may scaffold files or install dependencies and will run in the i18nsmith terminal.');
      }
      detailLines.push('', `Command: ${resolved.display}`);
      const confirmLabel = options.interactive ? 'Run Command' : 'Continue';
      const choice = await vscode.window.showWarningMessage(
        options.interactive ? 'Run interactive i18nsmith command?' : 'Run i18nsmith command?',
        { modal: true, detail: detailLines.join('\n') },
        confirmLabel
      );
      if (choice !== confirmLabel) {
        return undefined;
      }
    }

    if (options.interactive) {
      const terminal = this.ensureInteractiveTerminal(workspaceFolder.uri.fsPath);
      terminal.show();
      terminal.sendText(resolved.display, true);
      vscode.window.showInformationMessage(
        'Command started in the integrated terminal. Refresh diagnostics once it completes.'
      );
      return undefined;
    }

    const out = vscode.window.createOutputChannel('i18nsmith');
    if (options.showOutput !== false) {
      out.show();
    }
    out.appendLine(`$ ${resolved.display}`);

    const progressTracker = createCliProgressTracker(options.progress);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    // Safety net: some CLI versions still prompt for confirmation during prune operations.
    // If that happens, auto-confirm so the VS Code progress notification doesn't hang forever.
    // (We also pass `--yes` in the command builder; this is a fallback.)
    const shouldAutoConfirm =
      !options.interactive && /\bi18nsmith\b[\s\S]*\bsync\b[\s\S]*--apply-preview/.test(rawCommand);

    const handleAutoConfirm = (text: string, child: import('child_process').ChildProcessWithoutNullStreams) => {
      if (!shouldAutoConfirm) {
        return;
      }
      if (/(\(y\/N\))|(\(Y\/n\))/i.test(text) || /Remove these\s+\d+\s+unused keys\?/i.test(text)) {
        this.logVerbose('runCliCommand: detected confirmation prompt; auto-sending "y"');
        try {
          child.stdin?.write('y\n');
        } catch {
          // ignore write errors
        }
      }
    };

    const result = await runResolvedCliCommand(resolved, {
      cwd: workspaceFolder.uri.fsPath,
      onStdout: (text, child) => {
        stdoutChunks.push(text);
        out.append(text);
        progressTracker?.handleChunk(text);
        handleAutoConfirm(text, child);
      },
      onStderr: (text, child) => {
        stderrChunks.push(text);
        out.append(text);
        handleAutoConfirm(text, child);
      },
    });

    progressTracker?.flush();

    const stdout = stdoutChunks.join('');
    const stderr = stderrChunks.join('');
    const warnings: string[] = [];

    if (result.code !== 0 || result.error) {
      const message = result.error?.message || `Command exited with code ${result.code}`;
      out.appendLine(`[error] ${message}`);
      vscode.window.showErrorMessage(`Command failed: ${message}`);
      return { success: false, stdout, stderr, warnings };
    }

    vscode.window.showInformationMessage('Command completed');

    progressTracker?.complete();
    await this.reportWatcher.refresh();
    if (this.smartScanner) {
      await this.smartScanner.scan('suggested-command');
    }
    return { success: true, stdout, stderr, warnings };
  }

  private ensureInteractiveTerminal(cwd: string): vscode.Terminal {
    if (!this.interactiveTerminal) {
      this.interactiveTerminal = vscode.window.createTerminal({ name: 'i18nsmith tasks', cwd });
    }
    return this.interactiveTerminal;
  }

  public async ensureGitignoreEntries(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    try {
      const result = await ensureGitignore(workspaceFolder.uri.fsPath);
      if (result.updated && result.added.length > 0) {
        this.logVerbose(`Added to .gitignore: ${result.added.join(', ')}`);
      }
    } catch (err) {
      // Silently ignore - this is a convenience feature
      this.logVerbose(`Failed to update .gitignore: ${err}`);
    }
  }

  private logVerbose(message: string) {
    this.verboseOutputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

function createCliProgressTracker(
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): null | {
  handleChunk: (text: string) => void;
  flush: () => void;
  complete: () => void;
} {
  if (!progress) {
    return null;
  }

  let buffer = '';
  let lastPercent = 0;
  const reportPercent = (percent?: number, message?: string) => {
    if (typeof percent !== 'number' || Number.isNaN(percent)) {
      return;
    }
    const bounded = Math.max(0, Math.min(100, percent));
    const increment = Math.max(0, bounded - lastPercent);
    lastPercent = Math.max(lastPercent, bounded);
    progress.report({
      message: message ?? `Working… ${bounded}%`,
      ...(increment > 0 ? { increment } : {}),
    });
  };

  const describePayload = (payload: Partial<TransformProgress> & { message?: string }): string | undefined => {
    if (payload.message) {
      return payload.message;
    }
    if (typeof payload.processed === 'number' && typeof payload.total === 'number') {
      return `Applying ${payload.processed}/${payload.total}`;
    }
    if (payload.stage) {
      return `Stage: ${payload.stage}`;
    }
    return undefined;
  };

  const parsePayload = (raw: string): (Partial<TransformProgress> & { message?: string }) | null => {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Partial<TransformProgress> & { message?: string };
      }
    } catch {
      const payload: Partial<TransformProgress> & { message?: string } = {};
      const percentMatch = raw.match(/percent[:=]\s*(\d+)/i);
      const processedMatch = raw.match(/processed[:=]\s*(\d+)/i);
      const totalMatch = raw.match(/total[:=]\s*(\d+)/i);
      const stageMatch = raw.match(/stage[:=]\s*([a-z-]+)/i);
      const messageMatch = raw.match(/message[:=]\s*(.+)$/i);
      if (percentMatch) payload.percent = Number(percentMatch[1]);
      if (processedMatch) payload.processed = Number(processedMatch[1]);
      if (totalMatch) payload.total = Number(totalMatch[1]);
      if (stageMatch) payload.stage = stageMatch[1] as TransformProgress['stage'];
      if (messageMatch) payload.message = messageMatch[1].trim();
      if (Object.keys(payload).length) {
        return payload;
      }
    }
    return null;
  };

  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    if (line.startsWith('[progress]')) {
      const payload = parsePayload(line.slice('[progress]'.length).trim());
      if (payload) {
        if ((payload.percent === undefined || Number.isNaN(payload.percent)) &&
            typeof payload.processed === 'number' &&
            typeof payload.total === 'number' &&
            payload.total > 0) {
          payload.percent = Math.min(100, Math.round((payload.processed / payload.total) * 100));
        }
        reportPercent(payload.percent, describePayload(payload));
        return;
      }
    }

    const applyMatch = line.match(/Applying transforms .*\((\d+)%\)/i);
    if (applyMatch) {
      reportPercent(Number(applyMatch[1]), line.replace(/\s+/g, ' ').trim());
    }
  };

  const feedText = (text: string) => {
    buffer += text.replace(/\r/g, '\n');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  };

  return {
    handleChunk(text: string) {
      feedText(text);
    },
    flush() {
      if (buffer.trim()) {
        handleLine(buffer);
        buffer = '';
      }
    },
    complete() {
      if (lastPercent < 100) {
        reportPercent(100, 'Completed.');
      } else {
        progress.report({ message: 'Completed.' });
      }
    },
  };
}
