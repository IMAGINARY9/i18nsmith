import * as vscode from 'vscode';
import { SmartScanner, ScanState, ScanResult } from './scanner';

/**
 * Enhanced status bar item that shows:
 * - Current scan state (idle/scanning/success/error)
 * - Issue count
 * - Last scan time
 * - Click to re-scan or show output
 */
export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private scanner: SmartScanner) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    
    this.statusBarItem.command = 'i18nsmith.check';
    this.statusBarItem.show();

    // Subscribe to scanner events
    this.disposables.push(
      scanner.onStateChange((state) => this.updateFromState(state)),
      scanner.onScanComplete((result) => this.updateFromResult(result))
    );

    // Initial state
    this.updateFromState('idle');
  }

  dispose() {
    this.statusBarItem.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  private updateFromState(state: ScanState) {
    switch (state) {
      case 'idle':
        this.statusBarItem.text = '$(globe) i18nsmith';
        this.statusBarItem.tooltip = 'Click to run i18nsmith check';
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'scanning':
        this.statusBarItem.text = '$(sync~spin) i18nsmith';
        this.statusBarItem.tooltip = 'Scanning...';
        this.statusBarItem.backgroundColor = undefined;
        break;
      case 'success':
        // Will be updated by updateFromResult
        break;
      case 'error':
        this.statusBarItem.text = '$(error) i18nsmith';
        this.statusBarItem.tooltip = 'Scan failed - click to retry';
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground'
        );
        break;
    }
  }

  private updateFromResult(result: ScanResult) {
    if (!result.success) {
      this.statusBarItem.text = '$(error) i18nsmith';
      this.statusBarItem.tooltip = `Scan failed: ${result.error}\nClick to retry`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground'
      );
      return;
    }

    const timeAgo = this.formatTimeAgo(result.timestamp);
    
    if (result.issueCount === 0) {
      this.statusBarItem.text = '$(check) i18nsmith';
      this.statusBarItem.tooltip = `No issues found\nLast scan: ${timeAgo}\nClick to re-scan`;
      this.statusBarItem.backgroundColor = undefined;
    } else {
      this.statusBarItem.text = `$(warning) i18nsmith: ${result.issueCount}`;
      this.statusBarItem.tooltip = `${result.issueCount} issue${result.issueCount === 1 ? '' : 's'} found\nLast scan: ${timeAgo}\nClick to re-scan`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    }
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    return date.toLocaleDateString();
  }

  /**
   * Force update the status bar from the last scan result
   */
  refresh() {
    const result = this.scanner.lastResult;
    if (result) {
      this.updateFromResult(result);
    } else {
      this.updateFromState(this.scanner.state);
    }
  }
}
