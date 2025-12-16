import * as vscode from 'vscode';
import { ServiceContainer } from '../services/container';
import { ConfigurationController } from './configuration-controller';
import { executePreviewPlan, type PlannedChange } from '../preview-flow';
import { SyncSummary, SuspiciousKeyWarning, LocaleDiffEntry, SourceFileDiffEntry } from '@i18nsmith/core';
import { PreviewPayload } from '../preview-manager';
import { resolveCliCommand } from '../cli-utils';
import { runResolvedCliCommand } from '../cli-runner';
import { quoteCliArg } from '../command-helpers';
import { buildSuspiciousKeySuggestion } from '../suspicious-key-helpers';

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

  public async runSync(options: { targets?: string[]; dryRunOnly?: boolean; extraArgs?: string[] } = {}) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const label = options.targets?.length
      ? `Sync ${options.targets.length} file${options.targets.length === 1 ? '' : 's'}`
      : 'Sync Workspace';

    this.services.logVerbose(`runSync: Starting ${label}`);

    const args = ['--diff'];
    if (options.targets) {
      args.push('--target', ...options.targets);
    }
    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    const previewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `i18nsmith: Analyzing sync…`,
        cancellable: false,
      },
      () =>
        this.services.previewManager.run<SyncSummary>({
          kind: 'sync',
          args,
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

    // Show diff preview if available
    if (summary.diffs && summary.diffs.length > 0) {
      const missingCount = summary.missingKeys?.length ?? 0;
      const unusedCount = summary.unusedKeys?.length ?? 0;
      const label = `${missingCount} missing, ${unusedCount} unused`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.services.diffPreviewService.showPreview(
        summary.diffs,
        async () => {
          await this.applySync(previewResult.previewPath, workspaceFolder.uri.fsPath);
        },
        {
          title: 'Sync Preview',
          detail: `Sync Locales: ${label}. Apply changes?`,
        }
      );
    } else {
      // Fallback to markdown preview if no diffs (shouldn't happen with --diff)
      await this.showSyncPreview(previewResult.payload, previewResult.previewPath, workspaceFolder.uri.fsPath);
    }
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

    if (missingCount > 0) {
      detailLines.push('', '## Missing Keys');
      const limit = 10;
      for (const k of summary.missingKeys.slice(0, limit)) {
        detailLines.push(`- ${k.key}`);
      }
      if (missingCount > limit) {
        detailLines.push(`...and ${missingCount - limit} more`);
      }
    }

    if (unusedCount > 0) {
      detailLines.push('', '## Unused Keys');
      const limit = 10;
      for (const k of summary.unusedKeys.slice(0, limit)) {
        detailLines.push(`- ${k.key}`);
      }
      if (unusedCount > limit) {
        detailLines.push(`...and ${unusedCount - limit} more`);
      }
    }

    // Create a "virtual" change that represents the sync application
    // In a real implementation of Phase 2, we would parse the diffs from the preview payload
    changes.push({
      label: 'Apply Sync Changes',
      beforeUri: vscode.Uri.parse('i18nsmith-preview:sync-before'), // Placeholder
      afterUri: vscode.Uri.parse('i18nsmith-preview:sync-after'),   // Placeholder
      summary: `${missingCount} missing, ${unusedCount} unused`,
      apply: async () => {
        // Close the preview editor first to avoid confusion
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
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

    // Also show a persistent notification with an Apply button, as a backup to the markdown link
    const applyLabel = 'Apply Changes';
    const choice = await vscode.window.showInformationMessage(
      `Sync Locales: ${missingCount} missing, ${unusedCount} unused keys.`,
      applyLabel,
      'Cancel'
    );

    if (choice === applyLabel) {
      // Close the preview editor first to avoid confusion
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await this.applySync(previewPath, workspaceRoot);
    }
  }

  private async applySync(previewPath: string, workspaceRoot: string) {
    const command = `i18nsmith sync --apply-preview ${quoteCliArg(previewPath)}`;
    
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'i18nsmith: Applying sync changes…',
        cancellable: false,
      },
      async () => {
        const resolved = resolveCliCommand(command);
        const result = await runResolvedCliCommand(resolved, { cwd: workspaceRoot });
        
        if (result.code !== 0) {
          vscode.window.showErrorMessage(`Sync failed: ${result.stderr || result.stdout}`);
          return;
        }

        this.services.hoverProvider.clearCache();
        this.services.reportWatcher.refresh();
        this.services.smartScanner.scan('sync');
        
        vscode.window.showInformationMessage('Sync applied successfully.');
      }
    );
  }

  public async exportMissingTranslations() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(workspaceFolder.uri, 'missing-translations.csv'),
      filters: { 'CSV Files': ['csv'] },
      saveLabel: 'Export',
      title: 'Export Missing Translations',
    });

    if (!uri) {
      return;
    }

    const command = `i18nsmith translate --export ${quoteCliArg(uri.fsPath)}`;
    
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Exporting missing translations...',
      },
      async () => {
        const result = await this.services.cliService.runCliCommand(command);
        
        if (result?.success) {
          vscode.window.showInformationMessage(`Exported missing translations to ${uri.fsPath}`);
        } else {
          vscode.window.showErrorMessage(`Export failed: ${result?.stderr ?? 'Unknown error'}`);
        }
      }
    );
  }

  public async renameSuspiciousKey(warning: SuspiciousKeyWarning) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const suggestion = buildSuspiciousKeySuggestion(warning.key, workspaceFolder.uri.fsPath, warning.filePath);
    
    const newKey = await vscode.window.showInputBox({
      title: `Rename suspicious key "${warning.key}"`,
      value: suggestion,
      prompt: 'Enter the new key name',
    });

    if (!newKey || newKey === warning.key) {
      return;
    }

    // Use preview flow
    const previewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Analyzing rename of "${warning.key}"...`,
      },
      () =>
        this.services.previewManager.run<{ diffs: SourceFileDiffEntry[], localeDiffs?: LocaleDiffEntry[] }>({
          kind: 'rename-key',
          args: [quoteCliArg(warning.key), quoteCliArg(newKey), '--diff'],
          workspaceRoot: workspaceFolder.uri.fsPath,
          label: `rename-key ${warning.key}`,
        })
    );

    const summary = previewResult.payload.summary;
    const allDiffs = [
      ...(summary.diffs || []),
      ...(summary.localeDiffs || [])
    ];

    if (allDiffs.length > 0) {
      await this.services.diffPreviewService.showPreview(
        allDiffs,
        async () => {
          const command = `i18nsmith rename-key ${quoteCliArg(warning.key)} ${quoteCliArg(newKey)} --write`;
          await this.runApplyCommand(command, `Renaming "${warning.key}" to "${newKey}"`);
        },
        {
          title: 'Rename Key Preview',
          detail: `Rename "${warning.key}" to "${newKey}". Apply changes?`,
        }
      );
    } else {
      vscode.window.showInformationMessage('No changes detected for rename.');
    }
  }

  public async renameSuspiciousKeysInFile(target?: vscode.Uri) {
    const targetFile = target?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!targetFile) {
      vscode.window.showErrorMessage('No file selected for renaming suspicious keys.');
      return;
    }

    // Reuse runSync with auto-rename flag
    await this.runSync({
      targets: [targetFile],
      extraArgs: ['--auto-rename-suspicious'],
    });
  }

  private async runApplyCommand(command: string, title: string) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${title}...`,
      },
      async () => {
        const result = await this.services.cliService.runCliCommand(command);
        
        if (result?.success) {
          vscode.window.showInformationMessage(`${title} completed.`);
          this.services.reportWatcher.refresh();
        } else {
          vscode.window.showErrorMessage(`Operation failed: ${result?.stderr ?? 'Unknown error'}`);
        }
      }
    );
  }
}
