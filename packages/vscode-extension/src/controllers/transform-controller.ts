import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ServiceContainer } from '../services/container';
import { TransformSummary, TransformCandidate } from '@i18nsmith/transformer';
import { quoteCliArg } from '../command-helpers';
import { PreviewApplyController } from './preview-apply-controller';
import { checkAndPromptForVueParser } from '../utils/vue-parser-check';

const fsp = fs.promises;



export interface TransformRunOptions {
  targets?: string[];
  label?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
  extraArgs?: string[];
}

export class TransformController extends PreviewApplyController implements vscode.Disposable {
  constructor(services: ServiceContainer) {
    super(services);
  }

  dispose() {
    // No resources to dispose
  }

  public async runTransform(options: TransformRunOptions = {}) {
    const workspaceFolder = options.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    if (!await checkAndPromptForVueParser(workspaceFolder, options.targets)) {
      return;
    }

    const baseArgs = this.buildTransformTargetArgs(options.targets ?? []);
  // preserve any extra CLI flags parsed from a previewable command (e.g. target globs)
  const args = options.extraArgs && options.extraArgs.length ? [...baseArgs, ...options.extraArgs] : baseArgs;
    const label = options.label ?? (options.targets?.length === 1 ? options.targets[0] : 'workspace');

    this.services.logVerbose(`runTransform: Starting preview for ${label}`);

    const previewResult = await this.runPreview<TransformSummary>({
      kind: 'transform',
      args,
      workspaceFolder,
      label: `transform preview (${label})`,
      progressTitle: 'i18nsmith: Analyzing transform candidates…',
    });

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
      this.services.previewShown = true;
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

    const writeCommand = `i18nsmith transform --apply-preview ${quoteCliArg(previewPath)}`;

    await this.applyPreviewCommand({
      command: writeCommand,
      progressTitle: `i18nsmith: Applying transforms (${label})…`,
      successMessage: `Applied ${count} safe transform${count === 1 ? '' : 's'}. Rerun the transform command if more hardcoded strings remain.`,
      scannerTrigger: 'transform',
      failureMessage: 'Transform failed. Check the i18nsmith output channel.',
      cliOptions: {
        showOutput: false,
        suppressNotifications: true,
        skipReportRefresh: true,
      },
      onAfterSuccess: () => this.cleanupPreviewArtifacts(previewPath),
    });
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
