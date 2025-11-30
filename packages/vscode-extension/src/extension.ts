import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnostics';
import { I18nCodeLensProvider } from './codelens';
import { ReportWatcher } from './watcher';
import { I18nHoverProvider } from './hover';
import { I18nCodeActionProvider, addPlaceholderToLocale } from './codeactions';

let diagnosticsManager: DiagnosticsManager;
let reportWatcher: ReportWatcher;
let hoverProvider: I18nHoverProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log('i18nsmith extension activated');

  const supportedLanguages = [
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'typescriptreact' },
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'javascriptreact' },
  ];

  // Initialize diagnostics manager
  diagnosticsManager = new DiagnosticsManager();
  context.subscriptions.push(diagnosticsManager);

  // Initialize CodeLens provider
  const codeLensProvider = new I18nCodeLensProvider(diagnosticsManager);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(supportedLanguages, codeLensProvider)
  );

  // Initialize Hover provider
  hoverProvider = new I18nHoverProvider();
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(supportedLanguages, hoverProvider)
  );

  // Initialize CodeAction provider
  const codeActionProvider = new I18nCodeActionProvider(diagnosticsManager);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguages,
      codeActionProvider,
      { providedCodeActionKinds: I18nCodeActionProvider.providedCodeActionKinds }
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
      hoverProvider.clearCache();
      reportWatcher.refresh();
    }),
    vscode.commands.registerCommand('i18nsmith.addPlaceholder', async (key: string, workspaceRoot: string) => {
      await addPlaceholderToLocale(key, workspaceRoot);
      hoverProvider.clearCache();
      reportWatcher.refresh();
    }),
    vscode.commands.registerCommand('i18nsmith.extractKey', async (uri: vscode.Uri, range: vscode.Range, text: string) => {
      await extractKeyFromSelection(uri, range, text);
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

async function extractKeyFromSelection(uri: vscode.Uri, range: vscode.Range, text: string) {
  // Generate a key from the text (simple slug)
  const suggestedKey = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 30);

  const key = await vscode.window.showInputBox({
    prompt: 'Enter the translation key',
    value: `common.${suggestedKey}`,
    placeHolder: 'e.g., common.greeting',
  });

  if (!key) {
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  // Add to locale file
  await addPlaceholderToLocale(key, workspaceFolder.uri.fsPath);

  // Replace the selection with t('key')
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, range, `t('${key}')`);
  await vscode.workspace.applyEdit(edit);

  // Clear cache and refresh
  hoverProvider.clearCache();
  reportWatcher.refresh();

  vscode.window.showInformationMessage(`Extracted as '${key}'`);
}
