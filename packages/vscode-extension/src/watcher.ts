import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DiagnosticsManager, CheckReport } from './diagnostics';

/**
 * Watches for changes to the i18nsmith report file and updates diagnostics
 */
export class ReportWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private diagnosticsManager: DiagnosticsManager) {
    this.setupWatcher();
  }

  dispose() {
    this.watcher?.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  /**
   * Set up file watcher for the report file
   */
  private setupWatcher() {
    const config = vscode.workspace.getConfiguration('i18nsmith');
    const reportPath = config.get<string>('reportPath', '.i18nsmith/check-report.json');
    const autoRefresh = config.get<boolean>('autoRefresh', true);

    if (!autoRefresh) {
      return;
    }

    // Watch for the report file
    const pattern = new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] || '',
      reportPath
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidChange(() => this.refresh());
    this.watcher.onDidCreate(() => this.refresh());
    this.watcher.onDidDelete(() => this.diagnosticsManager.clear());

    this.disposables.push(this.watcher);

    // Also watch for config changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e: vscode.ConfigurationChangeEvent) => {
        if (e.affectsConfiguration('i18nsmith')) {
          this.dispose();
          this.setupWatcher();
          this.refresh();
        }
      })
    );
  }

  /**
   * Refresh diagnostics by reading the report file
   */
  async refresh() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const config = vscode.workspace.getConfiguration('i18nsmith');
    const reportPath = config.get<string>('reportPath', '.i18nsmith/check-report.json');
    const fullPath = path.join(workspaceFolder.uri.fsPath, reportPath);

    try {
      if (!fs.existsSync(fullPath)) {
        // No report file yet, clear diagnostics
        this.diagnosticsManager.clear();
        return;
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      const report: CheckReport = JSON.parse(content);
      
      this.diagnosticsManager.updateFromReport(report, workspaceFolder.uri.fsPath);
      
      // Show status message
      const issueCount = (report.actionableItems?.length || 0) +
        (report.diagnostics?.actionableItems?.length || 0) +
        (report.sync?.actionableItems?.length || 0);
      
      if (issueCount > 0) {
        vscode.window.setStatusBarMessage(
          `$(warning) i18nsmith: ${issueCount} issue${issueCount === 1 ? '' : 's'} found`,
          5000
        );
      } else {
        vscode.window.setStatusBarMessage('$(check) i18nsmith: No issues', 3000);
      }
    } catch (error) {
      console.error('Failed to read i18nsmith report:', error);
      vscode.window.showWarningMessage(
        `i18nsmith: Failed to parse report at ${reportPath}`
      );
    }
  }
}
