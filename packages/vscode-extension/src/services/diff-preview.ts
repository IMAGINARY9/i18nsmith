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
    options: DiffPreviewOptions
  ): Promise<void> {
    if (!diffs || diffs.length === 0) {
      vscode.window.showInformationMessage('No changes to preview.');
      return;
    }

    let editor = vscode.window.activeTextEditor;
    if (!editor) {
      const doc = await vscode.workspace.openTextDocument({ content: '', language: 'plaintext' });
      editor = await vscode.window.showTextDocument(doc, { preview: true });
    }

    if (editor) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.diffPeekProvider.showDiffPeek(editor, diffs, options.title);
    }

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
    }
  }
}
