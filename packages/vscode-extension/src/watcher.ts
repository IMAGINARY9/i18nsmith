import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { DiagnosticsManager, CheckReport } from "./diagnostics";
import { summarizeReportIssues } from "./report-utils";

/**
 * Watches for changes to the i18nsmith report file and updates diagnostics
 */
export class ReportWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;
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

    // Watch for the report file
    const pattern = new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] || "",
      reportPath
    );

    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidChange(() => this.refresh());
    this.watcher.onDidCreate(() => this.refresh());
    this.watcher.onDidDelete(() => this.handleReportDeleted());

    this.disposables.push(this.watcher);

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
    this.watcher?.dispose();
    this.watcher = undefined;
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
  }

  /**
   * Refresh diagnostics by reading the report file
   */
  async refresh() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    const config = vscode.workspace.getConfiguration("i18nsmith");
    const reportPath = config.get<string>(
      "reportPath",
      ".i18nsmith/check-report.json"
    );
    const fullPath = path.join(workspaceFolder.uri.fsPath, reportPath);

    try {
      if (!fs.existsSync(fullPath)) {
        // No report file yet, clear diagnostics
        this.diagnosticsManager.clear();
        this.refreshEmitter.fire(null);
        return;
      }

      const content = fs.readFileSync(fullPath, "utf8");

      // Handle empty or whitespace-only files
      if (!content || !content.trim()) {
        this.diagnosticsManager.clear();
        this.refreshEmitter.fire(null);
        return;
      }

      let report: CheckReport;
      try {
        report = JSON.parse(content);
      } catch (parseError) {
        // JSON parse error - the file may be partially written or corrupted
        console.error("Failed to parse i18nsmith report JSON:", parseError);
        // Don't show a warning to the user for transient parse errors
        // This can happen when the file is being written by the CLI
        return;
      }

      this.diagnosticsManager.updateFromReport(
        report,
        workspaceFolder.uri.fsPath
      );
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
    } catch (error) {
      // File system error (e.g., permission denied, file locked)
      console.error("Failed to read i18nsmith report:", error);
      // Only show warning for persistent errors, not transient ones
      const errMsg = error instanceof Error ? error.message : String(error);
      if (!errMsg.includes("ENOENT") && !errMsg.includes("EBUSY")) {
        vscode.window.showWarningMessage(
          `i18nsmith: Failed to read report at ${reportPath}: ${errMsg}`
        );
      }
    }
  }

  private handleReportDeleted() {
    this.diagnosticsManager.clear();
    this.refreshEmitter.fire(null);
  }
}
