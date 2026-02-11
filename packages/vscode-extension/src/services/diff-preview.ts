import * as vscode from 'vscode';
import { DiffPeekProvider, DiffEntry } from '../diff-peek';

export interface DiffPreviewOptions {
  title: string;
  detail?: string;
  applyLabel?: string;
  cancelLabel?: string;
}

export class DiffPreviewService {
  constructor(private readonly diffPeekProvider: DiffPeekProvider) {}

  async showPreview(
    diffs: DiffEntry[],
    onApply: () => Promise<void>,
    options: DiffPreviewOptions,
    onCancel?: () => Promise<void>
  ): Promise<void> {
    if (!diffs || diffs.length === 0) {
      vscode.window.showInformationMessage('No changes to preview.');
      if (onCancel) {
        await onCancel();
      }
      return;
    }

    // Show diffs. DiffPeekProvider handles the actual preview document
    // placement. When there is no active editor, we intentionally avoid
    // creating a blank editor on the left — let the provider open the
    // preview in the primary editor column so the user sees only the
    // preview instead of an empty split.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await this.diffPeekProvider.showDiffPeek(vscode.window.activeTextEditor as any, diffs, options.title);

    const applyLabel = options.applyLabel || 'Apply Changes';
    const cancelLabel = options.cancelLabel || 'Cancel';
    
    const choice = await vscode.window.showInformationMessage(
      options.detail || `${options.title}. Apply changes?`,
      { modal: false },
      applyLabel,
      cancelLabel
    );

    if (choice === applyLabel) {
      // Close the preview editor first to avoid confusion
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await onApply();
    } else {
      if (onCancel) {
        await onCancel();
      }
    }
  }
}
