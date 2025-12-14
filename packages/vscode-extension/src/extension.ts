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
import {
  ensureGitignore,
  KeyGenerator,
  loadConfigWithMeta,
  LocaleStore,
  SUSPICIOUS_KEY_REASON_DESCRIPTIONS,
} from '@i18nsmith/core';
import type {
  SyncSummary,
  MissingKeyRecord,
  UnusedKeyRecord,
  KeyRenameSummary,
  SourceFileDiffEntry,
  TranslationPlan,
  I18nConfig,
  DynamicKeyWarning,
  SuspiciousKeyWarning,
  SuspiciousKeyReason,
  LocaleDiffEntry,
} from '@i18nsmith/core';
import type { TransformSummary, TransformCandidate, TransformProgress } from '@i18nsmith/transformer';
import { PreviewManager } from './preview-manager';
import { resolveCliCommand } from './cli-utils';
import {
  buildExportMissingTranslationsCommand,
  buildSyncApplyCommand,
  normalizeTargetForCli,
  quoteCliArg,
} from './command-helpers';
import { executePreviewPlan, type PlannedChange } from './preview-flow';
import {
  deriveWhitelistSuggestions,
  mergeAssumptions,
  normalizeManualAssumption,
  type WhitelistSuggestion,
} from './dynamic-key-whitelist';
import {
  parsePreviewableCommand,
  type PreviewableCommand,
  type TranslateRunOptions,
} from './preview-intents';
import { summarizeReportIssues } from './report-utils';

interface QuickActionPick extends vscode.QuickPickItem {
  command?: string;
  previewIntent?: PreviewableCommand;
  builtin?:
    | 'extract-selection'
    | 'run-check'
    | 'refresh'
    | 'show-output'
    | 'whitelist-dynamic'
    | 'rename-suspicious';
  interactive?: boolean;
  confirmMessage?: string;
}

interface CliRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  warnings: string[];
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
let lastSyncDynamicWarnings: DynamicKeyWarning[] = [];
let lastSyncSuspiciousWarnings: SuspiciousKeyWarning[] = [];
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

  const summary = summarizeReportIssues(report);
  const actionableItems = summary.issueCount;
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
  const summary = summarizeReportIssues(report);
  const actionableItems = summary.items;

  const filesWithIssues = new Set(
    actionableItems
      .map((item) => item.filePath)
      .filter((filePath): filePath is string => Boolean(filePath))
  );

  const missingKeys = report?.sync?.missingKeys?.length ?? 0;
  const unusedKeys = report?.sync?.unusedKeys?.length ?? 0;
  const suggestionCount = report?.suggestedCommands?.length ?? 0;
  const issueCount = summary.issueCount || result?.issueCount || 0;

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
    vscode.commands.registerCommand('i18nsmith.renameSuspiciousKey', async (warning: SuspiciousKeyWarning) => {
      await renameSuspiciousKey(warning);
    }),
    vscode.commands.registerCommand('i18nsmith.renameAllSuspiciousKeys', async () => {
      await renameAllSuspiciousKeys();
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
    }),
    vscode.commands.registerCommand('i18nsmith.exportMissingTranslations', async () => {
      await exportMissingTranslations();
    }),
    vscode.commands.registerCommand('i18nsmith.whitelistDynamicKeys', async () => {
      await whitelistDynamicKeys();
    }),
    vscode.commands.registerCommand('i18nsmith.renameSuspiciousKeysInFile', async (target?: vscode.Uri) => {
      await renameSuspiciousKeysInFile(target);
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

async function renameSuspiciousKey(warning: SuspiciousKeyWarning) {
  if (!warning || typeof warning.key !== 'string') {
    vscode.window.showErrorMessage('Invalid suspicious key reference.');
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  let meta: Awaited<ReturnType<typeof loadConfigWithMeta>>;
  try {
    meta = await loadConfigWithMeta(undefined, { cwd: workspaceFolder.uri.fsPath });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to load i18nsmith config: ${(error as Error).message}`);
    return;
  }

  const existingKeys = await collectExistingTranslationKeys(meta);
  const sanitized = sanitizeSuspiciousWarnings([warning], workspaceFolder.uri.fsPath);
  if (!sanitized.length) {
    vscode.window.showWarningMessage('Unable to normalize suspicious key details.');
    return;
  }

  const renameReport = buildSuspiciousRenameReport(sanitized, meta, existingKeys);
  const proposal = renameReport.safeProposals[0];

  if (!proposal) {
    if (renameReport.conflictProposals.length) {
      vscode.window.showWarningMessage(
        `Cannot auto-rename “${warning.key}” because “${renameReport.conflictProposals[0].proposedKey}” already exists.`
      );
    } else {
      vscode.window.showInformationMessage(`No auto-rename suggestion available for “${warning.key}”.`);
    }
    return;
  }

  await runRenameCommand({ from: proposal.originalKey, to: proposal.proposedKey, invocation: 'quickFix' });
  lastSyncSuspiciousWarnings = [];
}

export function deactivate() {
  console.log('i18nsmith extension deactivated');
}

interface SyncQuickPickItem extends vscode.QuickPickItem {
  bucket: 'missing' | 'unused' | 'blocked';
  key: string;
}

interface WhitelistQuickPickItem extends vscode.QuickPickItem {
  suggestion: WhitelistSuggestion;
  normalized: string;
}

type WritableConfig = Partial<I18nConfig> & {
  sync?: I18nConfig['sync'];
};

interface DynamicWhitelistSnapshot {
  configPath: string;
  config: WritableConfig;
  normalizedEntries: Set<string>;
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
  lastSyncDynamicWarnings = sanitizeDynamicWarnings(summary.dynamicKeyWarnings ?? [], workspaceFolder.uri.fsPath);
  lastSyncSuspiciousWarnings = sanitizeSuspiciousWarnings(summary.suspiciousKeys ?? [], workspaceFolder.uri.fsPath);
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

  const applyConfirmed = await reviewSyncSelection(summary, selection, workspaceFolder.uri.fsPath);
  if (!applyConfirmed) {
    logVerbose('runSync: User cancelled after review modal');
    return;
  }

  logVerbose(`runSync: Applying ${selection.missing.length} missing, ${selection.unused.length} unused via CLI preview apply`);

  const selectionFilePath = await writeSyncSelectionFile(workspaceFolder.uri.fsPath, selection);
  const applyCommand = buildSyncApplyCommand(
    previewResult.previewPath,
    selectionFilePath,
    workspaceFolder.uri.fsPath
  );

  const applyResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Applying locale changes…',
      cancellable: false,
    },
    (progress) => runCliCommand(applyCommand, { progress })
  );

  if (applyResult?.success) {
    await cleanupPreviewArtifacts(previewResult.previewPath, selectionFilePath);
  }

  await refreshLocaleFilesFromConfig(workspaceFolder.uri.fsPath);

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

async function writeSyncSelectionFile(workspaceRoot: string, selection: SyncSelectionResult): Promise<string> {
  const previewDir = path.join(workspaceRoot, '.i18nsmith', 'previews');
  await fs.promises.mkdir(previewDir, { recursive: true });
  const filePath = path.join(previewDir, `sync-selection-${Date.now()}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(selection, null, 2), 'utf8');
  return filePath;
}

async function refreshLocaleFilesFromConfig(workspaceRoot: string): Promise<void> {
  try {
    const meta = await loadConfigWithMeta(undefined, { cwd: workspaceRoot });
    const localesDir = path.join(meta.projectRoot, meta.config.localesDir ?? 'locales');
    const entries = await fsp.readdir(localesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const targetUri = vscode.Uri.file(path.join(localesDir, entry.name));
      try {
        await vscode.workspace.fs.stat(targetUri);
      } catch {
        // ignore - file may have been removed
      }
    }
  } catch (error) {
    logVerbose(`refreshLocaleFilesFromConfig failed: ${(error as Error).message}`);
  }
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

  const suspiciousReasonByKey = new Map<string, string>();
  (summary.suspiciousKeys ?? []).forEach((warning) => {
    if (!suspiciousReasonByKey.has(warning.key)) {
      suspiciousReasonByKey.set(warning.key, warning.reason);
    }
  });

  const autoMissing = summary.missingKeys.filter((record) => !record.suspicious);
  const blockedMissing = summary.missingKeys.filter((record) => record.suspicious);

  autoMissing.forEach((record: MissingKeyRecord) => {
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

  if (blockedMissing.length) {
    items.push({
      label: 'Keys requiring manual fixes',
      kind: vscode.QuickPickItemKind.Separator,
      bucket: 'blocked',
      key: '',
    } as SyncQuickPickItem);

    blockedMissing.forEach((record) => {
      const sample = record.references[0];
      const reason = suspiciousReasonByKey.get(record.key);
      items.push({
        label: `$(circle-slash) ${record.key}`,
        description: sample ? `${sample.filePath}:${sample.position.line}` : 'auto-add disabled',
        detail: describeSuspiciousKeyReason(reason),
        picked: false,
        bucket: 'blocked',
        key: record.key,
      });
    });
  }

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
    placeHolder: blockedMissing.length
      ? 'Select locale changes to apply. Keys with 🚫 must be renamed before they can be added automatically.'
      : 'Select locale changes to apply (toggle entries to include or exclude)',
  });

  if (!selection) {
    return null;
  }

  const missing = selection.filter((item) => item.bucket === 'missing').map((item) => item.key);
  const unused = selection.filter((item) => item.bucket === 'unused').map((item) => item.key);
  const blocked = selection.filter((item) => item.bucket === 'blocked');

  if (!missing.length && !unused.length && blocked.length) {
    vscode.window.showWarningMessage(
      'Selected keys must be renamed before they can be applied automatically. Use "Rename key" to continue.'
    );
    return null;
  }

  return { missing, unused };
}

async function reviewSyncSelection(
  summary: SyncSummary,
  selection: SyncSelectionResult,
  workspaceRoot: string
): Promise<boolean> {
  const detail = formatSyncSelectionDetail(summary, selection, workspaceRoot);
  const previewAvailable = Boolean(summary.diffs && summary.diffs.length > 0);
  const total = selection.missing.length + selection.unused.length;
  const decision = await promptPreviewDecision({
    title: `Locale preview ready (${total} change${total === 1 ? '' : 's'})`,
    detail,
    previewAvailable,
    allowDryRun: true,
  });

  if (decision === 'cancel') {
    return false;
  }
  if (decision === 'dry-run') {
    showSyncDryRunSummary(summary);
    return false;
  }
  if (decision === 'preview') {
    await showSyncDiffPreview(summary);
    return showPersistentApplyNotification({
      title: `Apply ${total} locale change${total === 1 ? '' : 's'}?`,
      detail,
    });
  }
  return decision === 'apply';
}

function formatSyncSelectionDetail(
  summary: SyncSummary,
  selection: SyncSelectionResult,
  workspaceRoot: string
): string {
  const lines: string[] = [];
  const missingCount = selection.missing.length;
  const unusedCount = selection.unused.length;
  lines.push(
    missingCount
      ? `• ${missingCount} missing key${missingCount === 1 ? '' : 's'} will be backfilled`
      : '• No missing keys selected'
  );
  lines.push(
    unusedCount
      ? `• ${unusedCount} unused key${unusedCount === 1 ? '' : 's'} will be pruned`
      : '• No unused keys selected'
  );

  const localeLines = summarizeLocalePreview(summary.localePreview ?? [], selection);
  if (localeLines.length) {
    lines.push(...localeLines);
  }

  if (summary.placeholderIssues.length) {
    lines.push(
      `• ${summary.placeholderIssues.length} placeholder issue${
        summary.placeholderIssues.length === 1 ? '' : 's'
      } detected`
    );
  }

  if (summary.emptyValueViolations.length) {
    lines.push(
      `• ${summary.emptyValueViolations.length} empty locale value${
        summary.emptyValueViolations.length === 1 ? '' : 's'
      } to fix`
    );
  }

  if (lastSyncDynamicWarnings.length) {
    lines.push(
      `• ${lastSyncDynamicWarnings.length} dynamic key warning${
        lastSyncDynamicWarnings.length === 1 ? '' : 's'
      } (whitelist to suppress)`
    );
  }

  if (lastSyncSuspiciousWarnings.length) {
    lines.push(
      `• ${lastSyncSuspiciousWarnings.length} suspicious key${
        lastSyncSuspiciousWarnings.length === 1 ? '' : 's'
      } require rename`
    );
  }

  if (summary.backup?.backupPath) {
    const relativeBackup = path.relative(workspaceRoot, summary.backup.backupPath) || summary.backup.backupPath;
    lines.push(`• Backup ready at ${relativeBackup}`);
  }

  return lines.join('\n');
}

function summarizeLocalePreview(localePreview: SyncSummary['localePreview'], selection: SyncSelectionResult): string[] {
  if (!localePreview?.length) {
    return [];
  }
  const missingSet = new Set(selection.missing);
  const unusedSet = new Set(selection.unused);
  const rows: string[] = [];

  for (const preview of localePreview) {
    const adds = preview.add.filter((key) => missingSet.has(key));
    const removes = preview.remove.filter((key) => unusedSet.has(key));
    if (!adds.length && !removes.length) {
      continue;
    }
    const parts: string[] = [];
    if (adds.length) {
      const sample = adds.slice(0, 2);
      const suffix = adds.length > sample.length ? '…' : '';
      parts.push(`+${adds.length}${sample.length ? ` (${sample.join(', ')}${suffix})` : ''}`);
    }
    if (removes.length) {
      const sample = removes.slice(0, 2);
      const suffix = removes.length > sample.length ? '…' : '';
      parts.push(`-${removes.length}${sample.length ? ` (${sample.join(', ')}${suffix})` : ''}`);
    }
    rows.push(`• ${preview.locale}: ${parts.join(' / ')}`);
  }

  if (rows.length > 5) {
    const extra = rows.length - 5;
    return [...rows.slice(0, 5), `• …plus ${extra} more locale${extra === 1 ? '' : 's'}`];
  }

  return rows;
}

/**
 * Preview UX helpers: every action should present the same sequence
 * 1. Summarize findings (non-modal notification) with optional "Preview" button
 * 2. If the user previews diffs, leave a persistent Apply/Cancel notification
 * 3. Applying runs via CLI progress, cancelling leaves preview artifacts untouched
 */
type PreviewDecision = 'preview' | 'apply' | 'dry-run' | 'cancel';

interface PreviewDecisionOptions {
  title: string;
  detail?: string;
  previewAvailable?: boolean;
  allowDryRun?: boolean;
  previewLabel?: string;
  applyLabel?: string;
  dryRunLabel?: string;
  cancelLabel?: string;
}

function formatNotificationDetail(detail?: string, maxLines = 4): string | undefined {
  if (!detail) {
    return undefined;
  }
  const lines = detail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return undefined;
  }
  const truncated = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    truncated.push('…');
  }
  return truncated.join('\n');
}

function buildNotificationMessage(title: string, detail?: string): string {
  const summary = formatNotificationDetail(detail);
  return summary ? `${title}\n${summary}` : title;
}

async function promptPreviewDecision(options: PreviewDecisionOptions): Promise<PreviewDecision> {
  const previewLabel = options.previewLabel ?? 'Preview Changes';
  const applyLabel = options.applyLabel ?? 'Apply';
  const dryRunLabel = options.dryRunLabel ?? 'Dry Run Only';
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  const buttons: string[] = [];
  if (options.previewAvailable) {
    buttons.push(previewLabel);
  }
  buttons.push(applyLabel);
  const allowDryRun = options.allowDryRun ?? true;
  if (allowDryRun) {
    buttons.push(dryRunLabel);
  }
  buttons.push(cancelLabel);

  const choice = await vscode.window.showInformationMessage(
    buildNotificationMessage(options.title, options.detail),
    ...buttons
  );

  if (!choice || choice === cancelLabel) {
    return 'cancel';
  }
  if (options.previewAvailable && choice === previewLabel) {
    return 'preview';
  }
  if (allowDryRun && choice === dryRunLabel) {
    return 'dry-run';
  }
  if (choice === applyLabel) {
    return 'apply';
  }
  return 'cancel';
}

async function showPersistentApplyNotification(options: {
  title: string;
  detail?: string;
  applyLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  const applyLabel = options.applyLabel ?? 'Apply';
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  const message = buildNotificationMessage(options.title, options.detail);
  const choice = await vscode.window.showInformationMessage(message, applyLabel, cancelLabel);
  return choice === applyLabel;
}

async function showSyncDiffPreview(summary: SyncSummary) {
  const diffs: LocaleDiffEntry[] = summary.diffs ?? [];
  if (!diffs.length) {
    vscode.window.showInformationMessage('No locale diffs available for preview.');
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

  await diffPeekProvider.showDiffPeek(editor, diffs, 'Sync Preview');
}

function describeSuspiciousKeyReason(reason?: string): string {
  if (!reason) {
    return 'Rename this key to a structured identifier before auto-applying.';
  }

  if (reason in SUSPICIOUS_KEY_REASON_DESCRIPTIONS) {
    return SUSPICIOUS_KEY_REASON_DESCRIPTIONS[reason as SuspiciousKeyReason];
  }

  return `Rename this key before auto-applying (reason: ${reason}).`;
}

async function whitelistDynamicKeys() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }

  const warnings = await collectDynamicKeyWarnings(workspaceFolder);

  if (!warnings.length) {
    vscode.window.showInformationMessage('No dynamic key warnings are available to whitelist.');
    return;
  }

  const suggestions = deriveWhitelistSuggestions(warnings);
  if (!suggestions.length) {
    vscode.window.showInformationMessage('Dynamic key warnings are already addressed.');
    return;
  }

  const whitelistSnapshot = await loadDynamicWhitelistSnapshot(workspaceFolder.uri.fsPath);
  if (!whitelistSnapshot) {
    return;
  }

  const normalizedWhitelist = new Set(whitelistSnapshot.normalizedEntries);
  const eligibleSuggestions = suggestions
    .map((suggestion) => {
      const normalized = normalizeManualAssumption(suggestion.assumption);
      if (!normalized || normalizedWhitelist.has(normalized)) {
        return null;
      }
      return { suggestion, normalized };
    })
    .filter((entry): entry is { suggestion: WhitelistSuggestion; normalized: string } => Boolean(entry));

  if (!eligibleSuggestions.length) {
    vscode.window.showInformationMessage(
      'All dynamic key warnings are already whitelisted. Run "i18nsmith sync" again if warnings persist.'
    );
    return;
  }

  const picks: WhitelistQuickPickItem[] = eligibleSuggestions.map(({ suggestion, normalized }) => {
    const icon = suggestion.bucket === 'globs' ? '$(symbol-wildcard)' : '$(symbol-key)';
    const relativePath = path.relative(workspaceFolder.uri.fsPath, suggestion.filePath);
    return {
      label: `${icon} ${suggestion.assumption}`,
      description: `${relativePath}:${suggestion.position.line + 1}`,
      detail: `Expression: ${suggestion.expression}`,
      picked: true,
      suggestion,
      normalized,
    };
  });

  const selection = await vscode.window.showQuickPick(picks, {
    canPickMany: true,
    placeHolder: 'Select dynamic keys to whitelist (toggle to exclude any entries)',
    matchOnDetail: true,
  });

  if (!selection || !selection.length) {
    return;
  }

  const pendingNormalized = new Set(normalizedWhitelist);
  const additions: WhitelistSuggestion[] = [];
  for (const item of selection) {
    if (pendingNormalized.has(item.normalized)) {
      continue;
    }
    pendingNormalized.add(item.normalized);
    additions.push(item.suggestion);
  }
  const customEntry = await vscode.window.showInputBox({
    prompt: 'Add custom key/glob (optional). Leave empty to skip.',
    placeHolder: 'e.g., errors.runtime.*',
    ignoreFocusOut: true,
  });

  if (customEntry?.trim()) {
    const normalized = normalizeManualAssumption(customEntry);
    if (normalized) {
      if (pendingNormalized.has(normalized)) {
        vscode.window.showInformationMessage('Custom entry already exists in the whitelist.');
      } else {
        pendingNormalized.add(normalized);
        additions.push({
          id: `manual-${Date.now()}`,
          expression: customEntry,
          assumption: normalized,
          bucket: normalized.includes('*') ? 'globs' : 'assumptions',
          filePath: workspaceFolder.uri.fsPath,
          position: { line: 0, column: 0 },
        });
      }
    }
  }

  if (!additions.length) {
    vscode.window.showWarningMessage('No dynamic keys were selected to whitelist.');
    return;
  }

  const persistResult = await persistDynamicKeyAssumptions(
    workspaceFolder.uri.fsPath,
    additions,
    whitelistSnapshot
  );
  if (!persistResult) {
    return;
  }

  lastSyncDynamicWarnings = [];

  const { globsAdded, assumptionsAdded } = persistResult;
  if (!globsAdded && !assumptionsAdded) {
    vscode.window.showInformationMessage('Selected dynamic keys were already whitelisted.');
    return;
  }

  const parts: string[] = [];
  if (assumptionsAdded) {
    parts.push(`${assumptionsAdded} key${assumptionsAdded === 1 ? '' : 's'}`);
  }
  if (globsAdded) {
    parts.push(`${globsAdded} glob${globsAdded === 1 ? '' : 's'}`);
  }

  vscode.window.showInformationMessage(`Added ${parts.join(' and ')} to i18n.config.json.`);

  if (smartScanner) {
    try {
      const scanResult = await smartScanner.scan('whitelist-dynamic');
      if (!scanResult.success) {
        vscode.window.showWarningMessage(
          'i18nsmith check could not refresh automatically. Run "i18nsmith check" to ensure diagnostics are up to date.'
        );
      }
    } catch (error) {
      logVerbose(`whitelistDynamicKeys: smartScanner scan failed - ${(error as Error).message}`);
      vscode.window.showWarningMessage(
        'i18nsmith check failed while refreshing. Run "i18nsmith check" manually to update diagnostics.'
      );
    }
  } else {
    logVerbose('whitelistDynamicKeys: smartScanner unavailable, skipping automatic refresh');
  }

  if (reportWatcher) {
    await reportWatcher.refresh();
  }
  await refreshDiagnosticsWithMessage('quick-action');
}

async function renameAllSuspiciousKeys() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }

  const warnings = await collectSuspiciousKeyWarnings(workspaceFolder);
  if (!warnings.length) {
    vscode.window.showInformationMessage('No suspicious keys detected. Run "i18nsmith sync" to refresh diagnostics.');
    return;
  }

  await runSuspiciousRenameFlow(warnings, workspaceFolder, { scopeLabel: 'workspace' });
}

async function renameSuspiciousKeysInFile(target?: vscode.Uri) {
  const workspaceFolder = target
    ? vscode.workspace.getWorkspaceFolder(target)
    : vscode.workspace.workspaceFolders?.[0];

  const fileUri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!fileUri) {
    vscode.window.showWarningMessage('Open a file to rename suspicious keys.');
    return;
  }

  const folder = workspaceFolder ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showErrorMessage('No workspace folder found.');
    return;
  }

  const warnings = await collectSuspiciousKeyWarnings(folder);
  const normalizedTarget = path.normalize(fileUri.fsPath);
  const fileWarnings = warnings.filter((warning) => path.normalize(warning.filePath) === normalizedTarget);

  if (!fileWarnings.length) {
    vscode.window.showInformationMessage('No suspicious keys detected in this file. Run "i18nsmith sync" to refresh diagnostics.');
    return;
  }

  const relativeLabel = path.relative(folder.uri.fsPath, normalizedTarget) || path.basename(normalizedTarget);
  await runSuspiciousRenameFlow(fileWarnings, folder, { scopeLabel: relativeLabel });
}

async function runSuspiciousRenameFlow(
  warnings: SuspiciousKeyWarning[],
  workspaceFolder: vscode.WorkspaceFolder,
  options: { scopeLabel: string }
) {
  let meta: Awaited<ReturnType<typeof loadConfigWithMeta>>;
  try {
    meta = await loadConfigWithMeta(undefined, { cwd: workspaceFolder.uri.fsPath });
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to load i18nsmith config: ${(error as Error).message}`);
    return;
  }

  const existingKeys = await collectExistingTranslationKeys(meta);
  const renameReport = buildSuspiciousRenameReport(warnings, meta, existingKeys);

  if (!renameReport.safeProposals.length) {
    if (renameReport.conflictProposals.length) {
      vscode.window.showWarningMessage(
        `All suspicious keys in ${options.scopeLabel} conflict with existing keys. Review the rename plan and resolve conflicts manually.`
      );
      await showSuspiciousRenamePlan(renameReport);
    } else {
      vscode.window.showInformationMessage(`No auto-rename suggestions were generated for suspicious keys in ${options.scopeLabel}.`);
    }
    return;
  }

  const summaryDetail = formatSuspiciousRenameSummary(renameReport);
  const renameLabel = options.scopeLabel === 'workspace' ? 'Rename All' : 'Rename Keys';
  let choice = await vscode.window.showInformationMessage(
    `Rename ${renameReport.safeProposals.length} suspicious key${renameReport.safeProposals.length === 1 ? '' : 's'} in ${options.scopeLabel}?`,
    { modal: true, detail: summaryDetail },
    renameLabel,
    'Review Plan'
  );

  if (!choice) {
    return;
  }

  if (choice === 'Review Plan') {
    await showSuspiciousRenamePlan(renameReport);
    choice = await vscode.window.showInformationMessage(
      `Apply ${renameReport.safeProposals.length} rename${renameReport.safeProposals.length === 1 ? '' : 's'} in ${options.scopeLabel}?`,
      { modal: true, detail: summaryDetail },
      renameLabel
    );
    if (choice !== renameLabel) {
      return;
    }
  }

  const mapEntries = renameReport.safeProposals.map((proposal) => ({
    from: proposal.originalKey,
    to: proposal.proposedKey,
  }));

  const { mapPath, cleanup } = await writeRenameMapFile(mapEntries);
  const command = buildRenameKeysCommand(mapPath, true);
  try {
    const result = await runCliCommand(command);
    if (result?.success) {
      lastSyncSuspiciousWarnings = [];
      vscode.window.showInformationMessage(
        `Applied ${renameReport.safeProposals.length} auto-renamed key${renameReport.safeProposals.length === 1 ? '' : 's'} in ${options.scopeLabel}.`
      );
    }
  } finally {
    await cleanup();
  }
}

async function collectDynamicKeyWarnings(workspaceFolder: vscode.WorkspaceFolder): Promise<DynamicKeyWarning[]> {
  if (lastSyncDynamicWarnings.length) {
    return lastSyncDynamicWarnings;
  }

  const diagnosticsWarnings = getDiagnosticsDynamicWarnings(workspaceFolder.uri.fsPath);
  const hasDiagnosticsReport = Boolean(diagnosticsManager?.getReport?.());
  if (diagnosticsWarnings.length || hasDiagnosticsReport) {
    return diagnosticsWarnings;
  }

  return await readLatestSyncPreviewDynamicWarnings(workspaceFolder.uri.fsPath);
}

function getDiagnosticsDynamicKeySection(report: unknown): unknown {
  if (!report || typeof report !== 'object') {
    return undefined;
  }
  const syncSection = (report as { sync?: unknown }).sync;
  if (!syncSection || typeof syncSection !== 'object') {
    return undefined;
  }
  return syncSection;
}

function getDiagnosticsDynamicWarnings(workspaceRoot: string): DynamicKeyWarning[] {
  const report = diagnosticsManager?.getReport?.();
  const syncSection = getDiagnosticsDynamicKeySection(report) as { dynamicKeyWarnings?: unknown } | undefined;
  if (!syncSection || !Array.isArray(syncSection.dynamicKeyWarnings)) {
    return [];
  }
  return sanitizeDynamicWarnings(syncSection.dynamicKeyWarnings, workspaceRoot);
}

async function readLatestSyncPreviewDynamicWarnings(workspaceRoot: string): Promise<DynamicKeyWarning[]> {
  const previewDir = path.join(workspaceRoot, '.i18nsmith', 'previews');
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(previewDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('sync-preview-') && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const file of candidates) {
    const filePath = path.join(previewDir, file);
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as { summary?: { dynamicKeyWarnings?: unknown } };
      if (!parsed?.summary?.dynamicKeyWarnings) {
        continue;
      }
      const sanitized = sanitizeDynamicWarnings(parsed.summary.dynamicKeyWarnings, workspaceRoot);
      if (sanitized.length) {
        return sanitized;
      }
    } catch (error) {
      logVerbose(`Failed to read dynamic warnings from ${filePath}: ${(error as Error).message}`);
    }
  }

  return [];
}

function sanitizeDynamicWarnings(rawWarnings: unknown, workspaceRoot: string): DynamicKeyWarning[] {
  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: DynamicKeyWarning[] = [];

  for (const entry of rawWarnings) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const filePathValue = (entry as { filePath?: unknown }).filePath;
    if (typeof filePathValue !== 'string' || !filePathValue.trim()) {
      continue;
    }

    const absolutePath = path.isAbsolute(filePathValue)
      ? filePathValue
      : path.join(workspaceRoot, filePathValue);

    const expressionValue = (entry as { expression?: unknown }).expression;
    const normalizedExpression = typeof expressionValue === 'string' ? expressionValue : '';

    const positionValue = (entry as { position?: { line?: unknown; column?: unknown } }).position ?? {};
    const lineNumber = Number((positionValue as { line?: unknown }).line ?? 0);
    const columnNumber = Number((positionValue as { column?: unknown }).column ?? 0);

    const reasonValue = (entry as { reason?: unknown }).reason;
    const normalizedReason =
      typeof reasonValue === 'string' && isDynamicKeyReason(reasonValue)
        ? reasonValue
        : 'expression';

    const dedupeKey = `${absolutePath}:${lineNumber}:${columnNumber}:${normalizedExpression}:${normalizedReason}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    normalized.push({
      filePath: absolutePath,
      expression: normalizedExpression,
      reason: normalizedReason,
      position: {
        line: Number.isFinite(lineNumber) ? lineNumber : 0,
        column: Number.isFinite(columnNumber) ? columnNumber : 0,
      },
    });
  }

  return normalized;
}

function isDynamicKeyReason(value: string): value is DynamicKeyWarning['reason'] {
  return value === 'template' || value === 'binary' || value === 'expression';
}

async function collectExistingTranslationKeys(
  meta: Awaited<ReturnType<typeof loadConfigWithMeta>>
): Promise<Set<string>> {
  const localesDir = path.join(meta.projectRoot, meta.config.localesDir ?? 'locales');
  const keySet = new Set<string>();
  let files: fs.Dirent[];
  try {
    files = await fsp.readdir(localesDir, { withFileTypes: true });
  } catch (error) {
    logVerbose(`collectExistingTranslationKeys: ${String((error as Error).message || error)}`);
    return keySet;
  }

  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(localesDir, entry.name);
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      flattenLocaleKeys(parsed, '', keySet);
    } catch (error) {
      logVerbose(`collectExistingTranslationKeys: skipping ${entry.name} (${(error as Error).message})`);
    }
  }

  return keySet;
}

function flattenLocaleKeys(node: unknown, prefix: string, target: Set<string>) {
  if (typeof node === 'string') {
    if (prefix) {
      target.add(prefix);
    }
    return;
  }

  if (!node || typeof node !== 'object') {
    return;
  }

  for (const [segment, value] of Object.entries(node as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${segment}` : segment;
    if (typeof value === 'string') {
      target.add(next);
    } else {
      flattenLocaleKeys(value, next, target);
    }
  }
}

type ExtensionSuspiciousRenameProposal = {
  originalKey: string;
  proposedKey: string;
  reason: string;
  filePath: string;
  position: { line: number; column: number };
  conflictsWith?: string;
  targetExists?: boolean;
};

interface ExtensionSuspiciousRenameReport {
  totalSuspicious: number;
  safeProposals: ExtensionSuspiciousRenameProposal[];
  conflictProposals: ExtensionSuspiciousRenameProposal[];
  skippedKeys: string[];
}

function buildSuspiciousRenameReport(
  warnings: SuspiciousKeyWarning[],
  meta: Awaited<ReturnType<typeof loadConfigWithMeta>>,
  existingKeys: Set<string>
): ExtensionSuspiciousRenameReport {
  const generator = new KeyGenerator({
    namespace: meta.config.keyGeneration?.namespace,
    hashLength: meta.config.keyGeneration?.shortHashLen,
    workspaceRoot: meta.projectRoot,
  });

  const localesDir = path.join(meta.projectRoot, meta.config.localesDir ?? 'locales');
  const seenKeys = new Set<string>();
  const usedTargets = new Map<string, string>();
  const safeProposals: ExtensionSuspiciousRenameProposal[] = [];
  const conflictProposals: ExtensionSuspiciousRenameProposal[] = [];
  const skippedKeys: string[] = [];

  for (const warning of warnings) {
    const key = warning.key?.trim();
    if (!key || seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    const baseText = key.replace(/-[a-f0-9]{6,}$/i, '').replace(/^[^.]+\./, '');
    const contextPath = warning.filePath?.startsWith(localesDir) ? '' : warning.filePath ?? '';

    let proposedKey: string;
    try {
      proposedKey = generator.generate(baseText || key, {
        filePath: contextPath || meta.projectRoot,
        kind: 'jsx-text',
      }).key;
    } catch (error) {
      logVerbose(`buildSuspiciousRenameReport: failed to normalize ${key}: ${(error as Error).message}`);
      skippedKeys.push(key);
      continue;
    }

    if (!proposedKey || proposedKey === key) {
      skippedKeys.push(key);
      continue;
    }

    const proposal: ExtensionSuspiciousRenameProposal = {
      originalKey: key,
      proposedKey,
      reason: warning.reason ?? 'suspicious-key',
      filePath: warning.filePath,
      position: warning.position ?? { line: 0, column: 0 },
    };

    const duplicateSource = usedTargets.get(proposedKey);
    if (duplicateSource) {
      proposal.conflictsWith = duplicateSource;
      conflictProposals.push(proposal);
      continue;
    }

    if (existingKeys.has(proposedKey)) {
      proposal.conflictsWith = proposedKey;
      proposal.targetExists = true;
      conflictProposals.push(proposal);
      continue;
    }

    safeProposals.push(proposal);
    usedTargets.set(proposedKey, key);
  }

  return {
    totalSuspicious: seenKeys.size,
    safeProposals,
    conflictProposals,
    skippedKeys,
  };
}

function formatSuspiciousRenameSummary(report: ExtensionSuspiciousRenameReport): string {
  const lines: string[] = [];
  lines.push(`• Detected ${report.totalSuspicious} suspicious key${report.totalSuspicious === 1 ? '' : 's'}`);
  lines.push(`• Ready to rename: ${report.safeProposals.length}`);
  if (report.conflictProposals.length) {
    lines.push(`• Conflicts requiring manual attention: ${report.conflictProposals.length}`);
  }
  const existingTargetCount = report.conflictProposals.filter((proposal) => proposal.targetExists).length;
  if (existingTargetCount) {
    lines.push(
      `• ${existingTargetCount} target${existingTargetCount === 1 ? '' : 's'} already exist (locales will need merging)`
    );
  }
  if (report.skippedKeys.length) {
    lines.push(`• Skipped (already normalized): ${report.skippedKeys.length}`);
  }
  if (report.safeProposals.length) {
    lines.push('', 'Preview:');
    report.safeProposals.slice(0, 5).forEach((proposal) => {
      lines.push(`  • ${proposal.originalKey} → ${proposal.proposedKey}`);
    });
    if (report.safeProposals.length > 5) {
      lines.push(`  …and ${report.safeProposals.length - 5} more`);
    }
  }
  return lines.join('\n');
}

async function showSuspiciousRenamePlan(report: ExtensionSuspiciousRenameReport) {
  const lines: string[] = ['# Suspicious key rename plan', ''];
  lines.push(`## Ready (${report.safeProposals.length})`, '');
  if (report.safeProposals.length) {
    for (const proposal of report.safeProposals) {
      const note = proposal.targetExists ? ' (target exists)' : '';
      lines.push(`- ${proposal.originalKey} → ${proposal.proposedKey} (${proposal.reason})${note}`);
    }
  } else {
    lines.push('_No safe proposals._');
  }

  lines.push('', `## Conflicts (${report.conflictProposals.length})`, '');
  if (report.conflictProposals.length) {
    for (const conflict of report.conflictProposals) {
      const location = `${conflict.filePath}:${conflict.position.line}`;
      const target = conflict.conflictsWith ? ` (conflicts with ${conflict.conflictsWith})` : '';
      lines.push(`- ${conflict.originalKey} → ${conflict.proposedKey}${target} @ ${location}`);
    }
  } else {
    lines.push('_No conflicts detected._');
  }

  if (report.skippedKeys.length) {
    lines.push('', `## Skipped (${report.skippedKeys.length})`, '');
    report.skippedKeys.forEach((key) => lines.push(`- ${key}`));
  }

  const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function writeRenameMapFile(mappings: Array<{ from: string; to: string }>): Promise<{ mapPath: string; cleanup: () => Promise<void> }> {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-rename-map-'));
  const mapPath = path.join(tempDir, 'rename-map.json');
  await fsp.writeFile(mapPath, JSON.stringify(mappings, null, 2) + '\n', 'utf8');
  return {
    mapPath,
    cleanup: async () => {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function buildRenameKeysCommand(mapPath: string, write: boolean): string {
  const parts = ['i18nsmith rename-keys', '--map', quoteCliArg(mapPath), '--json'];
  if (write) {
    parts.push('--write');
  }
  return parts.join(' ');
}

async function collectSuspiciousKeyWarnings(workspaceFolder: vscode.WorkspaceFolder): Promise<SuspiciousKeyWarning[]> {
  if (lastSyncSuspiciousWarnings.length) {
    return lastSyncSuspiciousWarnings;
  }

  const report = diagnosticsManager?.getReport?.();
  const syncSection = getDiagnosticsDynamicKeySection(report) as { suspiciousKeys?: unknown } | undefined;
  if (syncSection && Array.isArray(syncSection.suspiciousKeys)) {
    return sanitizeSuspiciousWarnings(syncSection.suspiciousKeys, workspaceFolder.uri.fsPath);
  }

  return await readLatestSyncPreviewSuspiciousWarnings(workspaceFolder.uri.fsPath);
}

async function readLatestSyncPreviewSuspiciousWarnings(workspaceRoot: string): Promise<SuspiciousKeyWarning[]> {
  const previewDir = path.join(workspaceRoot, '.i18nsmith', 'previews');
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(previewDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('sync-preview-') && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const file of candidates) {
    const filePath = path.join(previewDir, file);
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as { summary?: { suspiciousKeys?: unknown } };
      if (!parsed?.summary?.suspiciousKeys) {
        continue;
      }
      const sanitized = sanitizeSuspiciousWarnings(parsed.summary.suspiciousKeys, workspaceRoot);
      if (sanitized.length) {
        return sanitized;
      }
    } catch (error) {
      logVerbose(`Failed to read suspicious warnings from ${filePath}: ${(error as Error).message}`);
    }
  }

  return [];
}

function sanitizeSuspiciousWarnings(rawWarnings: unknown, workspaceRoot: string): SuspiciousKeyWarning[] {
  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  const normalized: SuspiciousKeyWarning[] = [];
  const seen = new Set<string>();

  for (const entry of rawWarnings) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const keyValue = (entry as { key?: unknown }).key;
    const filePathValue = (entry as { filePath?: unknown }).filePath;
    const reasonValue = (entry as { reason?: unknown }).reason;
    const positionValue = (entry as { position?: { line?: unknown; column?: unknown } }).position ?? {};

    if (typeof keyValue !== 'string' || !keyValue.trim()) {
      continue;
    }
    if (typeof filePathValue !== 'string' || !filePathValue.trim()) {
      continue;
    }

    const absolutePath = path.isAbsolute(filePathValue)
      ? filePathValue
      : path.join(workspaceRoot, filePathValue);
    const lineNumber = Number((positionValue as { line?: unknown }).line ?? 0);
    const columnNumber = Number((positionValue as { column?: unknown }).column ?? 0);
    const dedupeKey = `${keyValue}::${absolutePath}:${lineNumber}:${columnNumber}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    normalized.push({
      key: keyValue,
      filePath: absolutePath,
      position: {
        line: Number.isFinite(lineNumber) ? lineNumber : 0,
        column: Number.isFinite(columnNumber) ? columnNumber : 0,
      },
      reason: typeof reasonValue === 'string' ? reasonValue : 'contains-spaces',
    });
  }

  return normalized;
}

async function persistDynamicKeyAssumptions(
  workspaceRoot: string,
  selections: WhitelistSuggestion[],
  snapshot?: DynamicWhitelistSnapshot
): Promise<{ globsAdded: number; assumptionsAdded: number } | null> {
  const state = snapshot ?? (await loadDynamicWhitelistSnapshot(workspaceRoot));
  if (!state) {
    return null;
  }

  const { config, configPath } = state;
  config.sync = config.sync ?? {};

  const globEntries = selections.filter((item) => item.bucket === 'globs').map((item) => item.assumption);
  const assumptionEntries = selections
    .filter((item) => item.bucket === 'assumptions')
    .map((item) => item.assumption);

  const globMerge = mergeAssumptions(config.sync.dynamicKeyGlobs, globEntries);
  const assumptionMerge = mergeAssumptions(config.sync.dynamicKeyAssumptions, assumptionEntries);

  if (!globMerge.added.length && !assumptionMerge.added.length) {
    return { globsAdded: 0, assumptionsAdded: 0 };
  }

  config.sync.dynamicKeyGlobs = globMerge.next;
  config.sync.dynamicKeyAssumptions = assumptionMerge.next;

  await fsp.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  return {
    globsAdded: globMerge.added.length,
    assumptionsAdded: assumptionMerge.added.length,
  };
}

async function loadDynamicWhitelistSnapshot(
  workspaceRoot: string
): Promise<DynamicWhitelistSnapshot | null> {
  const configPath = path.join(workspaceRoot, 'i18n.config.json');
  let raw: string;
  try {
    raw = await fsp.readFile(configPath, 'utf8');
  } catch (error) {
    vscode.window.showErrorMessage(`Unable to read i18n.config.json: ${(error as Error).message}`);
    return null;
  }

  let config: WritableConfig;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    vscode.window.showErrorMessage(`Invalid i18n.config.json: ${(error as Error).message}`);
    return null;
  }

  config.sync = config.sync ?? {};

  const normalizedEntries = new Set<string>();
  collectNormalizedWhitelistEntries(config.sync.dynamicKeyGlobs, normalizedEntries);
  collectNormalizedWhitelistEntries(config.sync.dynamicKeyAssumptions, normalizedEntries);

  return { configPath, config, normalizedEntries };
}

function collectNormalizedWhitelistEntries(values: string[] | undefined, target: Set<string>) {
  for (const value of values ?? []) {
    const normalized = normalizeManualAssumption(value);
    if (normalized) {
      target.add(normalized);
    }
  }
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
  const decision = await promptPreviewDecision({
    title: `Transform ${transformable.length} candidate${transformable.length === 1 ? '' : 's'} in ${label}?`,
    detail,
    previewAvailable: Boolean(preview.diffs && preview.diffs.length > 0),
    allowDryRun: true,
    previewLabel: 'Preview Diff',
  });

  if (decision === 'cancel') {
    logVerbose('runTransformCommand: User cancelled');
    return;
  }

  if (decision === 'preview') {
    logVerbose('runTransformCommand: Showing diff preview');
    await showTransformDiff(preview);

    const applyConfirmed = await showPersistentApplyNotification({
      title: `Apply transform to ${label}?`,
      detail,
      applyLabel: 'Apply',
      cancelLabel: 'Cancel',
    });

    if (!applyConfirmed) {
      logVerbose('runTransformCommand: User cancelled after viewing diff');
      return;
    }
  } else if (decision === 'dry-run') {
    logVerbose('runTransformCommand: Dry run only, showing preview');
    vscode.window.showInformationMessage(`Preview only. Re-run the command and choose Apply to write changes.`, { detail });
    return;
  }

  logVerbose(`runTransformCommand: Applying ${transformable.length} transformations via CLI`);

  const writeCommand = buildTransformWriteCommand(baseArgs);
  const writeResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `i18nsmith: Applying transforms (${label})…`,
      cancellable: false,
    },
    (progress) => runCliCommand(writeCommand, { progress })
  );

  if (writeResult?.success) {
    await cleanupPreviewArtifacts(previewResult.previewPath);
  }

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

type RenameInvocationSource = 'quickFix' | 'commandPalette';

interface RenameCommandOptions {
  from: string;
  to: string;
  invocation?: RenameInvocationSource;
  skipPreview?: boolean;
  forceApply?: boolean;
}

async function runRenameCommand(options: RenameCommandOptions) {
  const {
    from,
    to,
    invocation = 'commandPalette',
    skipPreview,
    forceApply,
  } = options;
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
  const hasLocaleEntries = (summary.localePreview ?? []).some((preview) => !preview.missing);
  if (!summary.occurrences && !hasLocaleEntries) {
    vscode.window.showWarningMessage(
      `"${from}" was not found in source files or locale files. Add the key or run sync before renaming.`
    );
    return;
  }

  const detail = formatRenamePreview(summary, from, to);
  const shouldSkipPreview = forceApply ? true : skipPreview ?? (invocation === 'quickFix');
  const previewAvailable = Boolean(summary.diffs?.length);

  let decision: PreviewDecision;
  if (forceApply) {
    decision = 'apply';
  } else if (shouldSkipPreview) {
    decision = await promptPreviewDecision({
      title: `Rename ${from} → ${to}?`,
      detail,
      previewAvailable,
      allowDryRun: false,
      previewLabel: previewAvailable ? 'Preview Diff' : undefined,
      applyLabel: 'Apply Fix',
      cancelLabel: 'Cancel',
    });
  } else {
    decision = await promptPreviewDecision({
      title: `Rename ${from} → ${to}?`,
      detail,
      previewAvailable,
      allowDryRun: true,
      previewLabel: 'Show Diff',
    });
  }

  if (decision === 'cancel') {
    logVerbose('runRenameCommand: User cancelled');
    return;
  }

  if (decision === 'preview') {
    await showSourceDiffPreview(summary.diffs ?? [], 'Rename Preview');
    const confirmed = await showPersistentApplyNotification({
      title: `Apply rename ${from} → ${to}?`,
      detail,
      applyLabel: 'Apply',
      cancelLabel: 'Cancel',
    });
    if (!confirmed) {
      return;
    }
  } else if (decision === 'dry-run') {
    vscode.window.showInformationMessage('Preview only. Run again and choose Apply to write changes.', { detail });
    return;
  }

  const renameCommand = buildRenameWriteCommand(from, to);
  const renameResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `i18nsmith: Renaming ${from} → ${to}…`,
      cancellable: false,
    },
    (progress) => runCliCommand(renameCommand, { progress })
  );

  if (renameResult?.success) {
    await cleanupPreviewArtifacts(previewResult.previewPath);
  }
  hoverProvider.clearCache();
  await reportWatcher.refresh();
  await smartScanner.scan('rename');
}

function formatRenamePreview(summary: KeyRenameSummary, from: string, to: string): string {
  const lines: string[] = [];
  lines.push(`• ${summary.occurrences} source occurrence${summary.occurrences === 1 ? '' : 's'}`);
  lines.push(`• ${summary.filesUpdated.length} source file${summary.filesUpdated.length === 1 ? '' : 's'} to update`);

  const hasLocaleEntries = (summary.localePreview ?? []).some((preview) => !preview.missing);
  if (!summary.occurrences && hasLocaleEntries) {
    lines.push('• No source usages detected — locale files will still be renamed');
  }

  if (summary.localePreview.length) {
    const duplicates = summary.localePreview.filter((preview) => preview.duplicate);
    const missing = summary.localePreview.filter((preview) => preview.missing);

    if (duplicates.length) {
      const sample = duplicates.slice(0, 3).map((preview) => preview.locale).join(', ');
      lines.push(
        `• ${duplicates.length} locale${duplicates.length === 1 ? '' : 's'} already contain “${to}” (${sample}${
          duplicates.length > 3 ? '…' : ''
        })`
      );
    }

    if (missing.length) {
      const sample = missing.slice(0, 3).map((preview) => preview.locale).join(', ');
      lines.push(
        `• ${missing.length} locale${missing.length === 1 ? '' : 's'} missing “${from}” (${sample}${
          missing.length > 3 ? '…' : ''
        })`
      );
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
  const decision = await promptPreviewDecision({
    title: `Translate ${summary.plan.totalTasks} key${summary.plan.totalTasks === 1 ? '' : 's'} via ${summary.provider}?`,
    detail,
    previewAvailable: false,
    allowDryRun: true,
  });

  if (decision === 'cancel') {
    logVerbose('runTranslateCommand: User cancelled');
    return;
  }

  if (decision === 'dry-run') {
    vscode.window.showInformationMessage('Preview only. Run again and choose Apply to write changes.', { detail });
    return;
  }

  const translateCommand = buildTranslateWriteCommand(baseArgs);
  const translateResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Applying translations…',
      cancellable: false,
    },
    (progress) => runCliCommand(translateCommand, { progress })
  );

  if (translateResult?.success) {
    await cleanupPreviewArtifacts(previewResult.previewPath);
  }
  hoverProvider.clearCache();
  await reportWatcher.refresh();
  await smartScanner.scan('translate');
}

async function exportMissingTranslations() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const defaultDir = path.join(workspaceFolder.uri.fsPath, '.i18nsmith');
  const defaultFile = path.join(defaultDir, 'missing-translations.csv');
  const defaultUri = vscode.Uri.file(defaultFile);
  const saveTarget = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { CSV: ['csv'] },
    saveLabel: 'Export',
    title: 'Export missing translations to CSV',
  });

  if (!saveTarget) {
    return;
  }

  try {
    await fsp.mkdir(path.dirname(saveTarget.fsPath), { recursive: true });
  } catch (error) {
    vscode.window.showErrorMessage(`Unable to prepare export directory: ${(error as Error).message}`);
    return;
  }

  const command = buildExportMissingTranslationsCommand(saveTarget.fsPath, workspaceFolder.uri.fsPath);
  const exportResult = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'i18nsmith: Exporting missing translations…',
      cancellable: false,
    },
    (progress) => runCliCommand(command, { progress })
  );

  if (!exportResult?.success) {
    return;
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, saveTarget.fsPath);
  if (fs.existsSync(saveTarget.fsPath)) {
    const targetLabel = relativePath.startsWith('..')
      ? saveTarget.fsPath
      : relativePath || path.basename(saveTarget.fsPath);
    vscode.window.showInformationMessage(`Missing translations exported to ${targetLabel}.`);
    try {
      const doc = await vscode.workspace.openTextDocument(saveTarget);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error) {
      logVerbose(`exportMissingTranslations: unable to open CSV - ${(error as Error).message}`);
    }
  } else {
    vscode.window.showInformationMessage('No missing translations detected. Nothing to export.');
  }
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
  const syncSection = report?.sync as { dynamicKeyWarnings?: unknown[]; suspiciousKeys?: unknown[] } | undefined;
  const dynamicWarningCount = Array.isArray(syncSection?.dynamicKeyWarnings)
    ? syncSection.dynamicKeyWarnings.length
    : 0;
  const suspiciousWarningCount = Array.isArray(syncSection?.suspiciousKeys)
    ? syncSection.suspiciousKeys.length
    : 0;
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

  if (dynamicWarningCount) {
    picks.push({
      label: '$(shield) Whitelist dynamic keys',
      description: `${dynamicWarningCount} runtime expression${dynamicWarningCount === 1 ? '' : 's'} flagged`,
      detail: 'Add assumptions to i18n.config.json to silence false unused warnings',
      builtin: 'whitelist-dynamic',
    });
  }

  if (suspiciousWarningCount) {
    picks.push({
      label: '$(sparkle) Rename suspicious keys',
      description: `${suspiciousWarningCount} key${suspiciousWarningCount === 1 ? '' : 's'} flagged as raw text`,
      detail: 'Generate normalized names and apply them via rename-keys in one flow',
      builtin: 'rename-suspicious',
    });
  }

  const missingCount = driftStats?.missing ?? 0;
  picks.push({
    label: '$(cloud-download) Export missing translations',
    description: missingCount
      ? `${missingCount} missing key${missingCount === 1 ? '' : 's'} → CSV handoff`
      : 'Generate a CSV of missing translations for translators',
    command: 'i18nsmith.exportMissingTranslations',
  });

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
    case 'whitelist-dynamic': {
      await whitelistDynamicKeys();
      break;
    }
    case 'rename-suspicious': {
      await renameAllSuspiciousKeys();
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


async function runCliCommand(
  rawCommand: string,
  options: {
    interactive?: boolean;
    confirmMessage?: string;
    progress?: vscode.Progress<{ message?: string; increment?: number }>;
  } = {}
) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const command = resolveCliCommand(rawCommand);
  logVerbose(`runCliCommand: raw='${rawCommand}' resolved='${command}'`);

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
      return undefined;
    }
  }

  if (options.interactive) {
    const terminal = ensureInteractiveTerminal(workspaceFolder.uri.fsPath);
    terminal.show();
    terminal.sendText(command, true);
    vscode.window.showInformationMessage(
      'Command started in the integrated terminal. Refresh diagnostics once it completes.'
    );
    return undefined;
  }

  const out = vscode.window.createOutputChannel('i18nsmith');
  out.show();
  out.appendLine(`$ ${command}`);

  const progressTracker = createCliProgressTracker(options.progress);

  return await new Promise<CliRunResult>((resolve) => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    const child = exec(command, { cwd: workspaceFolder.uri.fsPath }, async (err: Error | null) => {
      progressTracker?.flush();
      const stdout = stdoutChunks.join('');
      const stderr = stderrChunks.join('');
      const warnings = extractCliWarnings(stdout);
      if (err) {
        out.appendLine(`[error] ${err.message}`);
        vscode.window.showErrorMessage(`Command failed: ${err.message}`);
        resolve({ success: false, stdout, stderr, warnings });
      } else {
        const summary = summarizeCliJson(stdout);
        if (summary) {
          vscode.window.showInformationMessage(summary);
        } else {
          vscode.window.showInformationMessage('Command completed');
        }
        if (warnings.length) {
          const whitelistAction = 'Whitelist dynamic keys';
          const outputAction = 'Open Output';
          const actions = warnings.some((warning) => /dynamic translation key/.test(warning))
            ? [whitelistAction, outputAction]
            : [outputAction];
          vscode.window.showWarningMessage(warnings[0], ...actions).then((choice) => {
            if (choice === outputAction) {
              out.show(true);
            } else if (choice === whitelistAction) {
              vscode.commands.executeCommand('i18nsmith.whitelistDynamicKeys');
            }
          });
        }
        progressTracker?.complete();
        await reportWatcher?.refresh();
        if (smartScanner) {
          await smartScanner.scan('suggested-command');
        }
        resolve({ success: true, stdout, stderr, warnings });
      }
    });

    // Safety net: some CLI versions still prompt for confirmation during prune operations.
    // If that happens, auto-confirm so the VS Code progress notification doesn't hang forever.
    // (We also pass `--yes` in the command builder; this is a fallback.)
    const shouldAutoConfirm =
      !options.interactive && /\bi18nsmith\b[\s\S]*\bsync\b[\s\S]*--apply-preview/.test(rawCommand);
    const maybeAutoConfirm = (chunk: Buffer | string) => {
      if (!shouldAutoConfirm) {
        return;
      }
      const text = chunk.toString();
      // Inquirer prompt is typically rendered as: "Remove these N unused keys? (y/N)"
      if (/(\(y\/N\))|(\(Y\/n\))/i.test(text) || /Remove these\s+\d+\s+unused keys\?/i.test(text)) {
        logVerbose('runCliCommand: detected confirmation prompt; auto-sending "y"');
        try {
          child.stdin?.write('y\n');
        } catch {
          // ignore
        }
      }
    };

    child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdoutChunks.push(text);
      out.append(text);
      progressTracker?.handleChunk(text);
      maybeAutoConfirm(chunk);
    });

    child.stdout?.on('close', () => {
      progressTracker?.flush();
    });

    child.stderr?.on('data', (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderrChunks.push(text);
      out.append(text);
      maybeAutoConfirm(chunk);
    });
  });
}

function createCliProgressTracker(
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): null | {
  handleChunk: (text: string) => void;
  flush: () => void;
  complete: () => void;
} {
  if (!progress) {
    return null;
  }

  let buffer = '';
  let lastPercent = 0;
  const reportPercent = (percent?: number, message?: string) => {
    if (typeof percent !== 'number' || Number.isNaN(percent)) {
      return;
    }
    const bounded = Math.max(0, Math.min(100, percent));
    const increment = Math.max(0, bounded - lastPercent);
    lastPercent = Math.max(lastPercent, bounded);
    progress.report({
      message: message ?? `Working… ${bounded}%`,
      ...(increment > 0 ? { increment } : {}),
    });
  };

  const describePayload = (payload: Partial<TransformProgress> & { message?: string }): string | undefined => {
    if (payload.message) {
      return payload.message;
    }
    if (typeof payload.processed === 'number' && typeof payload.total === 'number') {
      return `Applying ${payload.processed}/${payload.total}`;
    }
    if (payload.stage) {
      return `Stage: ${payload.stage}`;
    }
    return undefined;
  };

  const parsePayload = (raw: string): (Partial<TransformProgress> & { message?: string }) | null => {
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Partial<TransformProgress> & { message?: string };
      }
    } catch {
      const payload: Partial<TransformProgress> & { message?: string } = {};
      const percentMatch = raw.match(/percent[:=]\s*(\d+)/i);
      const processedMatch = raw.match(/processed[:=]\s*(\d+)/i);
      const totalMatch = raw.match(/total[:=]\s*(\d+)/i);
      const stageMatch = raw.match(/stage[:=]\s*([a-z-]+)/i);
      const messageMatch = raw.match(/message[:=]\s*(.+)$/i);
      if (percentMatch) payload.percent = Number(percentMatch[1]);
      if (processedMatch) payload.processed = Number(processedMatch[1]);
      if (totalMatch) payload.total = Number(totalMatch[1]);
      if (stageMatch) payload.stage = stageMatch[1] as TransformProgress['stage'];
      if (messageMatch) payload.message = messageMatch[1].trim();
      if (Object.keys(payload).length) {
        return payload;
      }
    }
    return null;
  };

  const handleLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    if (line.startsWith('[progress]')) {
      const payload = parsePayload(line.slice('[progress]'.length).trim());
      if (payload) {
        if ((payload.percent === undefined || Number.isNaN(payload.percent)) &&
            typeof payload.processed === 'number' &&
            typeof payload.total === 'number' &&
            payload.total > 0) {
          payload.percent = Math.min(100, Math.round((payload.processed / payload.total) * 100));
        }
        reportPercent(payload.percent, describePayload(payload));
        return;
      }
    }

    const applyMatch = line.match(/Applying transforms .*\((\d+)%\)/i);
    if (applyMatch) {
      reportPercent(Number(applyMatch[1]), line.replace(/\s+/g, ' ').trim());
    }
  };

  const feedText = (text: string) => {
    buffer += text.replace(/\r/g, '\n');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      handleLine(line);
      newlineIndex = buffer.indexOf('\n');
    }
  };

  return {
    handleChunk(text: string) {
      feedText(text);
    },
    flush() {
      if (buffer.trim()) {
        handleLine(buffer);
        buffer = '';
      }
    },
    complete() {
      if (lastPercent < 100) {
        reportPercent(100, 'Completed.');
      } else {
        progress.report({ message: 'Completed.' });
      }
    },
  };
}

async function cleanupPreviewArtifacts(...paths: Array<string | null | undefined>): Promise<void> {
  for (const target of paths) {
    if (!target) {
      continue;
    }
    try {
      await fsp.unlink(target);
      logVerbose(`Removed preview artifact: ${target}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code && code !== 'ENOENT') {
        logVerbose(`Failed to remove preview artifact ${target}: ${(error as Error).message}`);
      }
    }
  }
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
  const obj = parseLastCliJson(stdout);
  if (!obj) return null;

  if (isRecord(obj.sync)) {
    const sync = obj.sync;
    const added = coerceCount(sync['added']);
    const removed = coerceCount(sync['removed']);
    const updated = coerceCount(sync['updated']);
    return `Sync completed: ${added} added, ${updated} updated, ${removed} removed`;
  }
  if (isRecord(obj.result) && obj.result['renamed']) {
    const renamed = obj.result['renamed'];
    if (Array.isArray(renamed)) return `Renamed ${renamed.length} key(s)`;
    return 'Rename completed';
  }
  if (obj['renamed']) {
    const renamed = obj['renamed'];
    if (Array.isArray(renamed)) return `Renamed ${renamed.length} key(s)`;
    return 'Rename completed';
  }
  if (obj['status'] === 'ok' && typeof obj['message'] === 'string') {
    return obj['message'] as string;
  }
  return null;
}

function extractCliWarnings(stdout: string): string[] {
  const obj = parseLastCliJson(stdout);
  if (!obj) {
    return [];
  }

  const warnings: string[] = [];
  const sync = isRecord(obj.sync) ? obj.sync : obj;
  const dynamicWarningsValue = sync['dynamicKeyWarnings'];
  const dynamicWarnings = Array.isArray(dynamicWarningsValue) ? dynamicWarningsValue : [];
  if (dynamicWarnings.length) {
    const message =
      dynamicWarnings.length === 1
        ? '1 dynamic translation key detected. Use “Whitelist dynamic keys” to ignore known runtime patterns.'
        : `${dynamicWarnings.length} dynamic translation keys detected. Use “Whitelist dynamic keys” to ignore known runtime patterns.`;
    warnings.push(message);
  }
  return warnings;
}

function parseLastCliJson(stdout: string): Record<string, unknown> | null {
  const text = stdout?.trim();
  if (!text) {
    return null;
  }
  const lastBrace = text.lastIndexOf('{');
  if (lastBrace === -1) {
    return null;
  }
  try {
    const parsed = JSON.parse(text.slice(lastBrace));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function coerceCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length;
  }
  return typeof value === 'number' ? value : 0;
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
