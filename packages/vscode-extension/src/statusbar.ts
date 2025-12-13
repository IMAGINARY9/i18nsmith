import * as vscode from 'vscode';
import { SmartScanner, ScanState, ScanResult } from './scanner';
import { getSeverityLabel, type IssueSeverityLevel, type SeverityCounts } from './report-utils';

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
    
  // Clicking the status bar opens Quick Actions for fast access
  this.statusBarItem.command = 'i18nsmith.actions';
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
    
  const hasQuickActions = result.warningCount > 0;
  const actionCount = hasQuickActions ? result.warningCount : result.issueCount;

    if (actionCount === 0) {
      this.statusBarItem.text = '$(check) i18nsmith';
      this.statusBarItem.tooltip = `Workspace healthy\nLast scan: ${timeAgo}\nClick to open Quick Actions`;
      this.statusBarItem.backgroundColor = undefined;
      return;
    }

    const severityLabel = getSeverityLabel(result.statusLevel);
    const icon = this.getSeverityIcon(result.statusLevel);
    const suggestionBreakdown = this.formatSeverityBreakdown(result.suggestionSeverityCounts);
    const issueBreakdown = this.formatSeverityBreakdown(result.severityCounts);
    const reasons = result.statusReasons.length ? result.statusReasons : [`${actionCount} actions available`];

    this.statusBarItem.text = `${icon} i18nsmith: ${actionCount}`;
    const tooltipLines: string[] = [];
    if (hasQuickActions) {
      tooltipLines.push(
        `${result.warningCount} quick action${result.warningCount === 1 ? '' : 's'} ready (${suggestionBreakdown || 'review'})`
      );
    }
    tooltipLines.push(
      `${result.issueCount} diagnostic${result.issueCount === 1 ? '' : 's'} (${issueBreakdown || 'no details'})`
    );
    tooltipLines.push(`Severity: ${severityLabel}`);
    tooltipLines.push(...reasons.map((reason) => `• ${reason}`));
    tooltipLines.push(`Last scan: ${timeAgo}`);
    tooltipLines.push('Click to open Quick Actions');

    this.statusBarItem.tooltip = tooltipLines.join('\n');
    this.statusBarItem.backgroundColor = this.getSeverityBackground(result.statusLevel);
  }

  private getSeverityIcon(level: IssueSeverityLevel): string {
    switch (level) {
      case 'error':
        return '$(error)';
      case 'warn':
        return '$(warning)';
      case 'info':
        return '$(info)';
      default:
        return '$(globe)';
    }
  }

  private getSeverityBackground(level: IssueSeverityLevel): vscode.ThemeColor | undefined {
    switch (level) {
      case 'error':
        return new vscode.ThemeColor('statusBarItem.errorBackground');
      case 'warn':
        return new vscode.ThemeColor('statusBarItem.warningBackground');
      default:
        return undefined;
    }
  }

  private formatSeverityBreakdown(counts: SeverityCounts): string {
    const parts: string[] = [];
    if (counts.error) {
      parts.push(`${counts.error} critical`);
    }
    if (counts.warn) {
      parts.push(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`);
    }
    if (counts.info) {
      parts.push(`${counts.info} info${counts.info === 1 ? '' : 's'}`);
    }
    return parts.join(', ');
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
