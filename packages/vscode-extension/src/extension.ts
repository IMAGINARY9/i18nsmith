import * as vscode from 'vscode';
import { exec } from 'child_process';
import { DiagnosticsManager } from './diagnostics';
import { I18nCodeLensProvider } from './codelens';
import { ReportWatcher } from './watcher';
import { I18nHoverProvider } from './hover';
import { I18nCodeActionProvider, addPlaceholderToLocale } from './codeactions';
import { SmartScanner } from './scanner';
import { StatusBarManager } from './statusbar';

interface QuickActionPick extends vscode.QuickPickItem {
  command?: string;
  builtin?: 'extract-selection' | 'run-check' | 'sync-dry-run' | 'refresh' | 'show-output';
  interactive?: boolean;
  confirmMessage?: string;
}

const QUICK_ACTION_SCAN_STALE_MS = 4000;

let diagnosticsManager: DiagnosticsManager;
let reportWatcher: ReportWatcher;
let hoverProvider: I18nHoverProvider;
let smartScanner: SmartScanner;
let statusBarManager: StatusBarManager;
let interactiveTerminal: vscode.Terminal | undefined;

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
    vscode.commands.registerCommand('i18nsmith.actions', async () => {
      await showQuickActions();
    }),
    vscode.commands.registerCommand('i18nsmith.extractSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Select some text first to extract as a translation key');
        return;
      }
      const text = editor.document.getText(editor.selection);
      await extractKeyFromSelection(editor.document.uri, editor.selection, text);
    }),
    vscode.commands.registerCommand('i18nsmith.showOutput', () => {
      smartScanner.showOutput();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal((terminal) => {
      if (terminal === interactiveTerminal) {
        interactiveTerminal = undefined;
      }
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

  return new Promise<void>((resolve) => {
    exec(
      cmd,
      { cwd: workspaceFolder.uri.fsPath },
      (error: Error | null, _stdout: string, _stderr: string) => {
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
  const document = await vscode.workspace.openTextDocument(uri);
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

  const wrapInJsx = shouldWrapSelectionInJsx(document, range, text);
  const replacement = wrapInJsx ? `{t('${key}')}` : `t('${key}')`;

  // Replace the selection with the translated call
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, range, replacement);
  await vscode.workspace.applyEdit(edit);

  // Clear cache and refresh
  hoverProvider.clearCache();
  reportWatcher.refresh();

  vscode.window.showInformationMessage(`Extracted as '${key}'`);
}

async function showQuickActions() {
  await ensureFreshDiagnosticsForQuickActions();

  const editor = vscode.window.activeTextEditor;
  const selection = editor?.selection;
  const hasSelection = !!editor && !selection?.isEmpty;
  const picks: QuickActionPick[] = [];

  let hasApplySuggestion = false;
  const report = diagnosticsManager?.getReport?.();
  const suggestedCommands = Array.isArray(report?.suggestedCommands)
    ? report.suggestedCommands
    : [];

  if (suggestedCommands.length) {
    for (const sc of suggestedCommands) {
      const interactive = isInteractiveCliCommand(sc.command);
      if (!hasApplySuggestion && /sync\b[\s\S]*--write/.test(sc.command)) {
        hasApplySuggestion = true;
      }
      picks.push({
        label: `$(rocket) ${sc.label}`,
        description: sc.reason || '',
        detail: sc.command,
        command: sc.command,
        interactive,
        confirmMessage: interactive
          ? 'This command may scaffold files or install dependencies. Continue?'
          : undefined,
      });
    }
    picks.push({ label: 'Recommended actions', kind: vscode.QuickPickItemKind.Separator });
  }

  if (hasSelection) {
    picks.push({
      label: '$(pencil) Extract selection as key',
      description: 'Create a translation key from selection and replace',
      builtin: 'extract-selection',
    });
  }

  if (!hasApplySuggestion) {
    picks.push({
      label: '$(tools) Apply local fixes',
      description: 'Run i18nsmith sync --write to add/remove locale keys',
      detail: 'i18nsmith sync --write --json',
      command: 'i18nsmith sync --write --json',
    });
  }

  picks.push(
    {
      label: '$(sync) Run Health Check',
      description: 'Run i18nsmith check (background)',
      builtin: 'run-check',
    },
    {
      label: '$(cloud-download) Sync Locales (dry-run)',
      description: 'Run i18nsmith sync --dry-run',
      builtin: 'sync-dry-run',
    },
    {
      label: '$(refresh) Refresh Diagnostics',
      description: 'Reload diagnostics from report',
      builtin: 'refresh',
    },
    {
      label: '$(output) Show Output',
      description: 'Open i18nsmith output channel',
      builtin: 'show-output',
    }
  );

  const choice = (await vscode.window.showQuickPick(picks, { placeHolder: 'i18nsmith actions' })) as QuickActionPick | undefined;
  if (!choice || choice.kind === vscode.QuickPickItemKind.Separator) {
    return;
  }

  if (choice.command) {
    await runCliCommand(choice.command, {
      interactive: choice.interactive,
      confirmMessage: choice.confirmMessage,
    });
    return;
  }

  switch (choice.builtin) {
    case 'extract-selection': {
      if (!editor) {
        return;
      }
      const text = editor.document.getText(selection!);
      await extractKeyFromSelection(editor.document.uri, selection!, text);
      break;
    }
    case 'run-check': {
      smartScanner.showOutput();
      await smartScanner.scan('manual');
      break;
    }
    case 'sync-dry-run': {
      await runSync();
      break;
    }
    case 'refresh': {
      hoverProvider.clearCache();
      reportWatcher.refresh();
      statusBarManager.refresh();
      break;
    }
    case 'show-output': {
      smartScanner.showOutput();
      break;
    }
  }
}

async function ensureFreshDiagnosticsForQuickActions() {
  if (!smartScanner) {
    return;
  }

  const lastTimestamp = smartScanner.lastResult?.timestamp?.getTime?.() ?? 0;
  const isFresh = smartScanner.lastResult && Date.now() - lastTimestamp <= QUICK_ACTION_SCAN_STALE_MS;

  const runScan = async () => {
    await smartScanner.scan('quick-actions');
    await reportWatcher?.refresh();
  };

  if (isFresh) {
    await runScan();
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'i18nsmith: Refreshing health report…',
    },
    runScan
  );
}

function isInteractiveCliCommand(command: string): boolean {
  return /\b(scaffold-adapter|init)\b/.test(command);
}

async function runCliCommand(
  rawCommand: string,
  options: { interactive?: boolean; confirmMessage?: string } = {}
) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  if (options.confirmMessage) {
    const answer = await vscode.window.showWarningMessage(options.confirmMessage, { modal: true }, 'Continue');
    if (answer !== 'Continue') {
      return;
    }
  }

  const command = transformCliCommand(rawCommand);

  if (options.interactive) {
    const terminal = ensureInteractiveTerminal(workspaceFolder.uri.fsPath);
    terminal.show();
    terminal.sendText(command, true);
    vscode.window.showInformationMessage(
      'Command started in the integrated terminal. Refresh diagnostics once it completes.'
    );
    return;
  }

  const out = vscode.window.createOutputChannel('i18nsmith');
  out.show();
  out.appendLine(`$ ${command}`);

  await new Promise<void>((resolve) => {
    exec(command, { cwd: workspaceFolder.uri.fsPath }, async (err: Error | null, stdout: string, stderr: string) => {
      if (stdout) {
        out.appendLine(stdout);
      }
      if (stderr) {
        out.appendLine(`[stderr] ${stderr}`);
      }
      if (err) {
        out.appendLine(`[error] ${err.message}`);
        vscode.window.showErrorMessage(`Command failed: ${err.message}`);
      } else {
        vscode.window.showInformationMessage('Command completed');
        await reportWatcher?.refresh();
        if (smartScanner) {
          await smartScanner.scan('suggested-command');
        }
      }
      resolve();
    });
  });
}

function transformCliCommand(raw: string): string {
  const trimmed = raw.trim();
  const tokens = trimmed.split(/\s+/);
  if (tokens[0] !== 'i18nsmith') {
    return trimmed;
  }

  const rest = tokens.slice(1).join(' ');
  const config = vscode.workspace.getConfiguration('i18nsmith');
  const cliPath = config.get<string>('cliPath', '');
  if (cliPath) {
    return rest ? `node "${cliPath}" ${rest}` : `node "${cliPath}"`;
  }
  return rest ? `npx i18nsmith ${rest}` : 'npx i18nsmith';
}

function ensureInteractiveTerminal(cwd: string): vscode.Terminal {
  if (!interactiveTerminal) {
    interactiveTerminal = vscode.window.createTerminal({ name: 'i18nsmith tasks', cwd });
  }
  return interactiveTerminal;
}

function shouldWrapSelectionInJsx(
  document: vscode.TextDocument,
  range: vscode.Range,
  selectedText: string
): boolean {
  const trimmed = selectedText.trim();
  if (!trimmed) {
    return false;
  }

  if (/^['"`]/.test(trimmed)) {
    return false;
  }

  if (!['typescriptreact', 'javascriptreact'].includes(document.languageId)) {
    return false;
  }

  if (!/[A-Za-z0-9]/.test(trimmed)) {
    return false;
  }

  const charBefore = getCharBefore(document, range.start);
  const charAfter = getCharAfter(document, range.end);
  const beforeIsBoundary = !charBefore || charBefore === '>' || /\s/.test(charBefore);
  const afterIsBoundary = !charAfter || charAfter === '<' || /\s/.test(charAfter);

  return beforeIsBoundary && afterIsBoundary;
}

function getCharBefore(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  if (position.character > 0) {
    const start = position.translate(0, -1);
    return document.getText(new vscode.Range(start, position));
  }
  if (position.line === 0) {
    return undefined;
  }
  return '\n';
}

function getCharAfter(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const line = document.lineAt(position.line);
  if (position.character < line.text.length) {
    const end = position.translate(0, 1);
    return document.getText(new vscode.Range(position, end));
  }
  if (position.line >= document.lineCount - 1) {
    return undefined;
  }
  return '\n';
}
