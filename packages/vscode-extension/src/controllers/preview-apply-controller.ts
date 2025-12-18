import * as vscode from 'vscode';
import { ServiceContainer } from '../services/container';
import type { PreviewRunResult } from '../preview-manager';
import type { CliRunOptions } from '../services/cli-service';

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
}
