import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ServiceContainer } from '../services/container';
import type { PreviewRunResult } from '../preview-manager';
import type { CliRunOptions } from '../services/cli-service';
import { runAdapterPreflightCheck, type MissingDep } from '../utils/adapter-preflight';

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
  private pendingRetry?: () => Promise<void>;

  constructor(protected readonly services: ServiceContainer) {}

  protected setRetryHandler(retry?: () => Promise<void>): void {
    this.pendingRetry = retry;
  }

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
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return false;
        const proceed = await this.handleMissingDependencies(missing, workspaceFolder, async () => {
          await this.applyPreviewCommand(options);
        });
        if (!proceed) {
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

  const retry = this.pendingRetry;
  this.pendingRetry = undefined;
  const installLabel = retry ? 'Install & Retry' : 'Install dependencies';
    const choice = await vscode.window.showErrorMessage(
      summary,
      installLabel,
      'Install only',
      'Show details'
    );

    if (choice === installLabel || choice === 'Install only') {
      const installCommands = this.buildInstallCommands(depNames, workspaceFolder);
      const success = await this.installDependencies(installCommands, workspaceFolder);
      if (success && choice === installLabel && retry) {
        await retry();
      }
      return;
    }

    if (choice === 'Show details') {
      this.services.cliOutputChannel.show();
      this.services.cliOutputChannel.appendLine('--- Missing adapter dependencies ---');
      this.services.cliOutputChannel.appendLine(errorMsg);
    }
  }

  protected async handleMissingDependencies(
    missing: MissingDep[],
    workspaceFolder: vscode.WorkspaceFolder,
    retry?: () => Promise<void>
  ): Promise<boolean> {
    const details = missing.map(m => `• ${m.adapter}: ${m.dependency}\n    Install: ${m.installHint}`).join('\n');
    const hasRetry = Boolean(retry);
    const choice = await vscode.window.showWarningMessage(
      'i18nsmith: Missing framework adapter dependencies detected. Install required packages or scaffold the adapter before proceeding.',
      ...(hasRetry ? ['Install & Retry'] : []),
      'Install only',
      'Show details',
      'Scaffold adapter',
      'Continue anyway',
      'Cancel'
    );

    if (!choice || choice === 'Cancel') {
      return false;
    }

    if (choice === 'Show details') {
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

    if (choice === 'Install & Retry' || choice === 'Install only') {
      const installCommands = Array.from(new Set(missing.map((m) => m.installHint)));
      const success = await this.installDependencies(installCommands, workspaceFolder);
      if (success && choice === 'Install & Retry' && retry) {
        await retry();
      }
      return false;
    }

    if (choice === 'Scaffold adapter') {
      const info = await this.services.frameworkDetectionService
        .detectFramework(workspaceFolder.uri.fsPath)
        .catch(() => null);
      const adapter = info?.adapter ?? 'react-i18next';
      await this.services.cliService.runCliCommand(
        `i18nsmith scaffold-adapter --type ${adapter} --install-deps`,
        { interactive: true, workspaceFolder }
      );
      return false;
    }

    return choice === 'Continue anyway';
  }

  protected buildInstallCommands(depNames: string[], workspaceFolder: vscode.WorkspaceFolder): string[] {
    const root = workspaceFolder.uri.fsPath;
    const pm = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' :
               fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
    const packages = depNames.length ? depNames.join(' ') : 'vue-eslint-parser';
    const cmd = pm === 'npm'
      ? `npm install --save-dev ${packages}`
      : `${pm} add -D ${packages}`;
    return [cmd];
  }

  protected async installDependencies(commands: string[], workspaceFolder: vscode.WorkspaceFolder): Promise<boolean> {
    const installedPackages: string[] = [];
    for (const cmd of commands) {
      const result = await this.services.cliService.runCliCommand(cmd, {
        workspaceFolder,
        showOutput: true,
        label: 'i18nsmith install',
      });
      if (!result?.success) {
        return false;
      }
      // Extract package names from the command (e.g., 'npm install --save-dev vue-eslint-parser' -> ['vue-eslint-parser'])
      const packages = this.extractPackageNamesFromCommand(cmd);
      installedPackages.push(...packages);
    }
    // Notify cache manager of installed packages
    this.services.dependencyCacheManager.notifyInstalled(installedPackages, workspaceFolder.uri.fsPath);
    return true;
  }

  private extractPackageNamesFromCommand(command: string): string[] {
    // Parse npm/pnpm/yarn install commands to extract package names
    const parts = command.split(/\s+/);
    const packages: string[] = [];
    let inInstall = false;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === 'npm' || part === 'pnpm' || part === 'yarn') {
        // Start of package manager command
        continue;
      }
      if (part === 'install' || part === 'add' || part === 'i') {
        inInstall = true;
        continue;
      }
      if (part.startsWith('-')) {
        // Skip flags
        if (part === '--save-dev' || part === '-D' || part === '--save' || part === '-S' || part === '--dev') {
          continue;
        }
        if (part.startsWith('--')) {
          i++; // skip next part if it's a --flag value
        }
        continue;
      }
      if (inInstall && part && !part.includes('=')) {
        packages.push(part);
      }
    }
    return packages;
  }
}
