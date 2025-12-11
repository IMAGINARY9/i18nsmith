import * as vscode from 'vscode';
import { exec } from 'child_process';
import { DiagnosticsManager } from './diagnostics';
import { I18nCodeLensProvider } from './codelens';
import { ReportWatcher } from './watcher';
import { I18nHoverProvider } from './hover';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { I18nCodeActionProvider } from './codeactions';
import { SmartScanner, type ScanResult } from './scanner';
import { StatusBarManager } from './statusbar';
import { I18nDefinitionProvider } from './definition';
import { CheckIntegration } from './check-integration';
import { DiffPeekProvider } from './diff-peek';
import { ensureGitignore, loadConfigWithMeta, LocaleStore } from '@i18nsmith/core';
import type { SyncSummary, MissingKeyRecord, UnusedKeyRecord, KeyRenameSummary, SourceFileDiffEntry, TranslationPlan } from '@i18nsmith/core';
import type { TransformSummary, TransformCandidate } from '@i18nsmith/transformer';
import { PreviewManager } from './preview-manager';
import { resolveCliCommand, quoteCliArg } from './cli-utils';
import { executePreviewPlan, type PlannedChange } from './preview-flow';

interface QuickActionPick extends vscode.QuickPickItem {
  command?: string;
  previewIntent?: PreviewableCommand;
  builtin?: 'extract-selection' | 'run-check' | 'refresh' | 'show-output';
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
let diffPeekProvider: DiffPeekProvider;
let verboseOutputChannel: vscode.OutputChannel;
let cliOutputChannel: vscode.OutputChannel | undefined;
let previewManager: PreviewManager | undefined;
const fsp = fs.promises;

function logVerbose(message: string) {
  const config = vscode.workspace.getConfiguration('i18nsmith');
  if (config.get<boolean>('enableVerboseLogging', false)) {
    verboseOutputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

async function refreshDiagnosticsWithMessage(source: 'command' | 'quick-action' = 'command') {
  hoverProvider.clearCache();
  await reportWatcher.refresh();
  statusBarManager.refresh();

  const message = buildDiagnosticsRefreshMessage();
  if (message) {
    vscode.window.setStatusBarMessage(message, source === 'command' ? 5000 : 3500);
  }
}

function buildDiagnosticsRefreshMessage(): string | null {
  const report = diagnosticsManager?.getReport?.();
  if (!report) {
    return '$(symbol-event) i18nsmith: Diagnostics refreshed.';
  }

  const actionableItems =
    (report.actionableItems?.length ?? 0) +
    (report.diagnostics?.actionableItems?.length ?? 0) +
    (report.sync?.actionableItems?.length ?? 0);
  const suggestions = report.suggestedCommands?.length ?? 0;
  const missing = report.sync?.missingKeys?.length ?? 0;
  const unused = report.sync?.unusedKeys?.length ?? 0;

  const parts: string[] = ['$(symbol-event) i18nsmith: Diagnostics refreshed'];
  parts.push(`• ${actionableItems} issue${actionableItems === 1 ? '' : 's'}`);
  if (suggestions) {
    parts.push(`• ${suggestions} suggestion${suggestions === 1 ? '' : 's'}`);
  }
  if (missing || unused) {
    parts.push(`• Drift: ${missing} missing / ${unused} unused`);
  }
  return parts.join('  ');
}

async function runHealthCheckWithSummary(options: { revealOutput?: boolean } = {}) {
  if (!smartScanner) {
    return;
  }

  if (options.revealOutput) {
    smartScanner.showOutput();
  }

  const result = await smartScanner.scan('manual');
  await reportWatcher?.refresh();
  await showHealthCheckSummary(result);
}

async function showHealthCheckSummary(result: ScanResult | null) {
  if (!smartScanner) {
    return;
  }

  const summary = buildHealthCheckSummary(result);
  if (!summary) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    summary.title,
    { detail: summary.detail },
    'View Quick Actions',
    'Show Output'
  );

  if (choice === 'View Quick Actions') {
    await vscode.commands.executeCommand('i18nsmith.actions');
    return;
  }

  if (choice === 'Show Output') {
    smartScanner.showOutput();
  }
}

function buildHealthCheckSummary(result: ScanResult | null): { title: string; detail: string } | null {
  const report = diagnosticsManager?.getReport?.();
  const actionableItems = [
    ...(report?.actionableItems ?? []),
    ...(report?.diagnostics?.actionableItems ?? []),
    ...(report?.sync?.actionableItems ?? []),
  ];

  const filesWithIssues = new Set(
    actionableItems
      .map((item) => item.filePath)
      .filter((filePath): filePath is string => Boolean(filePath))
  );

  const missingKeys = report?.sync?.missingKeys?.length ?? 0;
  const unusedKeys = report?.sync?.unusedKeys?.length ?? 0;
  const suggestionCount = report?.suggestedCommands?.length ?? 0;
  const issueCount = actionableItems.length || result?.issueCount || 0;

  const title = issueCount
    ? `i18nsmith health check: ${issueCount} issue${issueCount === 1 ? '' : 's'} detected`
    : 'i18nsmith health check: No issues detected';

  const details: string[] = [];
  details.push(`• ${issueCount} actionable item${issueCount === 1 ? '' : 's'}`);
  if (filesWithIssues.size) {
    details.push(`• ${filesWithIssues.size} file${filesWithIssues.size === 1 ? '' : 's'} with diagnostics`);
  }
  if (missingKeys || unusedKeys) {
    details.push(`• Locale drift: ${missingKeys} missing / ${unusedKeys} unused keys`);
  }
  if (suggestionCount) {
    details.push(`• ${suggestionCount} recommended action${suggestionCount === 1 ? '' : 's'} ready in Quick Actions`);
  }
  if (result?.timestamp) {
    details.push(`• Completed at ${result.timestamp.toLocaleTimeString()}`);
  }
  details.push('Select “View Quick Actions” to start fixing the highest-priority issues.');

  return { title, detail: details.join('\n') };
}

export function activate(context: vscode.ExtensionContext) {
  console.log('i18nsmith extension activated');

  verboseOutputChannel = vscode.window.createOutputChannel('i18nsmith (Verbose)');
  context.subscriptions.push(verboseOutputChannel);
  cliOutputChannel = vscode.window.createOutputChannel('i18nsmith CLI');
  context.subscriptions.push(cliOutputChannel);
  previewManager = new PreviewManager(cliOutputChannel);

  // Ensure .gitignore has i18nsmith artifacts listed (non-blocking)
  ensureGitignoreEntries();

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
  diffPeekProvider = new DiffPeekProvider();

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
      await runHealthCheckWithSummary({ revealOutput: true });
    }),
    vscode.commands.registerCommand('i18nsmith.sync', async () => {
      await runSync({ dryRunOnly: false });
    }),
    vscode.commands.registerCommand('i18nsmith.syncFile', async () => {
      await syncCurrentFile();
    }),
    vscode.commands.registerCommand('i18nsmith.refreshDiagnostics', async () => {
      await refreshDiagnosticsWithMessage('command');
    }),
    vscode.commands.registerCommand('i18nsmith.addPlaceholder', async (key: string, workspaceRoot: string) => {
      await addPlaceholderWithPreview(key, workspaceRoot);
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

  console.log('[i18nsmith] Commands registered successfully');

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
  const fileIssues = summary.actionableItems.filter((item) => item.filePath === editor.document.uri.fsPath);
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
  console.log("[i18nsmith] renameSuspiciousKey called with:", { originalKey, newKey });
  await runRenameCommand({ from: originalKey, to: newKey });
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

interface TranslatePreviewSummary {
  provider: string;
  dryRun: boolean;
  plan: TranslationPlan;
  totalCharacters: number;
}

async function runSync(options: { targets?: string[]; dryRunOnly?: boolean } = {}) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const manager = ensurePreviewManager();
  logVerbose(`runSync: Starting preview for ${options.targets?.length ?? 'all'} target(s)`);

  const previewArgs = buildSyncPreviewArgs(options.targets);
  const previewResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.dryRunOnly ? 'i18nsmith: Gathering sync preview…' : 'i18nsmith: Preparing sync…',
      cancellable: false,
    },
    () =>
  manager.run<SyncSummary>({
        kind: 'sync',
        args: previewArgs,
        workspaceRoot: workspaceFolder.uri.fsPath,
        label: options.targets?.length ? 'sync --target preview' : 'sync preview',
      })
  );

  const summary = previewResult.payload.summary;
  const relativePreviewPath = path.relative(workspaceFolder.uri.fsPath, previewResult.previewPath);
  logVerbose(`runSync: Preview complete (${relativePreviewPath})`);
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

  // Show diff preview if available
  if (summary.diffs && summary.diffs.length > 0) {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await diffPeekProvider.showDiffPeek(editor, summary.diffs, 'Sync Preview');
    }

    const applyChoice = await vscode.window.showInformationMessage(
      `Apply ${selection.missing.length + selection.unused.length} locale changes?`,
      'Apply'
    );
    
    if (applyChoice !== 'Apply') {
      logVerbose('runSync: User cancelled after viewing diff preview');
      return;
    }
  } else {
    // Fallback if no diffs available
    const applyChoice = await vscode.window.showInformationMessage(
      `Apply ${selection.missing.length + selection.unused.length} locale changes?`,
      'Apply'
    );
    
    if (applyChoice !== 'Apply') {
      logVerbose('runSync: User cancelled');
      return;
    }
  }

  logVerbose(`runSync: Applying ${selection.missing.length} missing, ${selection.unused.length} unused via CLI preview apply`);

  const selectionFilePath = await writeSyncSelectionFile(workspaceFolder.uri.fsPath, selection);
  const applyCommand = buildSyncApplyCommand(
    previewResult.previewPath,
    selectionFilePath,
    workspaceFolder.uri.fsPath
  );

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Applying locale changes…',
      cancellable: false,
    },
    () => runCliCommand(applyCommand)
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

function buildSyncPreviewArgs(targets?: string[]): string[] {
  if (!targets?.length) {
    return [];
  }

  const args: string[] = [];
  for (const target of targets) {
    args.push('--target', quoteCliArg(target));
  }
  return args;
}

function buildSyncApplyCommand(previewPath: string, selectionPath: string, workspaceRoot: string): string {
  const previewArg = normalizeTargetForCli(previewPath, workspaceRoot);
  const selectionArg = normalizeTargetForCli(selectionPath, workspaceRoot);
  return [
    'i18nsmith sync',
    '--apply-preview',
    quoteCliArg(previewArg),
    '--selection-file',
    quoteCliArg(selectionArg),
  ].join(' ');
}

async function writeSyncSelectionFile(workspaceRoot: string, selection: SyncSelectionResult): Promise<string> {
  const previewDir = path.join(workspaceRoot, '.i18nsmith', 'previews');
  await fs.promises.mkdir(previewDir, { recursive: true });
  const filePath = path.join(previewDir, `sync-selection-${Date.now()}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(selection, null, 2), 'utf8');
  return filePath;
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

  if (summary.missingKeys.length) {
    items.push({
      label: `Missing keys (${summary.missingKeys.length}) — toggle entries to add locales`,
      kind: vscode.QuickPickItemKind.Separator,
      bucket: 'missing',
      key: '',
    } as SyncQuickPickItem);
  }

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

  if (summary.unusedKeys.length) {
    items.push({
      label: `Unused keys (${summary.unusedKeys.length}) — toggle entries to prune`,
      kind: vscode.QuickPickItemKind.Separator,
      bucket: 'unused',
      key: '',
    } as SyncQuickPickItem);
  }

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

  const absolutePath = editor.document.uri.fsPath;
  const relativeTarget = normalizeTargetForCli(absolutePath, workspaceFolder.uri.fsPath);
  await runTransformCommand({
    targets: [relativeTarget],
    label: path.basename(editor.document.uri.fsPath),
    workspaceFolder,
  });
}

interface TransformRunOptions {
  targets?: string[];
  label?: string;
  workspaceFolder?: vscode.WorkspaceFolder;
}

interface TranslateRunOptions {
  locales?: string[];
  provider?: string;
  force?: boolean;
  skipEmpty?: boolean;
  strictPlaceholders?: boolean;
  estimate?: boolean;
}

async function runTransformCommand(options: TransformRunOptions = {}) {
  const workspaceFolder = options.workspaceFolder ?? vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const manager = ensurePreviewManager();
  const baseArgs = buildTransformTargetArgs(options.targets ?? []);
  const label = options.label ?? (options.targets?.length === 1 ? options.targets[0] : 'workspace');

  logVerbose(`runTransformCommand: Starting preview for ${label}`);

  const previewResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Analyzing transform candidates…',
      cancellable: false,
    },
    () =>
      manager.run<TransformSummary>({
        kind: 'transform',
        args: baseArgs,
        workspaceRoot: workspaceFolder.uri.fsPath,
        label: `transform preview (${label})`,
      })
  );

  const preview = previewResult.payload.summary;
  const transformable = preview.candidates.filter(
    (candidate: TransformCandidate) => candidate.status === 'pending' || candidate.status === 'existing'
  );

  logVerbose(`runTransformCommand: Preview complete - ${transformable.length} transformable candidates`);
  logVerbose(`runTransformCommand: Preview stored at ${previewResult.previewPath}`);
  
  if (!transformable.length) {
    let message = options.targets?.length === 1
      ? 'No transformable strings found in the selected target.'
      : 'No transformable strings found.';
    if (preview.filesScanned === 0 && options.targets?.length === 1) {
      message += '\n\n⚠️ Target was not scanned. This might be because:';
      message += '\n• The file is not in your i18n.config.json "include" patterns';
      message += '\n• The file extension is not supported (.tsx, .jsx, .ts, .js)';
      message += `\n\nTarget: ${options.targets[0]}`;
      message += `\n\nTry adding the file pattern to your include array in i18n.config.json`;
    } else if (preview.skippedFiles.length > 0) {
      const skipped = preview.skippedFiles[0];
      message += `\n\nReason: ${skipped.reason}`;
    } else if (preview.candidates.length > 0) {
      message += '\n\nAll candidates were filtered out (already translated, duplicates, or too short).';
    }
    vscode.window.showWarningMessage(message);
    return;
  }

  const multiPassTip = 'Tip: Transform runs are incremental. After applying, rerun the command to keep processing remaining candidates.';
  const detail = `${formatTransformPreview(preview)}\n\n${multiPassTip}`;
  const buttons = preview.diffs && preview.diffs.length > 0
    ? ['Apply', 'Preview Diff', 'Dry Run Only']
    : ['Apply', 'Dry Run Only'];
  
  const choice = await vscode.window.showInformationMessage(
    `Transform ${transformable.length} candidate${transformable.length === 1 ? '' : 's'} in ${label}?`,
    { modal: true, detail },
    ...buttons
  );

  if (!choice) {
    logVerbose('runTransformCommand: User cancelled');
    return;
  }

  if (choice === 'Preview Diff') {
    logVerbose('runTransformCommand: Showing diff preview');
  await showTransformDiff(preview);
    
    const applyChoice = await vscode.window.showInformationMessage(
      `Apply transform to ${label}?`,
      { modal: true, detail },
      'Apply'
    );
    
    if (applyChoice !== 'Apply') {
      logVerbose('runTransformCommand: User cancelled after viewing diff');
      return;
    }
  } else if (choice === 'Dry Run Only') {
    logVerbose('runTransformCommand: Dry run only, showing preview');
    vscode.window.showInformationMessage(`Preview only. Re-run the command and choose Apply to write changes.`, { detail });
    return;
  }

  logVerbose(`runTransformCommand: Applying ${transformable.length} transformations via CLI`);

  await runCliCommand(buildTransformWriteCommand(baseArgs));

  hoverProvider.clearCache();
  await reportWatcher.refresh();
  await smartScanner.scan('transform');

  vscode.window.showInformationMessage(
    `Applied ${transformable.length} safe transform${transformable.length === 1 ? '' : 's'}. Rerun the transform command if more hardcoded strings remain.`
  );
}

async function showTransformDiff(summary: TransformSummary) {
  if (!summary.diffs || summary.diffs.length === 0) {
    vscode.window.showInformationMessage('No diffs available for preview.');
    return;
  }

  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    const doc = await vscode.workspace.openTextDocument({ content: '', language: 'plaintext' });
    editor = await vscode.window.showTextDocument(doc, { preview: true });
  }

  if (!editor) {
    vscode.window.showWarningMessage('Open a file to show diff previews.');
    return;
  }

  await diffPeekProvider.showDiffPeek(editor, summary.diffs, 'Transform Preview');
}

async function runRenameCommand(options: { from: string; to: string }) {
  const { from, to } = options;
  if (!from || !to || from === to) {
    vscode.window.showWarningMessage('Provide distinct keys to rename.');
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const manager = ensurePreviewManager();
  const args = buildRenameArgs(from, to);

  logVerbose(`runRenameCommand: Previewing rename ${from} → ${to}`);

  const previewResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Evaluating rename…',
      cancellable: false,
    },
    () =>
      manager.run<KeyRenameSummary>({
        kind: 'rename-key',
        args,
        workspaceRoot: workspaceFolder.uri.fsPath,
        label: `rename-key preview (${from} → ${to})`,
      })
  );

  const summary = previewResult.payload.summary;
  if (!summary.occurrences) {
    vscode.window.showWarningMessage(`No usages of "${from}" were detected.`);
    return;
  }

  const detail = formatRenamePreview(summary, from, to);
  const buttons = summary.diffs?.length ? ['Apply', 'Show Diff', 'Dry Run Only'] : ['Apply', 'Dry Run Only'];
  const choice = await vscode.window.showInformationMessage(
    `Rename ${from} → ${to}?`,
    { modal: true, detail },
    ...buttons
  );

  if (!choice) {
    logVerbose('runRenameCommand: User cancelled');
    return;
  }

  if (choice === 'Show Diff') {
    await showSourceDiffPreview(summary.diffs ?? [], 'Rename Preview');
    const applyChoice = await vscode.window.showInformationMessage(
      `Apply rename ${from} → ${to}?`,
      { modal: true, detail },
      'Apply'
    );
    if (applyChoice !== 'Apply') {
      return;
    }
  } else if (choice === 'Dry Run Only') {
    vscode.window.showInformationMessage('Preview only. Run again and choose Apply to write changes.', { detail });
    return;
  }

  await runCliCommand(buildRenameWriteCommand(from, to));
  hoverProvider.clearCache();
  await reportWatcher.refresh();
  await smartScanner.scan('rename');
}

function formatRenamePreview(summary: KeyRenameSummary, from: string, to: string): string {
  const lines: string[] = [];
  lines.push(`• ${summary.occurrences} source occurrence${summary.occurrences === 1 ? '' : 's'}`);
  lines.push(`• ${summary.filesUpdated.length} source file${summary.filesUpdated.length === 1 ? '' : 's'} to update`);
  if (summary.localePreview.length) {
    const duplicates = summary.localePreview.filter((preview) => preview.duplicate);
    const missing = summary.localePreview.filter((preview) => preview.missing);
    if (duplicates.length) {
      const sample = duplicates.slice(0, 3).map((preview) => preview.locale).join(', ');
      lines.push(`• ${duplicates.length} locale${duplicates.length === 1 ? '' : 's'} already have "${to}" (${sample}${duplicates.length > 3 ? '…' : ''})`);
    }
    if (missing.length) {
      const sample = missing.slice(0, 3).map((preview) => preview.locale).join(', ');
      lines.push(`• ${missing.length} locale${missing.length === 1 ? '' : 's'} are missing "${from}" (${sample}${missing.length > 3 ? '…' : ''})`);
    }
  }
  if (summary.actionableItems.length) {
    const highPriority = summary.actionableItems.slice(0, 3).map((item) => `• ${item.message}`);
    lines.push(...highPriority);
  }
  return lines.join('\n');
}

async function showSourceDiffPreview(diffs: SourceFileDiffEntry[], title: string) {
  if (!diffs.length) {
    vscode.window.showInformationMessage('No source diffs available.');
    return;
  }

  const lines: string[] = [`# ${title}`, ''];
  for (const diff of diffs) {
    lines.push(`## ${diff.relativePath}`);
    lines.push('```diff');
    lines.push(diff.diff.trim());
    lines.push('```');
    lines.push('');
  }

  const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function runTranslateCommand(options: TranslateRunOptions = {}) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const manager = ensurePreviewManager();
  const baseArgs = buildTranslateArgs(options);

  logVerbose('runTranslateCommand: Starting preview');

  const previewResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Gathering translation preview…',
      cancellable: false,
    },
    () =>
      manager.run<TranslatePreviewSummary>({
        kind: 'translate',
        args: baseArgs,
        workspaceRoot: workspaceFolder.uri.fsPath,
        label: 'translate preview',
      })
  );

  const summary = previewResult.payload.summary;
  if (!summary.plan?.totalTasks) {
    vscode.window.showInformationMessage('No missing translations detected.');
    return;
  }

  const detail = formatTranslatePreview(summary);
  const choice = await vscode.window.showInformationMessage(
    `Translate ${summary.plan.totalTasks} key${summary.plan.totalTasks === 1 ? '' : 's'} via ${summary.provider}?`,
    { modal: true, detail },
    'Apply',
    'Dry Run Only'
  );

  if (!choice) {
    logVerbose('runTranslateCommand: User cancelled');
    return;
  }

  if (choice === 'Dry Run Only') {
    vscode.window.showInformationMessage('Preview only. Run again and choose Apply to write changes.', { detail });
    return;
  }

  await runCliCommand(buildTranslateWriteCommand(baseArgs));
  hoverProvider.clearCache();
  await reportWatcher.refresh();
  await smartScanner.scan('translate');
}

function formatTranslatePreview(summary: TranslatePreviewSummary): string {
  const lines: string[] = [];
  const localePlans = summary.plan?.locales ?? [];
  lines.push(`• ${summary.plan.totalTasks} task${summary.plan.totalTasks === 1 ? '' : 's'}`);
  lines.push(`• ${localePlans.length} locale${localePlans.length === 1 ? '' : 's'} (${localePlans.map((plan) => `${plan.locale}: ${plan.tasks.length}`).slice(0, 3).join(', ')}${localePlans.length > 3 ? '…' : ''})`);
  lines.push(`• ${summary.totalCharacters ?? summary.plan.totalCharacters} characters`);
  return lines.join('\n');
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
  console.log("[i18nsmith] extractKeyFromSelection called with:", { uri: uri.fsPath, range, text });

  const document = await vscode.workspace.openTextDocument(uri);
  const selectionText = document.getText(range) || text;
  const normalizedSelection = selectionText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 30);

  const key = await vscode.window.showInputBox({
    prompt: 'Enter the translation key',
    value: `common.${normalizedSelection}`,
    placeHolder: 'e.g., common.greeting',
  });

  if (!key) {
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  let meta: Awaited<ReturnType<typeof loadConfigWithMeta>>;
  try {
    meta = await loadConfigWithMeta(undefined, { cwd: workspaceFolder.uri.fsPath });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to load i18nsmith config: ${error}`);
    return;
  }

  const literalValue = normalizeSelectedLiteral(selectionText || text);
  const wrapInJsx = shouldWrapSelectionInJsx(document, range, selectionText);
  const replacement = wrapInJsx ? `{t('${key}')}` : `t('${key}')`;

  const sourceChange = await createSourceFilePreviewChange(document, range, replacement, workspaceFolder.uri.fsPath);

  const localeValues = new Map<string, string>();
  const sourceLocale = meta.config.sourceLanguage ?? 'en';
  localeValues.set(sourceLocale, literalValue);
  const placeholderSeed = meta.config.sync?.seedValue ?? `[TODO: ${key}]`;
  for (const locale of meta.config.targetLanguages ?? []) {
    if (!locale || localeValues.has(locale)) {
      continue;
    }
    localeValues.set(locale, placeholderSeed);
  }

  const localePlan = await createLocalePreviewPlan(meta, key, localeValues, { primaryLocale: sourceLocale });
  if (!localePlan) {
    await sourceChange.cleanup();
    vscode.window.showWarningMessage(`Key '${key}' already exists in the configured locale files.`);
    return;
  }

  const cleanupTasks = [sourceChange.cleanup, localePlan.cleanup];
  const detailLines = [
    `Key: ${key}`,
    `Source file: ${sourceChange.relativePath}`,
    `Locales: ${Array.from(localeValues.keys()).join(', ')}`,
    ...localePlan.detailLines.slice(1),
  ];

  const applied = await executePreviewPlan({
    title: 'Extract selection as translation key',
    detail: detailLines.join('\n'),
    changes: [sourceChange.change, ...localePlan.changes],
    cleanup: async () => {
      await Promise.all(cleanupTasks.map((fn) => fn().catch(() => {})));
    },
  });

  if (!applied) {
    return;
  }

  hoverProvider.clearCache();
  reportWatcher.refresh();
  vscode.window.showInformationMessage(`Extracted as '${key}'`);
}

async function addPlaceholderWithPreview(key: string, workspaceRoot?: string): Promise<void> {
  const workspacePath = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspacePath) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  let meta: Awaited<ReturnType<typeof loadConfigWithMeta>>;
  try {
    meta = await loadConfigWithMeta(undefined, { cwd: workspacePath });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to load i18nsmith config: ${error}`);
    return;
  }

  const sourceLocale = meta.config.sourceLanguage ?? 'en';
  const targetLocales = meta.config.targetLanguages ?? [];
  const locales = Array.from(new Set([sourceLocale, ...targetLocales].filter(Boolean))) as string[];

  if (!locales.length) {
    vscode.window.showWarningMessage('No locales defined in i18n.config.json.');
    return;
  }

  const placeholderValue = meta.config.sync?.seedValue ?? `[TODO: ${key}]`;
  const localeValues = new Map<string, string>();
  for (const locale of locales) {
    localeValues.set(locale, placeholderValue);
  }

  const localePlan = await createLocalePreviewPlan(meta, key, localeValues, { primaryLocale: sourceLocale });
  if (!localePlan) {
    vscode.window.showInformationMessage(`Key '${key}' already exists in the configured locale files.`);
    return;
  }

  const detail = [`Key: ${key}`, ...localePlan.detailLines].join('\n');
  const applied = await executePreviewPlan({
    title: `Add placeholder for ${key}`,
    detail,
    changes: localePlan.changes,
    cleanup: localePlan.cleanup,
  });

  if (!applied) {
    return;
  }

  hoverProvider.clearCache();
  reportWatcher.refresh();

  if (localePlan.primaryLocalePath) {
    const doc = await vscode.workspace.openTextDocument(localePlan.primaryLocalePath);
    await vscode.window.showTextDocument(doc);
  }

  vscode.window.showInformationMessage(`Placeholder added for '${key}'`);
}

function normalizeSelectedLiteral(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return input;
  }

  const quote = trimmed[0];
  if ((quote === '"' || quote === '\'' || quote === '`') && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }

  return input;
}

interface SourcePreviewPlan {
  change: PlannedChange;
  cleanup: () => Promise<void>;
  relativePath: string;
}

async function createSourceFilePreviewChange(
  document: vscode.TextDocument,
  range: vscode.Range,
  replacement: string,
  workspaceRoot?: string
): Promise<SourcePreviewPlan> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-extract-source-'));
  const baseName = path.basename(document.uri.fsPath) || 'source';
  const beforePath = path.join(tempDir, `before-${baseName}`);
  const afterPath = path.join(tempDir, `after-${baseName}`);
  const beforeText = document.getText();
  const startOffset = document.offsetAt(range.start);
  const endOffset = document.offsetAt(range.end);
  const afterText = beforeText.slice(0, startOffset) + replacement + beforeText.slice(endOffset);

  await fsp.writeFile(beforePath, beforeText, 'utf8');
  await fsp.writeFile(afterPath, afterText, 'utf8');

  const relativePath = workspaceRoot ? path.relative(workspaceRoot, document.uri.fsPath) : document.uri.fsPath;

  const change: PlannedChange = {
    label: relativePath,
    beforeUri: vscode.Uri.file(beforePath),
    afterUri: vscode.Uri.file(afterPath),
    summary: 'Source',
    apply: async () => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, range, replacement);
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        throw new Error('Failed to update source file.');
      }
    },
  };

  const cleanup = async () => {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  };

  return { change, cleanup, relativePath };
}

interface LocalePreviewPlanResult {
  changes: PlannedChange[];
  cleanup: () => Promise<void>;
  detailLines: string[];
  primaryLocalePath?: string;
}

async function createLocalePreviewPlan(
  meta: Awaited<ReturnType<typeof loadConfigWithMeta>>,
  key: string,
  localeValues: Map<string, string>,
  options: { primaryLocale?: string } = {}
): Promise<LocalePreviewPlanResult | null> {
  if (!localeValues.size) {
    return null;
  }

  const localesDir = path.join(meta.projectRoot, meta.config.localesDir ?? 'locales');
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-locale-preview-'));
  const previewLocalesDir = path.join(tempRoot, 'locales');
  await fsp.mkdir(previewLocalesDir, { recursive: true });

  const store = new LocaleStore(previewLocalesDir, {
    format: meta.config.locales?.format ?? 'auto',
    delimiter: meta.config.locales?.delimiter ?? '.',
    sortKeys: meta.config.locales?.sortKeys ?? 'alphabetical',
  });

  const beforeSnapshots = new Map<string, string>();

  for (const locale of localeValues.keys()) {
    const originalPath = path.join(localesDir, `${locale}.json`);
    let originalContent: string;
    try {
      originalContent = await fsp.readFile(originalPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        originalContent = '{}\n';
      } else {
        await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }

    beforeSnapshots.set(locale, originalContent);
    const previewPath = path.join(previewLocalesDir, `${locale}.json`);
    await fsp.mkdir(path.dirname(previewPath), { recursive: true });
    await fsp.writeFile(previewPath, originalContent, 'utf8');
  }

  for (const [locale, value] of localeValues) {
    await store.upsert(locale, key, value);
  }
  await store.flush();

  const changes: PlannedChange[] = [];
  const detailLines: string[] = ['Locale files:'];

  for (const locale of localeValues.keys()) {
    const previewPath = path.join(previewLocalesDir, `${locale}.json`);
    const afterContent = await fsp.readFile(previewPath, 'utf8');
    const beforeContent = beforeSnapshots.get(locale) ?? '{}\n';
    if (beforeContent === afterContent) {
      continue;
    }

    const beforePath = path.join(previewLocalesDir, `${locale}.before.json`);
    await fsp.writeFile(beforePath, beforeContent, 'utf8');

    const targetPath = path.join(localesDir, `${locale}.json`);
    const relativeLabel = path.relative(meta.projectRoot, targetPath);
    detailLines.push(`• ${relativeLabel}`);

    changes.push({
      label: relativeLabel,
      beforeUri: vscode.Uri.file(beforePath),
      afterUri: vscode.Uri.file(previewPath),
      summary: locale,
      apply: async () => {
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.writeFile(targetPath, afterContent, 'utf8');
      },
    });
  }

  if (!changes.length) {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  const cleanup = async () => {
    await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  };

  const primaryLocale = options.primaryLocale;
  const primaryLocalePath = primaryLocale ? path.join(localesDir, `${primaryLocale}.json`) : undefined;

  return { changes, cleanup, detailLines, primaryLocalePath };
}

type DiagnosticsReport = {
  sync?: {
    missingKeys?: unknown[];
    unusedKeys?: unknown[];
  };
};

function getDriftStatistics(report: unknown): { missing: number; unused: number } | null {
  if (!report || typeof report !== 'object' || report === null) {
    return null;
  }

  const drift = (report as DiagnosticsReport).sync;
  if (!drift) {
    return null;
  }

  const missing = Array.isArray(drift.missingKeys) ? drift.missingKeys.length : 0;
  const unused = Array.isArray(drift.unusedKeys) ? drift.unusedKeys.length : 0;

  if (missing === 0 && unused === 0) {
    return null;
  }

  return { missing, unused };
}

function formatPreviewIntentDetail(intent: PreviewableCommand, originalCommand: string): string {
  const lines: string[] = [];
  if (intent.kind === 'sync') {
    lines.push('Preview & apply locale fixes via VS Code sync flow.');
    if (intent.targets?.length) {
      lines.push(`Targets: ${intent.targets.join(', ')}`);
    } else {
      lines.push('Targets: Workspace');
    }
  } else if (intent.kind === 'transform') {
    lines.push('Preview transform candidates with diff controls before applying changes.');
    if (intent.targets?.length) {
      lines.push(`Targets: ${intent.targets.join(', ')}`);
    }
  } else if (intent.kind === 'rename-key') {
    lines.push(`Preview rename flow for ${intent.from} → ${intent.to}.`);
  } else if (intent.kind === 'translate') {
    lines.push('Preview translation estimates and apply via translate flow.');
    if (intent.options.locales?.length) {
      lines.push(`Locales: ${intent.options.locales.join(', ')}`);
    }
    if (intent.options.provider) {
      lines.push(`Provider: ${intent.options.provider}`);
    }
  }

  lines.push(`Original CLI: ${originalCommand}`);
  return lines.join('\n');
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
      const previewIntent = parsePreviewableCommand(sc.command) ?? undefined;
      const detail = previewIntent
        ? formatPreviewIntentDetail(previewIntent, sc.command)
        : sc.command;
      if (!hasApplySuggestion && /sync\b[\s\S]*--write/.test(sc.command)) {
        hasApplySuggestion = true;
      }
      picks.push({
        label: `$(rocket) ${sc.label}`,
        description: sc.reason || '',
        detail,
        previewIntent,
        command: previewIntent ? undefined : sc.command,
        interactive: previewIntent ? false : interactive,
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
  let syncDescription = 'Review detected drift, then selectively apply locale fixes';
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
      description: 'Preview safe transforms (rerun after apply to continue)',
      command: 'i18nsmith.transformFile',
    },
    {
      label: '$(sync) Run Health Check',
      description: 'Run i18nsmith check (background)',
      builtin: 'run-check',
    }
  );

  picks.push(
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

  if (choice.previewIntent) {
    await executePreviewIntent(choice.previewIntent);
    return;
  }

  if (choice.command) {
    // Check if it's a VS Code command or a CLI command
    if (choice.command.startsWith('i18nsmith.')) {
      await vscode.commands.executeCommand(choice.command);
    } else {
      const handled = await tryHandlePreviewableCommand(choice.command);
      if (!handled) {
        await runCliCommand(choice.command, {
          interactive: choice.interactive,
          confirmMessage: choice.confirmMessage,
        });
      }
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
      await runHealthCheckWithSummary();
      break;
    }
    case 'refresh': {
      await refreshDiagnosticsWithMessage('quick-action');
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

type PreviewableCommand =
  | {
      kind: 'sync' | 'transform';
      targets?: string[];
    }
  | {
      kind: 'rename-key';
      from: string;
      to: string;
    }
  | {
      kind: 'translate';
      options: TranslateRunOptions;
    };

async function tryHandlePreviewableCommand(rawCommand: string): Promise<boolean> {
  const parsed = parsePreviewableCommand(rawCommand);
  if (!parsed) {
    return false;
  }

  await executePreviewIntent(parsed);
  return true;
}

async function executePreviewIntent(intent: PreviewableCommand): Promise<void> {
  if (intent.kind === 'sync') {
    await runSync({ targets: intent.targets });
    return;
  }

  if (intent.kind === 'transform') {
    await runTransformCommand({ targets: intent.targets });
    return;
  }

  if (intent.kind === 'rename-key') {
    await runRenameCommand({ from: intent.from, to: intent.to });
    return;
  }

  if (intent.kind === 'translate') {
    await runTranslateCommand(intent.options);
  }
}

function parsePreviewableCommand(rawCommand: string): PreviewableCommand | null {
  const tokens = tokenizeCliCommand(rawCommand);
  if (!tokens.length) {
    return null;
  }

  const cliIndex = tokens.findIndex((token) => token === 'i18nsmith');
  if (cliIndex === -1 || cliIndex + 1 >= tokens.length) {
    return null;
  }

  const kind = tokens[cliIndex + 1];
  const args = tokens.slice(cliIndex + 2);

  if (kind === 'sync' || kind === 'transform') {
    const targets = parseTargetArgs(args);
    return {
      kind,
      targets: targets.length ? targets : undefined,
    };
  }

  if (kind === 'rename-key') {
    const renameArgs = parseRenameArgs(args);
    if (!renameArgs) {
      return null;
    }
    return { kind: 'rename-key', ...renameArgs };
  }

  if (kind === 'translate') {
    const translateOptions = parseTranslateOptions(args);
    if (!translateOptions) {
      return null;
    }
    return { kind: 'translate', options: translateOptions };
  }

  return null;
}

function parseTargetArgs(args: string[]): string[] {
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--target' && args[i + 1]) {
      targets.push(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--target=')) {
      const value = arg.slice('--target='.length);
      if (value) {
        targets.push(value);
      }
    }
  }
  return targets;
}

function parseRenameArgs(args: string[]): { from: string; to: string } | null {
  const positionals = args.filter((arg) => !arg.startsWith('-'));
  if (positionals.length < 2) {
    return null;
  }
  const [from, to] = positionals;
  if (!from || !to || from === to) {
    return null;
  }
  return { from, to };
}

function parseTranslateOptions(args: string[]): TranslateRunOptions | null {
  const options: TranslateRunOptions = {};
  const locales: string[] = [];

  const addLocales = (value: string) => {
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((locale) => locales.push(locale));
  };

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith('-')) {
      continue;
    }

    if (token === '--write' || token === '--yes' || token === '-y') {
      continue;
    }

    if (token === '--force') {
      options.force = true;
      continue;
    }

    if (token === '--estimate') {
      options.estimate = true;
      continue;
    }

    if (token === '--strict-placeholders') {
      options.strictPlaceholders = true;
      continue;
    }

    if (token === '--no-skip-empty') {
      options.skipEmpty = false;
      continue;
    }

    if (token === '--locales') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return null;
      }
      addLocales(value);
      i += 1;
      continue;
    }

    if (token.startsWith('--locales=')) {
      addLocales(token.slice('--locales='.length));
      continue;
    }

    if (token === '--provider') {
      const value = args[i + 1];
      if (!value || value.startsWith('-')) {
        return null;
      }
      options.provider = value;
      i += 1;
      continue;
    }

    if (token.startsWith('--provider=')) {
      options.provider = token.slice('--provider='.length);
      continue;
    }

    if (token === '--preview-output' || token.startsWith('--preview-output=')) {
      return null;
    }

    if (token === '--report' || token.startsWith('--report=')) {
      return null;
    }

    if (token === '--json') {
      return null;
    }

    if (token === '--export' || token.startsWith('--export=')) {
      return null;
    }

    if (token === '--import' || token.startsWith('--import=')) {
      return null;
    }

    if (token === '--config' || token === '-c' || token.startsWith('--config=')) {
      return null;
    }

    // Unknown option - bail so we delegate to raw CLI execution
    if (token.startsWith('-')) {
      return null;
    }
  }

  if (locales.length) {
    options.locales = locales;
  }

  return options;
}

function tokenizeCliCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;

  const pushToken = () => {
    if (current.length) {
      tokens.push(current);
      current = '';
    }
  };

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
      if (char === quote) {
        pushToken();
        quote = null;
      } else if (char === '\\' && i + 1 < command.length) {
        i += 1;
        current += command[i];
      } else {
        current += char;
      }
    } else {
      if (char === '"' || char === "'") {
        quote = char;
        if (current.length) {
          pushToken();
        }
      } else if (/\s/.test(char)) {
        pushToken();
      } else {
        current += char;
      }
    }
  }

  if (quote) {
    pushToken();
  }

  pushToken();
  return tokens;
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

  const command = resolveCliCommand(rawCommand);

  if (options.confirmMessage || options.interactive) {
    const detailLines: string[] = [];
    if (options.confirmMessage) {
      detailLines.push(options.confirmMessage);
    }
    if (options.interactive) {
      detailLines.push('This command may scaffold files or install dependencies and will run in the i18nsmith terminal.');
    }
    detailLines.push('', `Command: ${command}`);
    const confirmLabel = options.interactive ? 'Run Command' : 'Continue';
    const choice = await vscode.window.showWarningMessage(
      options.interactive ? 'Run interactive i18nsmith command?' : 'Run i18nsmith command?',
      { modal: true, detail: detailLines.join('\n') },
      confirmLabel
    );
    if (choice !== confirmLabel) {
      return;
    }
  }

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

function ensurePreviewManager(): PreviewManager {
  if (!cliOutputChannel) {
    cliOutputChannel = vscode.window.createOutputChannel('i18nsmith CLI');
  }
  if (!previewManager) {
    previewManager = new PreviewManager(cliOutputChannel);
  }
  return previewManager;
}

function normalizeTargetForCli(absolutePath: string, workspaceRoot: string): string {
  const relative = path.relative(workspaceRoot, absolutePath);
  if (!relative || relative.startsWith('..')) {
    return absolutePath;
  }
  return relative.split(path.sep).join(path.posix.sep);
}

function buildTransformTargetArgs(targets: string | string[]): string[] {
  const list = Array.isArray(targets) ? targets : [targets];
  const args: string[] = [];
  for (const target of list) {
    if (!target) {
      continue;
    }
    args.push('--target', quoteCliArg(target));
  }
  return args;
}

function buildTransformWriteCommand(baseArgs: string[]): string {
  const parts = ['i18nsmith transform', ...baseArgs, '--write', '--json'].filter(Boolean);
  return parts.join(' ');
}

function buildRenameArgs(from: string, to: string): string[] {
  return [quoteCliArg(from), quoteCliArg(to), '--diff'];
}

function buildRenameWriteCommand(from: string, to: string): string {
  return ['i18nsmith rename-key', quoteCliArg(from), quoteCliArg(to), '--write', '--json'].join(' ');
}

function buildTranslateArgs(options: TranslateRunOptions): string[] {
  const args: string[] = [];
  if (options.locales?.length) {
    args.push('--locales', ...options.locales.map((locale) => quoteCliArg(locale)));
  }
  if (options.provider) {
    args.push('--provider', quoteCliArg(options.provider));
  }
  if (options.force) {
    args.push('--force');
  }
  if (options.skipEmpty === false) {
    args.push('--no-skip-empty');
  }
  if (options.strictPlaceholders) {
    args.push('--strict-placeholders');
  }
  if (options.estimate) {
    args.push('--estimate');
  }
  return args;
}

function buildTranslateWriteCommand(baseArgs: string[]): string {
  const parts = ['i18nsmith translate', ...baseArgs, '--write', '--yes', '--json'];
  return parts.join(' ');
}

function ensureInteractiveTerminal(cwd: string): vscode.Terminal {
  if (!interactiveTerminal) {
    interactiveTerminal = vscode.window.createTerminal({ name: 'i18nsmith tasks', cwd });
  }
  return interactiveTerminal;
}

async function insertIgnoreComment(uri: vscode.Uri, line: number, rule: string) {
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
  await runRenameCommand({ from: key, to: newKey });
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

/**
 * Ensures .gitignore has i18nsmith artifact entries.
 * Runs silently in background on activation.
 */
async function ensureGitignoreEntries(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return;
  }

  try {
    const result = await ensureGitignore(workspaceFolder.uri.fsPath);
    if (result.updated && result.added.length > 0) {
      logVerbose(`Added to .gitignore: ${result.added.join(', ')}`);
    }
  } catch (err) {
    // Silently ignore - this is a convenience feature
    logVerbose(`Failed to update .gitignore: ${err}`);
  }
}
