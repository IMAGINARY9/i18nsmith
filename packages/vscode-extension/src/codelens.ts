import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnostics';

/**
 * CodeLens provider for i18nsmith actions
 */
export class I18nCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private diagnosticsManager: DiagnosticsManager) {}

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const config = vscode.workspace.getConfiguration('i18nsmith');
    if (!config.get<boolean>('showCodeLens', true)) {
      return [];
    }

    const codeLenses: vscode.CodeLens[] = [];
    const filePath = document.uri.fsPath;
    const issues = this.diagnosticsManager.getIssuesForFile(filePath);

    if (issues.length > 0) {
      // Add a CodeLens at the top of the file showing issue count
      const topRange = new vscode.Range(0, 0, 0, 0);
      
      codeLenses.push(
        new vscode.CodeLens(topRange, {
          title: `$(warning) ${issues.length} i18n issue${issues.length === 1 ? '' : 's'}`,
          command: 'i18nsmith.check',
          tooltip: 'Run i18nsmith check to refresh',
        })
      );

      codeLenses.push(
        new vscode.CodeLens(topRange, {
          title: '$(sync) Sync',
          command: 'i18nsmith.sync',
          tooltip: 'Run i18nsmith sync',
        })
      );
    }

    // Add CodeLens for each issue with a line number
    for (const issue of issues) {
      if (issue.line) {
        const lineNum = issue.line - 1;
        if (lineNum >= 0 && lineNum < document.lineCount) {
          const range = new vscode.Range(lineNum, 0, lineNum, 0);
          codeLenses.push(
            new vscode.CodeLens(range, {
              title: `$(lightbulb) ${issue.kind}: ${issue.key || issue.message.slice(0, 50)}`,
              command: '',
              tooltip: issue.message,
            })
          );
        }
      }
    }

    return codeLenses;
  }

  /**
   * Notify that CodeLenses should be refreshed
   */
  refresh() {
    this._onDidChangeCodeLenses.fire();
  }
}
