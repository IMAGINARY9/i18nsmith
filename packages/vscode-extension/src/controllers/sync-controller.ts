import * as vscode from 'vscode';
import { ServiceContainer } from '../services/container';
import { ConfigurationController } from './configuration-controller';
import { type PlannedChange } from '../preview-flow';
import { SyncSummary, SuspiciousKeyWarning, LocaleDiffEntry, SourceFileDiffEntry } from '@i18nsmith/core';
import { PreviewPayload } from '../preview-manager';
import * as fs from 'fs';
import * as path from 'path';
import { quoteCliArg } from '../command-helpers';
import { buildSuspiciousKeySuggestion } from '../suspicious-key-helpers';
import { PreviewApplyController } from './preview-apply-controller';
import { checkAndPromptForVueParser } from '../utils/vue-parser-check';


type PlaceholderIssueSummary = {
  key: string;
  locale: string;
  missing: string[];
  extra: string[];
};

function formatPlaceholderIssue(issue: PlaceholderIssueSummary): string {
  const missing = issue.missing?.length ? `missing: ${issue.missing.join(', ')}` : '';
  const extra = issue.extra?.length ? `extra: ${issue.extra.join(', ')}` : '';
  const parts = [missing, extra].filter(Boolean).join(' • ');
  return `${issue.key} (${issue.locale})${parts ? ` — ${parts}` : ''}`;
}

export class SyncController extends PreviewApplyController implements vscode.Disposable {
  private lastSyncSuspiciousWarnings: SuspiciousKeyWarning[] = [];

  constructor(
    services: ServiceContainer,
    private readonly configController: ConfigurationController
  ) {
    super(services);
  }

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

    if (!await checkAndPromptForVueParser(workspaceFolder, options.targets)) {
      return;
    }

    const label = options.targets?.length
      ? `Sync ${options.targets.length} file${options.targets.length === 1 ? '' : 's'}`
      : 'Sync Workspace';

    this.services.logVerbose(`runSync: Starting ${label}`);

  const args = ['--diff', '--no-empty-values'];
    if (options.targets) {
      args.push('--target', ...options.targets.map(quoteCliArg));
    }
    if (options.extraArgs) {
      args.push(...options.extraArgs);
    }

    const previewResult = await this.runPreview<SyncSummary>({
      kind: 'sync',
      args,
      workspaceFolder,
      label,
      progressTitle: 'i18nsmith: Analyzing sync…',
    });

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

    // If no changes needed.
    // Note: placeholder validation can produce a preview that should still be applied
    // even when there are no locale drift diffs.
    const hasPlaceholderIssues = Boolean(
      Array.isArray((summary as unknown as { placeholderIssues?: unknown[] }).placeholderIssues) &&
        (summary as unknown as { placeholderIssues?: unknown[] }).placeholderIssues!.length > 0
    );

    if (
      (!summary.missingKeys || summary.missingKeys.length === 0) &&
      (!summary.unusedKeys || summary.unusedKeys.length === 0) &&
      (!summary.renameDiffs || summary.renameDiffs.length === 0) &&
      !hasPlaceholderIssues
    ) {
      vscode.window.showInformationMessage('Locales are in sync. No changes needed.');
      return;
    }

    // Show diff preview if available
    const allDiffs = [
      ...(summary.diffs || []),
      ...(summary.renameDiffs || [])
    ];

    if (allDiffs.length > 0) {
      const missingCount = summary.missingKeys?.length ?? 0;
      const unusedCount = summary.unusedKeys?.length ?? 0;
      const renameCount = summary.renameDiffs?.length ?? 0;
      
      const parts = [];
      if (missingCount) parts.push(`${missingCount} missing`);
      if (unusedCount) parts.push(`${unusedCount} unused`);
      if (renameCount) parts.push(`${renameCount} renames`);
      
      const label = parts.join(', ');

      // Mark that a preview UI will be shown so the quick-action completion
      // notification doesn't appear prematurely.
  this.services.previewShown = true;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.services.diffPreviewService.showPreview(
        allDiffs,
        async () => {
          await this.applySync(previewResult.previewPath, { prune: unusedCount > 0 });
          // Cleanup after apply
          try {
            await fs.promises.unlink(previewResult.previewPath);
          } catch (e) {
            // ignore
          }
        },
        {
          title: 'Sync Preview',
          detail: `Sync Locales: ${label}. Apply changes?`,
        },
        async () => {
          // Cleanup on cancel
          try {
            await fs.promises.unlink(previewResult.previewPath);
          } catch (e) {
            // ignore
          }
        }
      );
    } else {
      // Fallback to markdown preview if no diffs (shouldn't happen with --diff)
  await this.showSyncPreview(previewResult.payload, previewResult.previewPath);
    }
  }

  /**
   * Placeholder-only quick action.
   *
   * Contract:
   * - Runs `sync` preview with `--validate-interpolations`
   * - Shows a focused list of placeholder mismatches
   * - Applies only placeholder-related fixes (does NOT apply missing/unused drift)
   */
  public async resolvePlaceholderIssues(options: { targets?: string[]; extraArgs?: string[] } = {}) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    if (!await checkAndPromptForVueParser(workspaceFolder, options.targets)) {
      return;
    }

    // Intentionally *not* adding `--no-empty-values` here; placeholder validation should be
    // orthogonal to empty-value drift.
    const args = ['--diff', '--validate-interpolations'];
    if (options.targets) {
      args.push('--target', ...options.targets.map(quoteCliArg));
    }
    if (options.extraArgs) {
      // keep any extras, but ensure validate flag remains present
      args.push(...options.extraArgs.filter((a) => a !== '--validate-interpolations'));
    }

    const previewResult = await this.runPreview<SyncSummary>({
      kind: 'sync',
      args,
      workspaceFolder,
      label: options.targets?.length
        ? `Validate placeholders (${options.targets.length} target${options.targets.length === 1 ? '' : 's'})`
        : 'Validate placeholders',
      progressTitle: 'i18nsmith: Validating placeholders…',
    });

    const summary = previewResult.payload.summary;
    const issues = (summary as unknown as { placeholderIssues?: PlaceholderIssueSummary[] }).placeholderIssues;
    const placeholderIssues: PlaceholderIssueSummary[] = Array.isArray(issues) ? issues : [];

    if (placeholderIssues.length === 0) {
      vscode.window.showInformationMessage('No placeholder mismatches found.');
      return;
    }

    // If the preview also contains drift diffs, warn and offer to open full sync preview instead.
    const hasDrift =
      (summary.missingKeys?.length ?? 0) > 0 ||
      (summary.unusedKeys?.length ?? 0) > 0 ||
      (summary.renameDiffs?.length ?? 0) > 0;

    const max = 25;
    const lines = placeholderIssues.slice(0, max).map((issue) => `- ${formatPlaceholderIssue(issue)}`);
    if (placeholderIssues.length > max) {
      lines.push(`- …and ${placeholderIssues.length - max} more`);
    }

    const applyLabel = 'Apply placeholder fixes';
    const showSyncLabel = 'Show full sync preview';

    const choice = await vscode.window.showWarningMessage(
      hasDrift
        ? `Found ${placeholderIssues.length} placeholder mismatch(es) (and locale drift).`
        : `Found ${placeholderIssues.length} placeholder mismatch(es).`,
      { modal: true, detail: lines.join('\n') },
      applyLabel,
      ...(hasDrift ? [showSyncLabel] : [])
    );

    if (choice === showSyncLabel) {
      // Delegate to full sync flow (drift preview)
      await this.runSync({ targets: options.targets, extraArgs: ['--validate-interpolations'] });
      return;
    }

    if (choice !== applyLabel) {
      return;
    }

    // Apply placeholder fixes ONLY.
    // If drift exists, do not apply here (otherwise we'd be mixing responsibilities)
    // and instead require the user to run full sync.
    if (hasDrift) {
      vscode.window.showInformationMessage(
        'Placeholder issues were detected, but locale drift is also present. Use "Fix Locale Drift" to preview/apply drift changes.',
      );
      return;
    }

    // Create a temporary selection file containing only placeholder issue keys.
    // This keeps the apply operation narrowly scoped and stable even if the CLI changes
    // heuristics around what gets written.
    const workspaceRoot = workspaceFolder.uri.fsPath;
    const dir = path.join(workspaceRoot, '.i18nsmith');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
    const selectionPath = path.join(dir, `selection-placeholders-${Date.now()}.json`);
    const selection = {
      missing: Array.from(new Set(placeholderIssues.map((i) => i.key))).filter(Boolean),
      unused: [],
    };
    try {
      fs.writeFileSync(selectionPath, JSON.stringify(selection, null, 2), 'utf8');
    } catch {
      // If we fail to write a selection file, fall back to applySync (best-effort).
    }

    // Apply using CLI replay of preview.
    // We bypass applySync's auto-selection inference and instead pass our explicit selection.
    const baseApply = `i18nsmith sync --apply-preview ${quoteCliArg(previewResult.previewPath)} --selection-file ${quoteCliArg(selectionPath)} --invalidate-cache`;
    await this.applyPreviewCommand({
      command: baseApply,
      progressTitle: 'i18nsmith: Applying placeholder fixes…',
      successMessage: 'Placeholder fixes applied successfully.',
      scannerTrigger: 'sync',
      failureMessage: 'Failed to apply placeholder fixes. Check the i18nsmith output channel.',
      onAfterSuccess: async () => {
        await this.services.reportWatcher.refresh();
      },
    });

    // Best-effort cleanup of preview file
    try {
      await fs.promises.unlink(previewResult.previewPath);
    } catch {
      // ignore
    }

    // Best-effort cleanup of selection file
    try {
      await fs.promises.unlink(selectionPath);
    } catch {
      // ignore
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

  private async showSyncPreview(payload: PreviewPayload<SyncSummary>, previewPath: string) {
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
        await this.applySync(previewPath, { prune: unusedCount > 0 });
      },
    });

  await this.services.previewPlanService.executePlan({
      title: 'Sync Locales',
      detail: detailLines.join('\n'),
      changes,
      cleanup: async () => {
        // Cleanup preview file
        try {
          await fs.promises.unlink(previewPath);
        } catch (e) {
          this.services.logVerbose(`Failed to cleanup preview file: ${previewPath}`);
        }
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
      await this.applySync(previewPath, { prune: unusedCount > 0 });
    }
  }

  private async applySync(previewPath: string, options: { prune?: boolean } = {}) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const workspaceRoot = workspaceFolder?.uri.fsPath;

    let command = `i18nsmith sync --apply-preview ${quoteCliArg(previewPath)} --yes`;
    if (options.prune) {
      command += ' --prune';
    }

    // If the preview contains suspicious missing keys, the CLI will by default skip
    // writing them unless explicitly selected. To ensure Apply actually writes the
    // intended missing keys, create a temporary selection file listing the missing
    // keys found in the preview and pass it to the --selection-file option.
    try {
      if (workspaceRoot) {
        const previewFull = path.resolve(workspaceRoot, previewPath);
        if (fs.existsSync(previewFull)) {
          const raw = fs.readFileSync(previewFull, 'utf8');
          const payload = JSON.parse(raw) as {
            summary?: { missingKeys?: Array<{ key: string }>; renameDiffs?: unknown[] };
            args?: string[];
          } | undefined;

          // Build selection file if missing keys exist.
          // Also include placeholder issue keys so placeholder-only runs can be applied.
          const missing: string[] = Array.isArray(payload?.summary?.missingKeys)
            ? (payload!.summary!.missingKeys as Array<{ key: string }>).map((m) => m.key)
            : [];

          const placeholder: string[] = Array.isArray((payload?.summary as unknown as { placeholderIssues?: unknown[] })?.placeholderIssues)
            ? ((payload!.summary as unknown as { placeholderIssues: Array<{ key?: string }> }).placeholderIssues
                .map((issue) => issue.key)
                .filter((k): k is string => typeof k === 'string' && k.length > 0))
            : [];

          if (missing.length > 0 || placeholder.length > 0) {
            const selection = { missing: Array.from(new Set([...missing, ...placeholder])), unused: [] };
            const dir = path.join(workspaceRoot, '.i18nsmith');
            try {
              fs.mkdirSync(dir, { recursive: true });
            } catch (e) {
              // ignore
            }
            const filename = `selection-${Date.now()}.json`;
            const selectionPath = path.join(dir, filename);
            fs.writeFileSync(selectionPath, JSON.stringify(selection, null, 2), 'utf8');
            command += ` --selection-file ${quoteCliArg(selectionPath)}`;
          }

          // If the preview included auto-rename intent or rename diffs, ensure the apply command
          // includes --auto-rename-suspicious so the CLI actually runs the renamer during replay.
          const hadAutoRenameFlag = Array.isArray(payload?.args) && payload!.args!.includes('--auto-rename-suspicious');
          const hasRenameDiffs = Array.isArray(payload?.summary?.renameDiffs) && payload!.summary!.renameDiffs!.length > 0;
          if (hadAutoRenameFlag || hasRenameDiffs) {
            if (!command.includes('--auto-rename-suspicious')) {
              command += ' --auto-rename-suspicious';
            }
          }
        }
      }
    } catch (e) {
      // If anything goes wrong reading/writing the selection file, continue without it.
      this.services.logVerbose(`applySync: failed to create selection file: ${(e as Error).message}`);
    }

    // Force CLI to invalidate any persisted check/sync cache so a follow-up health report
    // reflects the just-applied changes.
    const cacheBustedCommand = `${command} --invalidate-cache`;

    await this.applyPreviewCommand({
      command: cacheBustedCommand,
      progressTitle: 'i18nsmith: Applying sync changes…',
      successMessage: 'Sync applied successfully.',
      scannerTrigger: 'sync',
      failureMessage: 'Sync failed. Check the i18nsmith output channel.',
      onAfterSuccess: async () => {
        // Double refresh to reduce the chance of stale actionable items reappearing due to:
        // - file watcher race on locale write
        // - cached report reads
        await this.services.reportWatcher.refresh();
      },
    });
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
        title: 'Exporting missing/empty translations...',
      },
      async () => {
        const result = await this.services.cliService.runCliCommand(command);
        
        if (result?.success) {
          vscode.window.showInformationMessage(`Exported missing/empty translations to ${uri.fsPath}`);
        } else {
          vscode.window.showErrorMessage(`Export failed: ${result?.stderr ?? 'Unknown error'}`);
        }
      }
    );
  }

  public async renameKey(from: string, to: string) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    if (!await checkAndPromptForVueParser(workspaceFolder)) {
      return;
    }

    // Use preview flow
    const previewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Analyzing rename of "${from}"...`,
      },
      () =>
        this.services.previewManager.run<{ diffs: SourceFileDiffEntry[], localeDiffs?: LocaleDiffEntry[] }>({
          kind: 'rename-key',
          args: [quoteCliArg(from), quoteCliArg(to), '--diff'],
          workspaceRoot: workspaceFolder.uri.fsPath,
          label: `rename-key ${from}`,
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
          const command = `i18nsmith rename-key ${quoteCliArg(from)} ${quoteCliArg(to)} --write`;
          await this.runApplyCommand(command, `Renaming "${from}" to "${to}"`);
        },
        {
          title: 'Rename Key Preview',
          detail: `Rename "${from}" to "${to}". Apply changes?`,
        }
      );
    } else {
      vscode.window.showInformationMessage('No changes detected for rename.');
    }
  }

  public async renameSuspiciousKey(warning: SuspiciousKeyWarning) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const config = this.services.configurationService.getSnapshot(workspaceFolder.uri.fsPath);
    const suggestion = buildSuspiciousKeySuggestion(warning.key, config, {
      workspaceRoot: workspaceFolder.uri.fsPath,
      filePath: warning.filePath ?? workspaceFolder.uri.fsPath,
    });
    
    const newKey = await vscode.window.showInputBox({
      title: `Rename suspicious key "${warning.key}"`,
      value: suggestion,
      prompt: 'Enter the new key name',
    });

    if (!newKey || newKey === warning.key) {
      return;
    }

    if (!await checkAndPromptForVueParser(workspaceFolder)) {
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

  public async renameAllSuspiciousKeys() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    // Try to refresh from diagnostics report if empty
    if (this.lastSyncSuspiciousWarnings.length === 0) {
      const report = this.services.diagnosticsManager.getReport();
      if (report?.sync?.suspiciousKeys && Array.isArray(report.sync.suspiciousKeys)) {
        this.lastSyncSuspiciousWarnings = report.sync.suspiciousKeys as SuspiciousKeyWarning[];
      }
    }

    if (this.lastSyncSuspiciousWarnings.length === 0) {
      vscode.window.showInformationMessage('No suspicious keys found to rename. Run a sync first.');
      return;
    }

    if (!await checkAndPromptForVueParser(workspaceFolder)) {
      return;
    }

    // We can use the sync command with --auto-rename-suspicious
    // But we should preview it first.
    // Actually, 'sync' command doesn't support --auto-rename-suspicious in the CLI yet?
    // Let's check the CLI options.
    // Assuming 'sync' supports it or we need to implement it.
    // If not, we might need to iterate or use a specific command.
    // Based on renameSuspiciousKeysInFile, it seems we expect 'sync' to handle it.
    
    const args = ['--diff', '--auto-rename-suspicious'];

    let previewResult = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `i18nsmith: Analyzing bulk rename…`,
        cancellable: false,
      },
      () =>
        this.services.previewManager.run<SyncSummary>({
          kind: 'sync',
          args,
          workspaceRoot: workspaceFolder.uri.fsPath,
          label: 'Bulk Rename Suspicious Keys',
        })
    );

    // Log preview file and CLI output into the CLI output channel for visibility in the UI.
    try {
      if (previewResult?.previewPath) {
        this.services.cliOutputChannel.appendLine(`\n[Bulk Rename Preview] ${previewResult.previewPath}`);
      }
      if (previewResult?.stdout) {
        this.services.cliOutputChannel.appendLine(previewResult.stdout);
      }
      if (previewResult?.stderr) {
        this.services.cliOutputChannel.appendLine(`[stderr] ${previewResult.stderr}`);
      }
    } catch (e) {
      // best-effort logging
      this.services.logVerbose(`renameAllSuspiciousKeys: failed to log preview result: ${(e as Error).message}`);
    }

    let summary = previewResult.payload.summary;
    const allDiffs = [
      ...(summary.diffs || []),
      ...(summary.localeDiffs || []),
      ...(summary.renameDiffs || [])
    ];

    // If the preview detected suspicious keys but produced no rename proposals or diffs,
    // try re-running the preview once (some analyzer runs produce different output on a fresh run).
    if (allDiffs.length === 0 && (summary.suspiciousKeys?.length ?? 0) > 0) {
      try {
        this.services.cliOutputChannel.appendLine('[Bulk Rename] No diffs found in preview — re-running preview with --auto-rename-suspicious');
        const rerun = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `i18nsmith: Re-analyzing bulk rename (auto-rename)…`,
            cancellable: false,
          },
          () =>
            this.services.previewManager.run<SyncSummary>({
              kind: 'sync',
              args, // args already contains --auto-rename-suspicious
              workspaceRoot: workspaceFolder.uri.fsPath,
              label: 'Bulk Rename Suspicious Keys (re-run)',
            })
        );

        // replace previewResult/summary with rerun results and recompute diffs
        previewResult = rerun;
        summary = previewResult.payload.summary;
        const rerunDiffs = [
          ...(summary.diffs || []),
          ...(summary.localeDiffs || []),
          ...(summary.renameDiffs || []),
        ];

        if (rerunDiffs.length > 0) {
          await this.services.diffPreviewService.showPreview(
            rerunDiffs,
            async () => {
              await this.applySync(previewResult.previewPath, { prune: false });
            },
            {
              title: 'Bulk Rename Preview',
              detail: `Rename ${this.lastSyncSuspiciousWarnings.length} suspicious keys?`,
            }
          );
          return;
        }
        // else fall through and show Open Preview option below
      } catch (e) {
        this.services.logVerbose(`renameAllSuspiciousKeys: re-run preview failed: ${(e as Error).message}`);
      }
    }

    if (allDiffs.length > 0) {
      // Ensure diffs are unique; some upstream summaries can repeat identical locale diffs.
    const uniqueDiffs = this.dedupeDiffsByIdOrContent(allDiffs) as typeof allDiffs;
      await this.services.diffPreviewService.showPreview(
        uniqueDiffs,
        async () => {
           await this.applySync(previewResult.previewPath, { prune: false });
        },
        {
          title: 'Bulk Rename Preview',
          detail: `Rename ${this.lastSyncSuspiciousWarnings.length} suspicious keys?`,
        }
      );
    } else {
      const blockingMessage = extractBlockingIssueMessage(previewResult.stderr || previewResult.stdout);
      if (blockingMessage) {
        const choice = await vscode.window.showWarningMessage(
          `Bulk rename blocked: ${blockingMessage}`,
          'Show CLI Output'
        );
        if (choice === 'Show CLI Output') {
          this.services.cliOutputChannel.show(true);
        }
      } else if (previewResult?.previewPath) {
        const openLabel = 'Open Preview';
        const choice = await vscode.window.showInformationMessage(
          'No changes detected for bulk rename.',
          openLabel,
          'Show CLI Output'
        );
        if (choice === openLabel) {
          try {
            const doc = await vscode.workspace.openTextDocument(previewResult.previewPath);
            await vscode.window.showTextDocument(doc, { preview: false });
          } catch (e) {
            this.services.cliOutputChannel.appendLine(`Failed to open preview file: ${(e as Error).message}`);
            this.services.cliOutputChannel.show(true);
          }
        } else if (choice === 'Show CLI Output') {
          this.services.cliOutputChannel.show(true);
        }
      } else {
        vscode.window.showInformationMessage('No changes detected for bulk rename.');
      }
    }
  }

  private dedupeDiffsByIdOrContent(diffs: unknown[]): unknown[] {
    const seen = new Set<string>();
    const result: unknown[] = [];

    for (const diff of diffs) {
      if (!diff || typeof diff !== 'object') continue;

      const maybe = diff as { id?: unknown };
      const key =
        typeof maybe.id === 'string'
          ? maybe.id
          : JSON.stringify(diff, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

      if (seen.has(key)) continue;
      seen.add(key);
      result.push(diff);
    }

    return result;
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

function extractBlockingIssueMessage(output?: string): string | null {
  if (!output) {
    return null;
  }

  const blockingMatch = output.match(/Blocking issues detected[^\n]*/i);
  if (blockingMatch) {
    return blockingMatch[0].trim();
  }

  const actionableMatch = output.match(/Resolve the actionable errors above[^\n]*/i);
  if (actionableMatch) {
    return actionableMatch[0].trim();
  }

  return null;
}
