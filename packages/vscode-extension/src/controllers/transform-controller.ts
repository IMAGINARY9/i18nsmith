import * as vscode from 'vscode';
import * as fs from 'fs';
import { ServiceContainer } from '../services/container';
import { TransformSummary, TransformCandidate } from '@i18nsmith/transformer';
import { quoteCliArg } from '../command-helpers';

const fsp = fs.promises;

export interface TransformRunOptions {
  targets?: string[];
  label?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
}

export class TransformController implements vscode.Disposable {
  constructor(private readonly services: ServiceContainer) {}

  dispose() {
    // No resources to dispose
  }

  public async runTransform(options: TransformRunOptions = {}) {
    const workspaceFolder = options.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const manager = this.services.previewManager;
    const baseArgs = this.buildTransformTargetArgs(options.targets ?? []);
    const label = options.label ?? (options.targets?.length === 1 ? options.targets[0] : 'workspace');

    this.services.logVerbose(`runTransform: Starting preview for ${label}`);

    const previewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'i18nsmith: Analyzing transform candidates…',
        cancellable: false,
      },
      () =>
        manager.run<TransformSummary>({
          kind: 'transform',
          args: baseArgs,
          workspaceRoot: workspaceFolder.uri.fsPath,
          label: `transform preview (${label})`,
        })
    );

    const preview = previewResult.payload.summary;
    const transformable = preview.candidates.filter(
      (candidate: TransformCandidate) => candidate.status === 'pending' || candidate.status === 'existing'
    );

    this.services.logVerbose(`runTransform: Preview complete - ${transformable.length} transformable candidates`);
    this.services.logVerbose(`runTransform: Preview stored at ${previewResult.previewPath}`);
    
    if (!transformable.length) {
      this.handleNoCandidates(preview, options);
      return;
    }

    const multiPassTip = 'Tip: Transform runs are incremental. After applying, rerun the command to keep processing remaining candidates.';
    const detail = `${this.formatTransformPreview(preview)}\n\n${multiPassTip}`;
    
    const allDiffs = [
      ...(preview.diffs || []),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((preview as any).sourceDiffs || [])
    ];

    if (allDiffs.length > 0) {
      await this.services.diffPreviewService.showPreview(
        allDiffs,
        async () => {
          await this.applyTransform(baseArgs, label, transformable.length, previewResult.previewPath);
        },
        {
          title: `Transform Preview (${label})`,
          detail: `Transform ${transformable.length} candidate${transformable.length === 1 ? '' : 's'}. Apply changes?`,
        }
      );
      return;
    }

    const decision = await this.promptPreviewDecision({
      title: `Transform ${transformable.length} candidate${transformable.length === 1 ? '' : 's'} in ${label}?`,
      detail,
      previewAvailable: false,
      allowDryRun: true,
    });

    if (decision === 'cancel') {
      this.services.logVerbose('runTransform: User cancelled');
      return;
    }

    if (decision === 'dry-run') {
      this.services.logVerbose('runTransform: Dry run only, showing preview');
      vscode.window.showInformationMessage(`Preview only. Re-run the command and choose Apply to write changes.`, { detail });
      return;
    } else if (decision === 'apply') {
       await this.applyTransform(baseArgs, label, transformable.length, previewResult.previewPath);
    }
  }

  private async applyTransform(baseArgs: string[], label: string, count: number, previewPath: string) {
    this.services.logVerbose(`runTransform: Applying ${count} transformations via CLI`);

    // Use apply-preview instead of reconstructing the command
    // This ensures we apply exactly what was previewed
    const writeCommand = `i18nsmith transform --apply-preview ${quoteCliArg(previewPath)}`;
    
    const writeResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `i18nsmith: Applying transforms (${label})…`,
        cancellable: false,
      },
      (progress) =>
        this.services.cliService.runCliCommand(writeCommand, {
          progress,
          showOutput: false,
          suppressNotifications: true,
          skipReportRefresh: true,
        })
    );

    if (writeResult?.success) {
      await this.cleanupPreviewArtifacts(previewPath);
    }

    this.services.hoverProvider.clearCache();
    this.services.reportWatcher.refresh();
    this.services.smartScanner.scan('transform');

    vscode.window.showInformationMessage(
      `Applied ${count} safe transform${count === 1 ? '' : 's'}. Rerun the transform command if more hardcoded strings remain.`
    );
  }

  private handleNoCandidates(preview: TransformSummary, options: TransformRunOptions) {
    let message = options.targets?.length === 1
      ? 'No transformable strings found in the selected target.'
      : 'No transformable strings found.';
    if (preview.filesScanned === 0 && options.targets?.length === 1) {
      message += '\n\n⚠️ Target was not scanned. This might be because:';
      message += '\n• The file is not in your i18n.config.json "include" patterns';
      message += '\n• The file extension is not supported (.tsx, .jsx, .ts, .js)';
      message += `\n\nTarget: ${options.targets[0]}`;
      message += `\n\nTry adding the file pattern to your include array in i18n.config.json`;
    } else if (preview.skippedFiles.length > 0) {
      const skipped = preview.skippedFiles[0];
      message += `\n\nReason: ${skipped.reason}`;
    } else if (preview.candidates.length > 0) {
      message += '\n\nAll candidates were filtered out (already translated, duplicates, or too short).';
    }
    vscode.window.showWarningMessage(message);
  }

  private buildTransformTargetArgs(targets: string | string[]): string[] {
    const list = Array.isArray(targets) ? targets : [targets];
    const args: string[] = [];
    for (const target of list) {
      if (!target) {
        continue;
      }
      args.push('--target', quoteCliArg(target));
    }
    return args;
  }

  private buildTransformWriteCommand(baseArgs: string[]): string {
    const parts = ['i18nsmith transform', ...baseArgs, '--write', '--json'].filter(Boolean);
    return parts.join(' ');
  }

  private formatTransformPreview(summary: TransformSummary, limit = 5): string {
    const candidates = summary.candidates.filter(
      (c) => c.status === 'pending' || c.status === 'existing'
    );
    const count = candidates.length;
    if (!count) {
      return 'No transformable strings found.';
    }

    const lines: string[] = [];
    lines.push(`${count} string${count === 1 ? '' : 's'} will be replaced with t("key") calls.`);
    lines.push('');
    
    const sample = candidates.slice(0, limit);
    for (const c of sample) {
      const text = c.text.length > 40 ? c.text.slice(0, 37) + '...' : c.text;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      lines.push(`• "${text}" → t("${(c as any).key}")`);
    }

    if (count > limit) {
      lines.push(`...and ${count - limit} more.`);
    }

    return lines.join('\n');
  }

  private async promptPreviewDecision(options: {
    title: string;
    detail: string;
    previewAvailable: boolean;
    allowDryRun?: boolean;
    previewLabel?: string;
  }): Promise<'apply' | 'preview' | 'dry-run' | 'cancel'> {
    const items: vscode.QuickPickItem[] = [];
    
    if (options.previewAvailable) {
      items.push({
        label: `$(eye) ${options.previewLabel || 'Preview Changes'}`,
        description: 'Review diffs before applying',
        detail: 'Opens a side-by-side diff view',
      });
    }

    items.push({
      label: '$(check) Apply Changes',
      description: 'Write changes to disk immediately',
      detail: 'Updates source files and locale files',
    });

    if (options.allowDryRun) {
      items.push({
        label: '$(list-flat) Dry Run',
        description: 'Show what would happen without writing',
      });
    }

    const choice = await vscode.window.showQuickPick(items, {
      title: options.title,
      placeHolder: 'Select an action',
      ignoreFocusOut: true,
    });

    if (!choice) {
      return 'cancel';
    }

    if (choice.label.includes('Apply')) {
      return 'apply';
    }
    if (choice.label.includes('Preview')) {
      return 'preview';
    }
    if (choice.label.includes('Dry Run')) {
      return 'dry-run';
    }

    return 'cancel';
  }

  private async cleanupPreviewArtifacts(...paths: Array<string | null | undefined>): Promise<void> {
    for (const target of paths) {
      if (!target) {
        continue;
      }
      try {
        await fsp.unlink(target);
        this.services.logVerbose(`Removed preview artifact: ${target}`);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code && code !== 'ENOENT') {
          this.services.logVerbose(`Failed to remove preview artifact ${target}: ${(error as Error).message}`);
        }
      }
    }
  }

  
}
