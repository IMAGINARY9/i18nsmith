import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnostics';
import { I18nCodeLensProvider } from './codelens';
import { ReportWatcher } from './watcher';

let diagnosticsManager: DiagnosticsManager;
let reportWatcher: ReportWatcher;

export function activate(context: vscode.ExtensionContext) {
  console.log('i18nsmith extension activated');

  // Initialize diagnostics manager
  diagnosticsManager = new DiagnosticsManager();
  context.subscriptions.push(diagnosticsManager);

  // Initialize CodeLens provider
  const codeLensProvider = new I18nCodeLensProvider(diagnosticsManager);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'javascriptreact' },
      ],
      codeLensProvider
    )
  );

  // Initialize file watcher for report changes
  reportWatcher = new ReportWatcher(diagnosticsManager);
  context.subscriptions.push(reportWatcher);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('i18nsmith.check', runCheck),
    vscode.commands.registerCommand('i18nsmith.sync', runSync),
    vscode.commands.registerCommand('i18nsmith.refreshDiagnostics', () => {
      reportWatcher.refresh();
    })
  );

  // Initial load of diagnostics
  reportWatcher.refresh();

  // Show status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'i18nsmith.check';
  statusBarItem.text = '$(globe) i18nsmith';
  statusBarItem.tooltip = 'Run i18nsmith health check';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
}

export function deactivate() {
  console.log('i18nsmith extension deactivated');
}

async function runCheck() {
  const terminal = vscode.window.createTerminal('i18nsmith');
  terminal.show();
  
  const config = vscode.workspace.getConfiguration('i18nsmith');
  const reportPath = config.get<string>('reportPath', '.i18nsmith/check-report.json');
  
  terminal.sendText(`npx i18nsmith check --json --report "${reportPath}"`);
  
  vscode.window.showInformationMessage('Running i18nsmith check...');
}

async function runSync() {
  const terminal = vscode.window.createTerminal('i18nsmith');
  terminal.show();
  
  terminal.sendText('npx i18nsmith sync --json');
  
  vscode.window.showInformationMessage('Running i18nsmith sync (dry-run)...');
}
