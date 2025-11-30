import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnostics';
import { I18nCodeLensProvider } from './codelens';
import { ReportWatcher } from './watcher';
import { I18nHoverProvider } from './hover';
import { I18nCodeActionProvider, addPlaceholderToLocale } from './codeactions';
import { SmartScanner } from './scanner';
import { StatusBarManager } from './statusbar';

let diagnosticsManager: DiagnosticsManager;
let reportWatcher: ReportWatcher;
let hoverProvider: I18nHoverProvider;
let smartScanner: SmartScanner;
let statusBarManager: StatusBarManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('i18nsmith extension activated');

  const supportedLanguages = [
    { scheme: 'file', language: 'typescript' },
    { scheme: 'file', language: 'typescriptreact' },
    { scheme: 'file', language: 'javascript' },
    { scheme: 'file', language: 'javascriptreact' },
    { scheme: 'file', language: 'vue' },
    { scheme: 'file', language: 'svelte' },
  ];

  // Initialize smart scanner (handles background scanning with debounce)
  smartScanner = new SmartScanner();
  context.subscriptions.push(smartScanner);

  // Initialize enhanced status bar
  statusBarManager = new StatusBarManager(smartScanner);
  context.subscriptions.push(statusBarManager);

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

  // Initialize file watcher for report changes (refreshes diagnostics)
  reportWatcher = new ReportWatcher(diagnosticsManager);
  context.subscriptions.push(reportWatcher);

  // Connect scanner to diagnostics refresh
  smartScanner.onScanComplete(() => {
    hoverProvider.clearCache();
    reportWatcher.refresh();
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('i18nsmith.check', async () => {
      smartScanner.showOutput();
      await smartScanner.scan('manual');
    }),
    vscode.commands.registerCommand('i18nsmith.sync', runSync),
    vscode.commands.registerCommand('i18nsmith.refreshDiagnostics', () => {
      hoverProvider.clearCache();
      reportWatcher.refresh();
      statusBarManager.refresh();
    }),
    vscode.commands.registerCommand('i18nsmith.addPlaceholder', async (key: string, workspaceRoot: string) => {
      await addPlaceholderToLocale(key, workspaceRoot);
      hoverProvider.clearCache();
      reportWatcher.refresh();
    }),
    vscode.commands.registerCommand('i18nsmith.extractKey', async (uri: vscode.Uri, range: vscode.Range, text: string) => {
      await extractKeyFromSelection(uri, range, text);
    }),
    vscode.commands.registerCommand('i18nsmith.showOutput', () => {
      smartScanner.showOutput();
    })
  );

  // Initial load of diagnostics from existing report
  reportWatcher.refresh();

  // Run background scan on activation
  smartScanner.runActivationScan();
}

export function deactivate() {
  console.log('i18nsmith extension deactivated');
}

async function runSync() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const config = vscode.workspace.getConfiguration('i18nsmith');
  const cliPath = config.get<string>('cliPath', '');

  const cmd = cliPath
    ? `node "${cliPath}" sync --json`
    : 'npx i18nsmith sync --json';

  smartScanner.showOutput();

  const { exec } = require('child_process');

  return new Promise<void>((resolve) => {
    exec(
      cmd,
      { cwd: workspaceFolder.uri.fsPath },
      (error: Error | null, stdout: string, stderr: string) => {
        // Output is handled by SmartScanner's output channel
        if (error) {
          vscode.window.showErrorMessage(`i18nsmith sync failed: ${error.message}`);
        } else {
          vscode.window.showInformationMessage('i18nsmith sync completed');
          // Trigger a check to update diagnostics
          smartScanner.scan('sync-complete');
        }
        resolve();
      }
    );
  });
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
