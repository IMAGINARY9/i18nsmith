import * as vscode from 'vscode';
import { LocaleDiffEntry, SourceFileDiffEntry } from '@i18nsmith/core';

export { LocaleDiffEntry, SourceFileDiffEntry };

export type DiffEntry = LocaleDiffEntry | SourceFileDiffEntry;

function isLocaleDiff(diff: DiffEntry): diff is LocaleDiffEntry {
  return 'locale' in diff;
}

/**
 * Shows locale diffs in a peek view (inline preview)
 */
export class DiffPeekProvider {
  /**
   * Show a peek view with locale diffs
   * @param editor The editor to show the peek view in
   * @param diffs Array of locale diff entries
   * @param title Title for the peek view
   */
  async showDiffPeek(
    editor: vscode.TextEditor,
    diffs: DiffEntry[],
    title: string = 'Changes Preview'
  ): Promise<void> {
    if (!diffs.length) {
      vscode.window.showInformationMessage('No changes to preview');
      return;
    }

    // Create a virtual document with the diff content
    const content = this.formatDiffsForPeek(diffs, title);
    const timestamp = Date.now();
    const uri = vscode.Uri.parse(`i18nsmith-diff:${title.replace(/\s/g, '-')}-${timestamp}.diff`);
    
    // Register a text document content provider for our custom scheme
    const provider = new DiffContentProvider(content);
    // We use a unique scheme or handle the provider registration globally?
    // Registering repeatedly for the same scheme 'i18nsmith-diff' is problematic if we don't dispose correctly.
    // But here we dispose after 60s.
    // If we use the same scheme, the *latest* registration wins.
    // But VS Code might cache the *content* for a URI.
    // By adding timestamp to URI, we bypass content caching.
    
    const registration = vscode.workspace.registerTextDocumentContentProvider('i18nsmith-diff', provider);

    try {
      // Open the document in a peek/preview
      const doc = await vscode.workspace.openTextDocument(uri);
      
      // Show in a new editor column to the side
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
        preserveFocus: false,
      });
    } finally {
      // Clean up after a delay
      setTimeout(() => registration.dispose(), 60000); // 1 minute
    }
  }

  /**
   * Format diffs into a readable text format
   */
  private formatDiffsForPeek(diffs: DiffEntry[], title: string): string {
    const lines: string[] = [];
    
    lines.push(`# ${title}`);
    lines.push('');
    
    // Summary
    const localeDiffs = diffs.filter(isLocaleDiff);
    const sourceDiffs = diffs.filter(d => !isLocaleDiff(d));

    const totalAdded = localeDiffs.reduce((sum, d) => sum + d.added.length, 0);
    const totalUpdated = localeDiffs.reduce((sum, d) => sum + d.updated.length, 0);
    const totalRemoved = localeDiffs.reduce((sum, d) => sum + d.removed.length, 0);
    const totalSourceChanges = sourceDiffs.length;
    
    const summary: string[] = [];
    if (totalAdded > 0) summary.push(`${totalAdded} addition${totalAdded === 1 ? '' : 's'}`);
    if (totalUpdated > 0) summary.push(`${totalUpdated} update${totalUpdated === 1 ? '' : 's'}`);
    if (totalRemoved > 0) summary.push(`${totalRemoved} removal${totalRemoved === 1 ? '' : 's'}`);
    if (totalSourceChanges > 0) summary.push(`${totalSourceChanges} source file${totalSourceChanges === 1 ? '' : 's'} changed`);
    
    lines.push(`## Summary: ${summary.join(', ')}`);
    lines.push('');
    lines.push('─'.repeat(80));
    lines.push('');

    // Per-file diffs
    for (const diff of diffs) {
      if (isLocaleDiff(diff)) {
        lines.push(`## ${diff.locale} (${diff.path})`);
        lines.push('');
        
        // Show statistics
        const stats: string[] = [];
        if (diff.added.length > 0) stats.push(`+${diff.added.length} added`);
        if (diff.updated.length > 0) stats.push(`~${diff.updated.length} updated`);
        if (diff.removed.length > 0) stats.push(`-${diff.removed.length} removed`);
        
        if (stats.length > 0) {
          lines.push(`Changes: ${stats.join(', ')}`);
          lines.push('');
        }
      } else {
        // Source file diff
        lines.push(`## ${diff.relativePath}`);
        lines.push('');
        lines.push(`Changes: modified`);
        lines.push('');
      }

      // Show the actual diff (unified diff format)
      lines.push('```diff');
      lines.push(diff.diff.trim());
      lines.push('```');
      lines.push('');
      lines.push('─'.repeat(80));
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format diffs as a compact summary (for status bar or notifications)
   */
  formatDiffSummary(diffs: DiffEntry[]): string {
    if (!diffs.length) {
      return 'No changes';
    }

    const localeDiffs = diffs.filter(isLocaleDiff);
    const sourceDiffs = diffs.filter(d => !isLocaleDiff(d));

    const totalAdded = localeDiffs.reduce((sum, d) => sum + d.added.length, 0);
    const totalUpdated = localeDiffs.reduce((sum, d) => sum + d.updated.length, 0);
    const totalRemoved = localeDiffs.reduce((sum, d) => sum + d.removed.length, 0);

    const parts: string[] = [];
    if (totalAdded > 0) parts.push(`+${totalAdded}`);
    if (totalUpdated > 0) parts.push(`~${totalUpdated}`);
    if (totalRemoved > 0) parts.push(`-${totalRemoved}`);
    if (sourceDiffs.length > 0) parts.push(`${sourceDiffs.length} files`);

    return `${diffs.length} file${diffs.length === 1 ? '' : 's'} (${parts.join(', ')})`;
  }
}

/**
 * Content provider for virtual diff documents
 */
class DiffContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private content: string) {}

  provideTextDocumentContent(_uri: vscode.Uri): string {
    return this.content;
  }
}
