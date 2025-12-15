import * as vscode from 'vscode';
import { DiagnosticsManager } from './diagnostics';
import { I18nCodeLensProvider } from './codelens';
import { ReportWatcher } from './watcher';
import { I18nHoverProvider } from './hover';
import { I18nCodeActionProvider } from './codeactions';
import { SmartScanner, type ScanResult } from './scanner';
import { StatusBarManager } from './statusbar';
import { I18nDefinitionProvider } from './definition';
import {
  ensureGitignore,
} from '@i18nsmith/core';
import type { TransformProgress } from '@i18nsmith/transformer';
import { resolveCliCommand } from './cli-utils';
import { runResolvedCliCommand } from './cli-runner';
import {
  parsePreviewableCommand,
  type PreviewableCommand,
} from './preview-intents';
import { summarizeReportIssues } from './report-utils';
import { registerMarkdownPreviewProvider } from './markdown-preview';
import { ServiceContainer } from './services/container';
import { ConfigurationController } from './controllers/configuration-controller';
import { SyncController } from './controllers/sync-controller';
import { TransformController } from './controllers/transform-controller';
import { ExtractionController } from './controllers/extraction-controller';

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

let verboseOutputChannel: vscode.OutputChannel;

let configController: ConfigurationController;
let syncController: SyncController;
let transformController: TransformController;
let extractionController: ExtractionController;



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

  // Initialize Service Container
  const services = new ServiceContainer(context);
  
  // Assign globals for backward compatibility
  verboseOutputChannel = services.verboseOutputChannel;
  smartScanner = services.smartScanner;
  statusBarManager = services.statusBarManager;
  diagnosticsManager = services.diagnosticsManager;
  hoverProvider = services.hoverProvider;
  reportWatcher = services.reportWatcher;

  // Initialize Controllers
  configController = new ConfigurationController(services);
  context.subscriptions.push(configController);
  
  syncController = new SyncController(services, configController);
  context.subscriptions.push(syncController);
  
  transformController = new TransformController(services);
  context.subscriptions.push(transformController);
  
  extractionController = new ExtractionController(services);
  context.subscriptions.push(extractionController);

  registerMarkdownPreviewProvider(context);



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

  // Initialize CodeLens provider
  const codeLensProvider = new I18nCodeLensProvider(services.diagnosticsManager);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(supportedLanguages, codeLensProvider)
  );

  // Initialize Hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(supportedLanguages, services.hoverProvider)
  );

  // Initialize Definition provider (Go to Definition on translation keys)
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(supportedLanguages, new I18nDefinitionProvider())
  );

  // Initialize CodeAction provider
  const codeActionProvider = new I18nCodeActionProvider(services.diagnosticsManager);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguages,
      codeActionProvider,
      { providedCodeActionKinds: I18nCodeActionProvider.providedCodeActionKinds }
    )
  );

  // Connect scanner to diagnostics refresh
  services.smartScanner.onScanComplete(() => {
    services.hoverProvider.clearCache();
    services.reportWatcher.refresh();
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('i18nsmith.check', async () => {
      await runHealthCheckWithSummary({ revealOutput: true });
    }),
    vscode.commands.registerCommand('i18nsmith.sync', async () => {
      await syncController.runSync({ dryRunOnly: false });
    }),
    vscode.commands.registerCommand('i18nsmith.syncFile', async () => {
      await syncController.syncCurrentFile();
    }),
    vscode.commands.registerCommand('i18nsmith.refreshDiagnostics', async () => {
      await refreshDiagnosticsWithMessage('command');
    }),
    // vscode.commands.registerCommand('i18nsmith.addPlaceholder', async (key: string, workspaceRoot: string) => {
    //   await addPlaceholderWithPreview(key, workspaceRoot);
    // }),
    vscode.commands.registerCommand('i18nsmith.extractKey', async (uri: vscode.Uri, range: vscode.Range, text: string) => {
      await extractionController.extractKeyFromSelection(uri, range, text);
    }),
    vscode.commands.registerCommand('i18nsmith.actions', async () => {
      await showQuickActions();
    }),
    // vscode.commands.registerCommand('i18nsmith.renameSuspiciousKey', async (warning: SuspiciousKeyWarning) => {
    //   await renameSuspiciousKey(warning);
    // }),
    // vscode.commands.registerCommand('i18nsmith.renameAllSuspiciousKeys', async () => {
    //   await renameAllSuspiciousKeys();
    // }),
    // vscode.commands.registerCommand('i18nsmith.ignoreSuspiciousKey', async (uri: vscode.Uri, line: number) => {
    //   await insertIgnoreComment(uri, line, 'suspicious-key');
    // }),
    // vscode.commands.registerCommand('i18nsmith.openLocaleFile', async () => {
    //   await openSourceLocaleFile();
    // }),
    // vscode.commands.registerCommand('i18nsmith.renameKey', async () => {
    //   await renameKeyAtCursor();
    // }),
    // vscode.commands.registerCommand('i18nsmith.checkFile', async () => {
    //   await checkCurrentFile();
    // }),
    vscode.commands.registerCommand('i18nsmith.extractSelection', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage('Select some text first to extract as a translation key');
        return;
      }
      const text = editor.document.getText(editor.selection);
      await extractionController.extractKeyFromSelection(editor.document.uri, editor.selection, text);
    }),
    vscode.commands.registerCommand('i18nsmith.showOutput', () => {
      services.smartScanner.showOutput();
    }),
    vscode.commands.registerCommand('i18nsmith.transformFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        await transformController.runTransform({ targets: [editor.document.uri.fsPath] });
      } else {
        vscode.window.showWarningMessage('Open a file to transform.');
      }
    }),
    // vscode.commands.registerCommand('i18nsmith.exportMissingTranslations', async () => {
    //   await exportMissingTranslations();
    // }),
    vscode.commands.registerCommand('i18nsmith.whitelistDynamicKeys', async () => {
      await configController.whitelistDynamicKeys();
    }),
    // vscode.commands.registerCommand('i18nsmith.renameSuspiciousKeysInFile', async (target?: vscode.Uri) => {
    //   await renameSuspiciousKeysInFile(target);
    // }),
    // vscode.commands.registerCommand('i18nsmith.applySuspiciousRenamePlan', async () => {
    //   await applyStoredSuspiciousRenamePlan();
    // }),
    // vscode.commands.registerCommand('i18nsmith.showSuspiciousRenamePreview', async () => {
    //   await revealSuspiciousRenamePreview();
    // }),

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





export function deactivate() {
  console.log('i18nsmith extension deactivated');
}











/**
 * Preview UX helpers: every action should present the same sequence
 * 1. Summarize findings (non-modal notification) with optional "Preview" button
 * 2. If the user previews diffs, leave a persistent Apply/Cancel notification
 * 3. Applying runs via CLI progress, cancelling leaves preview artifacts untouched
 */

















// Removed local definitions of persistDynamicKeyAssumptions, loadDynamicWhitelistSnapshot, DynamicWhitelistSnapshot
// as they are now imported from workspace-config.ts



























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
  const rawDynamicWarningCount = Array.isArray(syncSection?.dynamicKeyWarnings)
    ? syncSection.dynamicKeyWarnings.length
    : 0;
  const dynamicWarningCount = rawDynamicWarningCount;
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
    picks.push({ label: 'Default actions', kind: vscode.QuickPickItemKind.Separator });
  }

  if (hasSelection) {
    picks.push({
      label: '$(pencil) Extract selection as key',
      description: 'Create a translation key from selection and replace',
      builtin: 'extract-selection',
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
      await extractionController.extractKeyFromSelection(editor.document.uri, selection!, text);
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
      await configController.whitelistDynamicKeys();
      break;
    }
    case 'rename-suspicious': {
      // await renameAllSuspiciousKeys();
      vscode.window.showInformationMessage('Rename all suspicious keys is currently disabled during refactoring.');
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
    await syncController.runSync({ targets: intent.targets });
    return;
  }

  if (intent.kind === 'transform') {
    await transformController.runTransform({ targets: intent.targets });
    return;
  }

  if (intent.kind === 'rename-key') {
    // await runRenameCommand({ from: intent.from, to: intent.to });
    vscode.window.showInformationMessage('Rename key preview is currently disabled during refactoring.');
    return;
  }

  if (intent.kind === 'translate') {
    // await runTranslateCommand(intent.options);
    vscode.window.showInformationMessage('Translate preview is currently disabled during refactoring.');
  }
}


async function runCliCommand(
  rawCommand: string,
  options: {
    interactive?: boolean;
    confirmMessage?: string;
    progress?: vscode.Progress<{ message?: string; increment?: number }>;
  } = {}
): Promise<CliRunResult | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder found');
    return;
  }

  const resolved = resolveCliCommand(rawCommand);
  if (!resolved.command) {
    vscode.window.showErrorMessage('Unable to determine CLI command to run.');
    return;
  }

  logVerbose(`runCliCommand: raw='${rawCommand}' resolved='${resolved.display}'`);

  if (options.confirmMessage || options.interactive) {
    const detailLines: string[] = [];
    if (options.confirmMessage) {
      detailLines.push(options.confirmMessage);
    }
    if (options.interactive) {
      detailLines.push('This command may scaffold files or install dependencies and will run in the i18nsmith terminal.');
    }
  detailLines.push('', `Command: ${resolved.display}`);
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
  terminal.sendText(resolved.display, true);
    vscode.window.showInformationMessage(
      'Command started in the integrated terminal. Refresh diagnostics once it completes.'
    );
    return undefined;
  }

  const out = vscode.window.createOutputChannel('i18nsmith');
  out.show();
  out.appendLine(`$ ${resolved.display}`);

  const progressTracker = createCliProgressTracker(options.progress);

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  // Safety net: some CLI versions still prompt for confirmation during prune operations.
  // If that happens, auto-confirm so the VS Code progress notification doesn't hang forever.
  // (We also pass `--yes` in the command builder; this is a fallback.)
  const shouldAutoConfirm =
    !options.interactive && /\bi18nsmith\b[\s\S]*\bsync\b[\s\S]*--apply-preview/.test(rawCommand);

  const handleAutoConfirm = (text: string, child: import('child_process').ChildProcessWithoutNullStreams) => {
    if (!shouldAutoConfirm) {
      return;
    }
    if (/(\(y\/N\))|(\(Y\/n\))/i.test(text) || /Remove these\s+\d+\s+unused keys\?/i.test(text)) {
      logVerbose('runCliCommand: detected confirmation prompt; auto-sending "y"');
      try {
        child.stdin?.write('y\n');
      } catch {
        // ignore write errors
      }
    }
  };

  const result = await runResolvedCliCommand(resolved, {
    cwd: workspaceFolder.uri.fsPath,
    onStdout: (text, child) => {
      stdoutChunks.push(text);
      out.append(text);
      progressTracker?.handleChunk(text);
      handleAutoConfirm(text, child);
    },
    onStderr: (text, child) => {
      stderrChunks.push(text);
      out.append(text);
      handleAutoConfirm(text, child);
    },
  });

  progressTracker?.flush();

  const stdout = stdoutChunks.join('');
  const stderr = stderrChunks.join('');
  const warnings: string[] = []; // Warnings extraction removed

  if (result.code !== 0 || result.error) {
    const message = result.error?.message || `Command exited with code ${result.code}`;
    out.appendLine(`[error] ${message}`);
    vscode.window.showErrorMessage(`Command failed: ${message}`);
    return { success: false, stdout, stderr, warnings };
  }

  vscode.window.showInformationMessage('Command completed');

  progressTracker?.complete();
  await reportWatcher?.refresh();
  if (smartScanner) {
    await smartScanner.scan('suggested-command');
  }
  return { success: true, stdout, stderr, warnings };
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



function ensureInteractiveTerminal(cwd: string): vscode.Terminal {
  if (!interactiveTerminal) {
    interactiveTerminal = vscode.window.createTerminal({ name: 'i18nsmith tasks', cwd });
  }
  return interactiveTerminal;
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
