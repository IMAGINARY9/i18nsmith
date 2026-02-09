import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceContainer } from '../services/container';
import type { PreviewRunResult } from '../preview-manager';
import type { CliRunOptions } from '../services/cli-service';
import { runAdapterPreflightCheck } from '../utils/adapter-preflight';

type PreviewKind = 'sync' | 'transform' | 'rename-key' | 'translate';

interface RunPreviewOptions {
  kind: PreviewKind;
  args?: string[];
  workspaceFolder: vscode.WorkspaceFolder;
  label: string;
  progressTitle: string;
  cancellable?: boolean;
}

interface ApplyPreviewCommandOptions {
  command: string;
  progressTitle: string;
  successMessage: string;
  scannerTrigger: string;
  cliOptions?: CliRunOptions;
  failureMessage?: string;
  cancellable?: boolean;
  onAfterSuccess?: () => Promise<void> | void;
}

export abstract class PreviewApplyController {
  constructor(protected readonly services: ServiceContainer) {}

  protected async runPreview<TSummary>(
    options: RunPreviewOptions
  ): Promise<PreviewRunResult<TSummary>> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.progressTitle,
        cancellable: options.cancellable ?? false,
      },
      () =>
        this.services.previewManager.run<TSummary>({
          kind: options.kind,
          args: options.args,
          workspaceRoot: options.workspaceFolder.uri.fsPath,
          label: options.label,
        })
    );
  }

  protected async applyPreviewCommand(
    options: ApplyPreviewCommandOptions
  ): Promise<boolean> {
    // Run adapter preflight checks before mutating operations
    try {
      const missing = runAdapterPreflightCheck();
      if (missing.length) {
        const details = missing.map(m => `• ${m.adapter}: ${m.dependency}\n    Install: ${m.installHint}`).join('\n');
        const choice = await vscode.window.showWarningMessage(
          'i18nsmith: Missing framework adapter dependencies detected. Install required packages or scaffold the adapter before applying changes.',
          'Show details',
          'Install dependencies',
          'Scaffold adapter',
          'Cancel'
        );

        if (!choice || choice === 'Cancel') {
          return false;
        }

        if (choice === 'Show details') {
          // Print details to CLI output channel
          try {
            this.services.cliOutputChannel.show();
            this.services.cliOutputChannel.appendLine('Missing framework adapter dependencies:');
            for (const m of missing) {
              this.services.cliOutputChannel.appendLine(` - ${m.adapter}: ${m.dependency}`);
              this.services.cliOutputChannel.appendLine(`   Install: ${m.installHint}`);
            }
          } catch {
            // ignore
          }
          return false;
        }

        if (choice === 'Install dependencies') {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!workspaceRoot) return false;
          const unique = Array.from(new Set(missing.map((m) => m.installHint)));
          const terminal = vscode.window.createTerminal({ name: 'i18nsmith install', cwd: workspaceRoot });
          terminal.show();
          for (const cmd of unique) {
            terminal.sendText(cmd, true);
          }
          vscode.window.showInformationMessage('Installed dependencies in integrated terminal. Re-run the operation when complete.');
          return false;
        }

        if (choice === 'Scaffold adapter') {
          // Attempt to detect framework and propose scaffold command
          const wf = vscode.workspace.workspaceFolders?.[0];
          const info = wf ? await this.services.frameworkDetectionService.detectFramework(wf.uri.fsPath).catch(() => null) : null;
          const adapter = info?.adapter ?? 'react-i18next';
          await this.services.cliService.runCliCommand(`i18nsmith scaffold-adapter --type ${adapter} --install-deps`, { interactive: true, workspaceFolder: wf });
          return false;
        }
      }
    } catch (e) {
      // ignore preflight errors and proceed with caution
      this.services.logVerbose(`Adapter preflight check failed: ${(e as Error).message}`);
    }
    const cliOptions: CliRunOptions = {
      showOutput: false,
      ...options.cliOptions,
    };

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.progressTitle,
        cancellable: options.cancellable ?? false,
      },
      (progress) =>
        this.services.cliService.runCliCommand(options.command, {
          ...cliOptions,
          progress: cliOptions.progress ?? progress,
        })
    );

    if (!result?.success) {
      if (options.failureMessage) {
        vscode.window.showErrorMessage(options.failureMessage);
      }
      return false;
    }

    if (options.onAfterSuccess) {
      await options.onAfterSuccess();
    }

    this.services.hoverProvider.clearCache();
    await this.services.reportWatcher.refresh();
    this.services.smartScanner.scan(options.scannerTrigger);

    if (options.successMessage) {
      vscode.window.showInformationMessage(options.successMessage);
    }

    return true;
  }

  /**
   * Show an actionable error notification when the CLI reports missing adapter
   * dependencies. Parses the error text to extract package names and offers
   * "Install" and "Show Output" buttons.
   */
  protected async showMissingDependencyError(errorMsg: string, workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    // Extract dependency names from "- dep: install hint" lines
    const depLines = errorMsg.match(/- ([\w@/-]+):/g);
    const depNames = depLines
      ? depLines.map(line => line.replace(/^- /, '').replace(/:$/, ''))
      : [];

    const summary = depNames.length
      ? `Missing dependencies: ${depNames.join(', ')}`
      : 'Missing framework adapter dependencies detected.';

    const choice = await vscode.window.showErrorMessage(
      summary,
      'Install dependencies',
      'Show details'
    );

    if (choice === 'Install dependencies') {
      const root = workspaceFolder.uri.fsPath;
      const pm = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' :
                 fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
      const packages = depNames.length ? depNames.join(' ') : 'vue-eslint-parser';
      const cmd = pm === 'npm'
        ? `npm install --save-dev ${packages}`
        : `${pm} add -D ${packages}`;
      const terminal = vscode.window.createTerminal({ name: 'i18nsmith install', cwd: root });
      terminal.show();
      terminal.sendText(cmd, true);
      vscode.window.showInformationMessage(
        'Installing dependencies in the terminal. Re-run the command when complete.'
      );
    } else if (choice === 'Show details') {
      this.services.cliOutputChannel.show();
      this.services.cliOutputChannel.appendLine('--- Missing adapter dependencies ---');
      this.services.cliOutputChannel.appendLine(errorMsg);
    }
  }
}
