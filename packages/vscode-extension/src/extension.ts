import * as vscode from 'vscode';
import { exec } from 'child_process';
import { DiagnosticsManager } from './diagnostics';
import { I18nCodeLensProvider } from './codelens';
import { ReportWatcher } from './watcher';
import { I18nHoverProvider } from './hover';
import * as fs from 'fs';
import * as path from 'path';
import { I18nCodeActionProvider, addPlaceholderToLocale } from './codeactions';
import { SmartScanner } from './scanner';
import { StatusBarManager } from './statusbar';
import { I18nDefinitionProvider } from './definition';
import { CheckIntegration } from './check-integration';
import { SyncIntegration } from './sync-integration';
import { loadConfigWithMeta } from '@i18nsmith/core';
import type { SyncSummary, MissingKeyRecord, UnusedKeyRecord } from '@i18nsmith/core';
import { Transformer } from '@i18nsmith/transformer';
import type { TransformSummary, TransformCandidate } from '@i18nsmith/transformer';

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
let checkIntegration: CheckIntegration;
let syncIntegration: SyncIntegration | undefined;
let verboseOutputChannel: vscode.OutputChannel;

function logVerbose(message: string) {
  const config = vscode.workspace.getConfiguration('i18nsmith');
  if (config.get<boolean>('enableVerboseLogging', false)) {
    verboseOutputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('i18nsmith extension activated');

  verboseOutputChannel = vscode.window.createOutputChannel('i18nsmith (Verbose)');
  context.subscriptions.push(verboseOutputChannel);

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

  // Initialize check integration (core CheckRunner without CLI subprocess)
  checkIntegration = new CheckIntegration();
  syncIntegration = new SyncIntegration();

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

  // Initialize Definition provider (Go to Definition on translation keys)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(supportedLanguages, new I18nDefinitionProvider())
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
    vscode.commands.registerCommand('i18nsmith.sync', async () => {
      await runSync({ dryRunOnly: false });
    }),
    vscode.commands.registerCommand('i18nsmith.syncFile', async () => {
      await syncCurrentFile();
    }),
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
    vscode.commands.registerCommand('i18nsmith.renameSuspiciousKey', async (originalKey: string, newKey: string) => {
      await renameSuspiciousKey(originalKey, newKey);
    }),
    vscode.commands.registerCommand('i18nsmith.ignoreSuspiciousKey', async (uri: vscode.Uri, line: number) => {
      await insertIgnoreComment(uri, line, 'suspicious-key');
    }),
    vscode.commands.registerCommand('i18nsmith.openLocaleFile', async () => {
      await openSourceLocaleFile();
    }),
    vscode.commands.registerCommand('i18nsmith.renameKey', async () => {
      await renameKeyAtCursor();
    }),
    vscode.commands.registerCommand('i18nsmith.checkFile', async () => {
      await checkCurrentFile();
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
    }),
    vscode.commands.registerCommand('i18nsmith.transformFile', async () => {
      await transformCurrentFile();
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

async function checkCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Checking file...',
      cancellable: false,
    },
    async () => {
      const summary = await checkIntegration.checkFile(workspaceFolder.uri.fsPath, editor.document.uri.fsPath);
      const fileIssues = summary.actionableItems.filter((item: any) => item.filePath === editor.document.uri.fsPath);
      if (fileIssues.length === 0) {
        vscode.window.showInformationMessage('No i18n issues found in this file');
      } else {
        vscode.window.showWarningMessage(
          `Found ${fileIssues.length} i18n issue${fileIssues.length === 1 ? '' : 's'} in this file`
        );
      }
    }
  );
}

async function renameSuspiciousKey(originalKey: string, newKey: string) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const command = `i18nsmith rename-key ${quoteCliArg(originalKey)} ${quoteCliArg(newKey)} --write --json`;
  await runCliCommand(command);
}

function quoteCliArg(value: string): string {
  if (!value) {
    return '""';
  }
  const escaped = value.replace(/(["\\])/g, '\\$1');
  return `"${escaped}"`;
}

export function deactivate() {
  console.log('i18nsmith extension deactivated');
}

interface SyncQuickPickItem extends vscode.QuickPickItem {
  bucket: 'missing' | 'unused';
  key: string;
}

interface SyncSelectionResult {
  missing: string[];
  unused: string[];
}

async function runSync(options: { targets?: string[]; dryRunOnly?: boolean } = {}) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  if (!syncIntegration) {
    syncIntegration = new SyncIntegration();
  }

  logVerbose(`runSync: Starting preview for ${options.targets?.length ?? 'all'} target(s)`);

  const preview = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.dryRunOnly ? 'i18nsmith: Gathering sync preview…' : 'i18nsmith: Preparing sync…',
      cancellable: false,
    },
    () => syncIntegration!.run(workspaceFolder.uri.fsPath, {
      write: false,
      diff: true,
      targets: options.targets,
    })
  );

  const summary = preview.summary;
  const hasDrift = summary.missingKeys.length > 0 || summary.unusedKeys.length > 0;

  logVerbose(`runSync: Preview complete - ${summary.missingKeys.length} missing, ${summary.unusedKeys.length} unused`);

  if (!hasDrift) {
    vscode.window.showInformationMessage('Locales are already in sync. Nothing to do.');
    return;
  }

  if (options.dryRunOnly) {
    showSyncDryRunSummary(summary);
    return;
  }

  const selection = await presentSyncQuickPick(summary);
  if (!selection) {
    logVerbose('runSync: User cancelled selection');
    return;
  }

  if (!selection.missing.length && !selection.unused.length) {
    logVerbose('runSync: No changes selected');
    vscode.window.showWarningMessage('No changes selected for sync.');
    return;
  }

  logVerbose(`runSync: Applying ${selection.missing.length} missing, ${selection.unused.length} unused`);

  const writeResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Applying locale changes…',
      cancellable: false,
    },
    () => syncIntegration!.run(workspaceFolder.uri.fsPath, {
      write: true,
      prune: selection.unused.length > 0,
      selection,
      targets: options.targets,
    })
  );

  const added = selection.missing.length;
  const removed = selection.unused.length;
  const parts = [];
  if (added) parts.push(`${added} addition${added === 1 ? '' : 's'}`);
  if (removed) parts.push(`${removed} removal${removed === 1 ? '' : 's'}`);
  const message = parts.length ? parts.join(' and ') : 'No changes applied';
  
  logVerbose(`runSync: Write complete - ${message}`);
  
  vscode.window.showInformationMessage(`Locale sync completed (${message}).`);

  hoverProvider.clearCache();
  await reportWatcher.refresh();
  await smartScanner.scan('sync-complete');
}

function showSyncDryRunSummary(summary: SyncSummary) {
  const added = summary.missingKeys.length;
  const removed = summary.unusedKeys.length;
  const placeholderIssues = summary.placeholderIssues.length;
  const emptyValues = summary.emptyValueViolations.length;

  const lines = [
    added ? `• ${added} missing key${added === 1 ? '' : 's'} detected` : '• No missing keys',
    removed ? `• ${removed} unused key${removed === 1 ? '' : 's'} detected` : '• No unused keys',
  ];
  if (placeholderIssues) {
    lines.push(`• ${placeholderIssues} placeholder mismatch${placeholderIssues === 1 ? '' : 'es'}`);
  }
  if (emptyValues) {
    lines.push(`• ${emptyValues} empty locale value${emptyValues === 1 ? '' : 's'}`);
  }

  vscode.window.showInformationMessage(`i18nsmith sync preview:\n${lines.join('\n')}`);
}

async function presentSyncQuickPick(summary: SyncSummary): Promise<SyncSelectionResult | null> {
  const items: SyncQuickPickItem[] = [];

  summary.missingKeys.forEach((record: MissingKeyRecord) => {
    const sample = record.references[0];
    items.push({
      label: `$(diff-added) ${record.key}`,
      description: sample ? `${sample.filePath}:${sample.position.line}` : 'missing in source locale',
      detail: `${record.references.length} reference${record.references.length === 1 ? '' : 's'}`,
      picked: true,
      bucket: 'missing',
      key: record.key,
    });
  });

  summary.unusedKeys.forEach((record: UnusedKeyRecord) => {
    items.push({
      label: `$(diff-removed) ${record.key}`,
      description: record.locales.join(', '),
      detail: 'Remove from locales',
      picked: false,
      bucket: 'unused',
      key: record.key,
    });
  });

  const selection = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select locale changes to apply (toggle entries to include or exclude)',
  });

  if (!selection) {
    return null;
  }

  const missing = selection.filter((item) => item.bucket === 'missing').map((item) => item.key);
  const unused = selection.filter((item) => item.bucket === 'unused').map((item) => item.key);

  return { missing, unused };
}

async function syncCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file to run a focused sync.');
    return;
  }

  logVerbose(`syncCurrentFile: Starting sync for ${editor.document.uri.fsPath}`);

  await runSync({ targets: [editor.document.uri.fsPath] });
}

async function transformCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file to transform.');
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri) ?? vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const { config, projectRoot } = await loadConfigWithMeta(undefined, { cwd: workspaceFolder.uri.fsPath });
  const transformer = new Transformer(config, { workspaceRoot: projectRoot });
  const relativePath = path.relative(projectRoot, editor.document.uri.fsPath) || editor.document.uri.fsPath;

  logVerbose(`transformCurrentFile: Starting preview for ${relativePath}`);

  const preview: TransformSummary = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Analyzing transform candidates…',
      cancellable: false,
    },
    () => transformer.run({
      write: false,
      targets: [relativePath],
      diff: true,
    })
  );

  const pending = preview.candidates.filter((candidate: TransformCandidate) => candidate.status === 'pending');
  
  logVerbose(`transformCurrentFile: Preview complete - ${pending.length} pending candidates`);
  
  if (!pending.length) {
    vscode.window.showInformationMessage('No transformable strings found in this file.');
    return;
  }

  const detail = formatTransformPreview(preview);
  const choice = await vscode.window.showInformationMessage(
    `Transform ${pending.length} candidate${pending.length === 1 ? '' : 's'} in ${path.basename(editor.document.uri.fsPath)}?`,
    { modal: true, detail },
    'Apply',
    'Dry Run Only'
  );

  if (!choice) {
    logVerbose('transformCurrentFile: User cancelled');
    return;
  }

  if (choice === 'Dry Run Only') {
    logVerbose('transformCurrentFile: Dry run only, showing preview');
    vscode.window.showInformationMessage(`Preview only. Re-run the command and choose Apply to write changes.`, { detail });
    return;
  }

  logVerbose(`transformCurrentFile: Applying ${pending.length} transformations`);

  const writeSummary: TransformSummary = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Applying transform…',
      cancellable: false,
    },
    () => transformer.run({
      write: true,
      targets: [relativePath],
      diff: true,
    })
  );

  const applied = writeSummary.candidates.filter((candidate: TransformCandidate) => candidate.status === 'applied').length;
  
  logVerbose(`transformCurrentFile: Write complete - ${applied} applied`);
  
  vscode.window.showInformationMessage(
    `Applied ${applied} transformation${applied === 1 ? '' : 's'} in ${path.basename(editor.document.uri.fsPath)}.`,
    { detail: formatTransformPreview(writeSummary) }
  );

  hoverProvider.clearCache();
  await reportWatcher.refresh();
  await smartScanner.scan('transform-file');
}

function formatTransformPreview(summary: TransformSummary, limit = 5): string {
  const preview = summary.candidates
    .filter((candidate: TransformCandidate) => candidate.status === 'pending' || candidate.status === 'applied')
    .slice(0, limit)
    .map((candidate: TransformCandidate) => {
      const snippet = candidate.text.replace(/\s+/g, ' ').trim();
      return `• ${candidate.filePath}:${candidate.position.line} ⇒ ${candidate.suggestedKey} (${snippet.slice(0, 60)}${snippet.length > 60 ? '…' : ''})`;
    });

  if (!preview.length) {
    return 'No candidate preview available.';
  }

  const remaining = summary.candidates.length - preview.length;
  return remaining > 0 ? `${preview.join('\n')}\n…and ${remaining} more.` : preview.join('\n');
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

function getDriftStatistics(report: any): { missing: number; unused: number } | null {
  if (!report?.sync) {
    return null;
  }
  
  const missing = Array.isArray(report.sync.missingKeys) ? report.sync.missingKeys.length : 0;
  const unused = Array.isArray(report.sync.unusedKeys) ? report.sync.unusedKeys.length : 0;
  
  if (missing === 0 && unused === 0) {
    return null;
  }
  
  return { missing, unused };
}

async function showQuickActions() {
  await ensureFreshDiagnosticsForQuickActions();

  // Show drift statistics summary if available
  const report = diagnosticsManager?.getReport?.();
  const driftStats = getDriftStatistics(report);
  if (driftStats) {
    const totalDrift = driftStats.missing + driftStats.unused;
    logVerbose(`showQuickActions: Drift detected - ${driftStats.missing} missing, ${driftStats.unused} unused (total: ${totalDrift})`);
    
    // Show a toast notification for significant drift (>10 keys)
    if (totalDrift > 10) {
      const parts: string[] = [];
      if (driftStats.missing > 0) parts.push(`${driftStats.missing} missing`);
      if (driftStats.unused > 0) parts.push(`${driftStats.unused} unused`);
      vscode.window.showInformationMessage(
        `i18nsmith detected ${totalDrift} locale drift issues: ${parts.join(', ')}`
      );
    }
  }

  const editor = vscode.window.activeTextEditor;
  const selection = editor?.selection;
  const hasSelection = !!editor && !selection?.isEmpty;
  const picks: QuickActionPick[] = [];

  let hasApplySuggestion = false;
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

  // If cursor is on a t('key') call, offer rename
  const keyAtCursor = editor ? findKeyAtCursor(editor.document, editor.selection.active) : null;
  if (keyAtCursor) {
    picks.push({
      label: `$(edit) Rename key '${keyAtCursor}'`,
      description: 'Rename the translation key at cursor across project',
      command: 'i18nsmith.renameKey',
    });
  }

  if (!hasApplySuggestion) {
    // Build description with drift stats if available
    let syncDescription = 'Run i18nsmith sync --write to add/remove locale keys';
    if (driftStats) {
      const parts: string[] = [];
      if (driftStats.missing > 0) parts.push(`${driftStats.missing} missing`);
      if (driftStats.unused > 0) parts.push(`${driftStats.unused} unused`);
      syncDescription = `${parts.join(', ')} — ${syncDescription}`;
    }
    
    picks.push({
      label: '$(tools) Apply local fixes',
      description: syncDescription,
      detail: 'i18nsmith: Sync workspace',
      command: 'i18nsmith.sync',
    });
  }

  picks.push(
    {
      label: '$(file-submodule) Open Source Locale File',
      description: 'Open the primary locale file for quick edits',
      command: 'i18nsmith.openLocaleFile'
    },
    {
      label: '$(file-symlink-directory) Sync current file only',
      description: 'Analyze translation usage for the active editor',
      command: 'i18nsmith.syncFile',
    },
    {
      label: '$(wand) Transform current file to use i18nsmith',
      description: 'Run transformer on active file with preview',
      command: 'i18nsmith.transformFile',
    },
    {
      label: '$(sync) Run Health Check',
      description: 'Run i18nsmith check (background)',
      builtin: 'run-check',
    }
  );

  // Add sync dry-run with drift stats if available
  let dryRunDescription = 'Run i18nsmith sync --dry-run';
  if (driftStats) {
    const parts: string[] = [];
    if (driftStats.missing > 0) parts.push(`${driftStats.missing} missing`);
    if (driftStats.unused > 0) parts.push(`${driftStats.unused} unused`);
    dryRunDescription = `Preview ${parts.join(', ')} — ${dryRunDescription}`;
  }
  
  picks.push(
    {
      label: '$(cloud-download) Sync Locales (dry-run)',
      description: dryRunDescription,
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

  // Build placeholder with drift stats if available
  let placeholder = 'i18nsmith actions';
  if (driftStats) {
    const parts: string[] = [];
    if (driftStats.missing > 0) {
      parts.push(`${driftStats.missing} missing key${driftStats.missing === 1 ? '' : 's'}`);
    }
    if (driftStats.unused > 0) {
      parts.push(`${driftStats.unused} unused key${driftStats.unused === 1 ? '' : 's'}`);
    }
    if (parts.length > 0) {
      placeholder = `${parts.join(', ')} detected — Choose an action`;
    }
  }

  const choice = (await vscode.window.showQuickPick(picks, { placeHolder: placeholder })) as QuickActionPick | undefined;
  if (!choice || choice.kind === vscode.QuickPickItemKind.Separator) {
    return;
  }

  if (choice.command) {
    // Check if it's a VS Code command or a CLI command
    if (choice.command.startsWith('i18nsmith.')) {
      await vscode.commands.executeCommand(choice.command);
    } else {
      await runCliCommand(choice.command, {
        interactive: choice.interactive,
        confirmMessage: choice.confirmMessage,
      });
    }
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
      await runSync({ dryRunOnly: true });
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
        const summary = summarizeCliJson(stdout);
        if (summary) {
          vscode.window.showInformationMessage(summary);
        } else {
          vscode.window.showInformationMessage('Command completed');
        }
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

async function insertIgnoreComment(uri: vscode.Uri, line: number, rule: string) {
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  const insertPos = new vscode.Position(Math.max(0, line), 0);
  const comment = `// i18n-ignore-next-line ${rule}\n`;
  edit.insert(uri, insertPos, comment);
  await vscode.workspace.applyEdit(edit);
  vscode.window.showInformationMessage('Added ignore comment for i18nsmith');
}

async function openSourceLocaleFile() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }
  const root = workspaceFolder.uri.fsPath;
  const configPath = path.join(root, 'i18n.config.json');
  let localesDir = 'locales';
  let sourceLanguage = 'en';
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      localesDir = cfg.localesDir || localesDir;
      sourceLanguage = cfg.sourceLanguage || sourceLanguage;
    }
  } catch {
    // use defaults
  }
  const filePath = path.join(root, localesDir, `${sourceLanguage}.json`);
  if (!fs.existsSync(filePath)) {
    vscode.window.showWarningMessage(`Locale file not found: ${path.relative(root, filePath)}`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(filePath);
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function renameKeyAtCursor() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('No active editor');
    return;
  }
  const key = findKeyAtCursor(editor.document, editor.selection.active);
  if (!key) {
    vscode.window.showWarningMessage('Place the cursor inside a t("key") call to rename the key');
    return;
  }
  const newKey = await vscode.window.showInputBox({
    prompt: `Rename key '${key}' to:`,
    value: key,
    validateInput: (v) => (v.trim() ? undefined : 'Key cannot be empty'),
  });
  if (!newKey || newKey === key) return;
  const cmd = `i18nsmith rename-key ${quoteCliArg(key)} ${quoteCliArg(newKey)} --write --json`;
  await runCliCommand(cmd);
}

function findKeyAtCursor(document: vscode.TextDocument, position: vscode.Position): string | null {
  const lineText = document.lineAt(position.line).text;
  const patterns = [
    /t\(\s*['"`](.+?)['"`]\s*\)/g,
    /t\(\s*['"`](.+?)['"`]\s*,/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(lineText)) !== null) {
      const keyStart = m.index + m[0].indexOf(m[1]);
      const keyEnd = keyStart + m[1].length;
      if (position.character >= keyStart && position.character <= keyEnd) {
        return m[1];
      }
    }
  }
  return null;
}

function summarizeCliJson(stdout: string): string | null {
  const text = stdout?.trim();
  if (!text) return null;
  // Try parse last JSON object in output
  const lastBrace = text.lastIndexOf('{');
  if (lastBrace === -1) return null;
  try {
    const obj = JSON.parse(text.slice(lastBrace));
    // Heuristics for common summaries
    if (obj?.sync) {
      const s = obj.sync;
      const added = s.added?.length ?? s.added ?? 0;
      const removed = s.removed?.length ?? s.removed ?? 0;
      const updated = s.updated?.length ?? s.updated ?? 0;
      return `Sync completed: ${added} added, ${updated} updated, ${removed} removed`;
    }
    if (obj?.result?.renamed || obj?.renamed) {
      const r = obj.result?.renamed ?? obj.renamed;
      if (Array.isArray(r)) return `Renamed ${r.length} key(s)`;
      return `Rename completed`;
    }
    if (obj?.status === 'ok' && obj?.message) {
      return obj.message;
    }
  } catch {
    // ignore
  }
  return null;
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
