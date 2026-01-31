import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { DiagnosticsManager, CheckReport } from "./diagnostics";
import { summarizeReportIssues } from "./report-utils";

/**
 * Watches for changes to the i18nsmith report file and updates diagnostics
 */
export class ReportWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private readonly refreshEmitter =
    new vscode.EventEmitter<CheckReport | null>();
  public readonly onDidRefresh = this.refreshEmitter.event;

  constructor(private diagnosticsManager: DiagnosticsManager) {
    this.setupWatcher();
  }

  dispose() {
    this.disposeWatcherResources();
    this.refreshEmitter.dispose();
  }

  /**
   * Set up file watcher for the report file
   */
  private setupWatcher() {
    this.disposeWatcherResources();

    const config = vscode.workspace.getConfiguration("i18nsmith");
    const reportPath = config.get<string>(
      "reportPath",
      ".i18nsmith/check-report.json"
    );
    const autoRefresh = config.get<boolean>("autoRefresh", true);

    if (!autoRefresh) {
      return;
    }

    // Find all workspace folders that contain i18n.config.json
    const targetWorkspaces = [];
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const configPath = path.join(folder.uri.fsPath, 'i18n.config.json');
        if (fs.existsSync(configPath)) {
          targetWorkspaces.push(folder);
        }
      }
    }

    // If no workspaces have config, use the first workspace as fallback
    if (targetWorkspaces.length === 0 && vscode.workspace.workspaceFolders?.[0]) {
      targetWorkspaces.push(vscode.workspace.workspaceFolders[0]);
    }

    // Watch for the report file in all target workspaces
    for (const workspace of targetWorkspaces) {
      const pattern = new vscode.RelativePattern(workspace, reportPath);
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      watcher.onDidChange(() => this.refresh());
      watcher.onDidCreate(() => this.refresh());
      watcher.onDidDelete(() => this.handleReportDeleted());

      this.disposables.push(watcher);
    }

    // Also watch for config changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(
        (e: vscode.ConfigurationChangeEvent) => {
          if (e.affectsConfiguration("i18nsmith")) {
            this.setupWatcher();
            this.refresh();
          }
        }
      )
    );
  }

  private disposeWatcherResources() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /**
   * Refresh diagnostics by reading the report file
   */
  async refresh() {
    // Find all workspace folders that contain i18n.config.json
    const targetWorkspaces = [];
    if (vscode.workspace.workspaceFolders) {
      for (const folder of vscode.workspace.workspaceFolders) {
        const configPath = path.join(folder.uri.fsPath, 'i18n.config.json');
        if (fs.existsSync(configPath)) {
          targetWorkspaces.push(folder);
        }
      }
    }

    // If no workspaces have config, use all workspaces as fallback
    if (targetWorkspaces.length === 0) {
      targetWorkspaces.push(...(vscode.workspace.workspaceFolders || []));
    }

    const config = vscode.workspace.getConfiguration("i18nsmith");
    const reportPath = config.get<string>(
      "reportPath",
      ".i18nsmith/check-report.json"
    );

    // Check all target workspaces for report files
    for (const workspaceFolder of targetWorkspaces) {
      const fullPath = path.join(workspaceFolder.uri.fsPath, reportPath);

      try {
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, "utf8");

          // Handle empty or whitespace-only files
          if (!content || !content.trim()) {
            continue;
          }

          const report: CheckReport = JSON.parse(content);
          this.diagnosticsManager.updateFromReport(report, workspaceFolder.uri.fsPath);
          this.refreshEmitter.fire(report);

          // Show status message
          const issueCount = summarizeReportIssues(report).issueCount;
          if (issueCount > 0) {
            vscode.window.setStatusBarMessage(
              `$(warning) i18nsmith: ${issueCount} issue${issueCount === 1 ? "" : "s"} found`,
              5000
            );
          } else {
            vscode.window.setStatusBarMessage(
              "$(check) i18nsmith: No issues",
              3000
            );
          }
          return; // Use the first valid report found
        }
      } catch (error) {
        console.warn(`Failed to read report file ${fullPath}:`, error);
      }
    }

    // Fallback: Check the directory of the currently active file
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      const fileDir = path.dirname(activeEditor.document.uri.fsPath);
      const reportFilePath = path.join(fileDir, reportPath);
      
      try {
        if (fs.existsSync(reportFilePath)) {
          const content = fs.readFileSync(reportFilePath, "utf8");
          
          if (content && content.trim()) {
            const report: CheckReport = JSON.parse(content);
            this.diagnosticsManager.updateFromReport(report, fileDir);
            this.refreshEmitter.fire(report);

            const issueCount = summarizeReportIssues(report).issueCount;
            if (issueCount > 0) {
              vscode.window.setStatusBarMessage(
                `$(warning) i18nsmith: ${issueCount} issue${issueCount === 1 ? "" : "s"} found`,
                5000
              );
            } else {
              vscode.window.setStatusBarMessage(
                "$(check) i18nsmith: No issues",
                3000
              );
            }
            return;
          }
        }
      } catch (error) {
        console.warn(`Failed to read report file ${reportFilePath}:`, error);
      }
    }

    // No valid report file found, clear diagnostics
    this.diagnosticsManager.clear();
    this.refreshEmitter.fire(null);
  }

  private handleReportDeleted() {
    this.diagnosticsManager.clear();
    this.refreshEmitter.fire(null);
  }
}
