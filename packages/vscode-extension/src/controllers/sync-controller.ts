import * as vscode from 'vscode';
import { ServiceContainer } from '../services/container';
import { ConfigurationController } from './configuration-controller';
import { executePreviewPlan, type PlannedChange } from '../preview-flow';
import { SyncSummary, SuspiciousKeyWarning } from '@i18nsmith/core';
import { PreviewPayload } from '../preview-manager';
import { resolveCliCommand } from '../cli-utils';
import { runResolvedCliCommand } from '../cli-runner';

export class SyncController implements vscode.Disposable {
  private lastSyncSuspiciousWarnings: SuspiciousKeyWarning[] = [];

  constructor(
    private readonly services: ServiceContainer,
    private readonly configController: ConfigurationController
  ) {}

  dispose() {
    // No resources to dispose
  }

  public getLastSyncSuspiciousWarnings(): SuspiciousKeyWarning[] {
    return this.lastSyncSuspiciousWarnings;
  }

  public async runSync(options: { targets?: string[]; dryRunOnly?: boolean } = {}) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const label = options.targets?.length
      ? `Sync ${options.targets.length} file${options.targets.length === 1 ? '' : 's'}`
      : 'Sync Workspace';

    this.services.logVerbose(`runSync: Starting ${label}`);

    const previewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `i18nsmith: Analyzing sync…`,
        cancellable: false,
      },
      () =>
        this.services.previewManager.run<SyncSummary>({
          kind: 'sync',
          args: options.targets ? ['--targets', ...options.targets] : [],
          workspaceRoot: workspaceFolder.uri.fsPath,
          label,
        })
    );

    const summary = previewResult.payload.summary;
    
    // Update dynamic warnings for whitelist controller
    if (summary.dynamicKeyWarnings) {
      this.configController.setLastSyncDynamicWarnings(summary.dynamicKeyWarnings);
    }

    // Update suspicious warnings
    if (summary.suspiciousKeys) {
      this.lastSyncSuspiciousWarnings = summary.suspiciousKeys;
    }

    if (options.dryRunOnly) {
      this.services.logVerbose('runSync: Dry run complete');
      return;
    }

    // If no changes needed
    if (
      (!summary.missingKeys || summary.missingKeys.length === 0) &&
      (!summary.unusedKeys || summary.unusedKeys.length === 0)
    ) {
      vscode.window.showInformationMessage('Locales are in sync. No changes needed.');
      return;
    }

    // Show preview plan
    await this.showSyncPreview(previewResult.payload, previewResult.previewPath, workspaceFolder.uri.fsPath);
  }

  public async syncCurrentFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a file to run a focused sync.');
      return;
    }

    this.services.logVerbose(`syncCurrentFile: Starting sync for ${editor.document.uri.fsPath}`);
    await this.runSync({ targets: [editor.document.uri.fsPath] });
  }

  private async showSyncPreview(
    payload: PreviewPayload<SyncSummary>,
    previewPath: string,
    workspaceRoot: string
  ) {
    const summary = payload.summary;
    const missingCount = summary.missingKeys?.length ?? 0;
    const unusedCount = summary.unusedKeys?.length ?? 0;

    const changes: PlannedChange[] = [];
    
    // We don't have granular file diffs from the CLI sync preview yet in the same way as transform
    // But we can show a summary and offer to apply
    
    const detailLines = [
      `Missing keys: ${missingCount}`,
      `Unused keys: ${unusedCount}`,
      '',
      'This will update locale files to match source code usage.',
    ];

    // Create a "virtual" change that represents the sync application
    // In a real implementation of Phase 2, we would parse the diffs from the preview payload
    changes.push({
      label: 'Apply Sync Changes',
      beforeUri: vscode.Uri.parse('i18nsmith-preview:sync-before'), // Placeholder
      afterUri: vscode.Uri.parse('i18nsmith-preview:sync-after'),   // Placeholder
      summary: `${missingCount} missing, ${unusedCount} unused`,
      apply: async () => {
        await this.applySync(previewPath, workspaceRoot);
      },
    });

    await executePreviewPlan({
      title: 'Sync Locales',
      detail: detailLines.join('\n'),
      changes,
      cleanup: async () => {
        // Cleanup preview file
        // In real impl we'd delete previewPath
      },
    });
  }

  private async applySync(previewPath: string, workspaceRoot: string) {
    // For now, we re-run with --apply-preview or just --write if CLI doesn't support it yet
    // The plan says "Extension runs cmd --write" for V1 if apply-preview isn't ready
    
    const command = 'i18nsmith sync --write'; // Simplified for V1
    
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'i18nsmith: Applying sync changes…',
        cancellable: false,
      },
      async () => {
        const resolved = resolveCliCommand(command);
        await runResolvedCliCommand(resolved, { cwd: workspaceRoot });
        
        this.services.hoverProvider.clearCache();
        this.services.reportWatcher.refresh();
        this.services.smartScanner.scan('sync');
        
        vscode.window.showInformationMessage('Sync applied successfully.');
      }
    );
  }
}
