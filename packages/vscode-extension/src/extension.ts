import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { DiagnosticsManager } from "./diagnostics";
import { I18nCodeLensProvider } from "./codelens";
import { ReportWatcher } from "./watcher";
import { I18nHoverProvider } from "./hover";
import { I18nCodeActionProvider } from "./codeactions";
import { SmartScanner, type ScanResult } from "./scanner";
import { StatusBarManager } from "./statusbar";
import { I18nDefinitionProvider } from "./definition";
import {
  parsePreviewableCommand,
  type PreviewableCommand,
} from "./preview-intents";
import { summarizeReportIssues } from "./report-utils";
import { registerMarkdownPreviewProvider } from "./markdown-preview";
import { ServiceContainer } from "./services/container";
import { CliService } from "./services/cli-service";
import { ConfigurationController } from "./controllers/configuration-controller";
import { SyncController } from "./controllers/sync-controller";
import { TransformController } from "./controllers/transform-controller";
import { ExtractionController } from "./controllers/extraction-controller";
import { FrameworkDetectionService } from "./services/framework-detection-service";
import { SuspiciousKeyWarning } from "@i18nsmith/core";
import {
  buildQuickActionModel,
  type QuickActionBuildOutput,
  type QuickActionDefinition,
  type QuickActionMetadata,
} from "./quick-actions-data";
import { QuickActionsProvider } from "./views/quick-actions-provider";
import type { ConfigurationService } from "./services/configuration-service";

interface QuickActionPick extends vscode.QuickPickItem {
  action?: QuickActionDefinition;
}

const QUICK_ACTION_SCAN_STALE_MS = 4000;
const QUICK_ACTION_INSTANT_COMMANDS = new Set([
  "i18nsmith.openLocaleFile",
  "i18nsmith.showOutput",
  "i18nsmith.refreshDiagnostics",
  "i18nsmith.extractSelection",
  "i18nsmith.check",
  "i18nsmith.sync",
  "i18nsmith.syncFile",
  "i18nsmith.transformFile",
  "i18nsmith.exportMissingTranslations",
  "i18nsmith.renameAllSuspiciousKeys",
]);
const QUICK_ACTION_OUTPUT_COMMANDS = new Set([
  "i18nsmith.check",
  "i18nsmith.sync",
  "i18nsmith.syncFile",
  "i18nsmith.transformFile",
  "i18nsmith.exportMissingTranslations",
  "i18nsmith.renameAllSuspiciousKeys",
]);

let diagnosticsManager: DiagnosticsManager;
let reportWatcher: ReportWatcher;
let hoverProvider: I18nHoverProvider;
let smartScanner: SmartScanner;
let statusBarManager: StatusBarManager;

let verboseOutputChannel: vscode.OutputChannel;
// Expose the service container so other extension-level helpers can inspect
// transient runtime state (e.g. whether a preview UI was shown).
let services: ServiceContainer;

let configController: ConfigurationController;
let syncController: SyncController;
let transformController: TransformController;
let extractionController: ExtractionController;
let cliService: CliService;
let quickActionsProvider: QuickActionsProvider | null = null;
let quickActionSelectionState = false;
let configurationService: ConfigurationService | null = null;
let lastScanResult: ScanResult | null = null;
let detectedAdapter: string | undefined;

function logVerbose(message: string) {
  const config = vscode.workspace.getConfiguration("i18nsmith");
  if (config.get<boolean>("enableVerboseLogging", false)) {
    verboseOutputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

async function refreshDiagnosticsWithMessage(
  source: "command" | "quick-action" = "command"
) {
  hoverProvider.clearCache();
  await reportWatcher.refresh();
  statusBarManager.refresh();

  const message = buildDiagnosticsRefreshMessage();
  if (message) {
    vscode.window.setStatusBarMessage(
      message,
      source === "command" ? 5000 : 3500
    );
  }
}

function buildDiagnosticsRefreshMessage(): string | null {
  const report = diagnosticsManager?.getReport?.();
  if (!report) {
    return "$(symbol-event) i18nsmith: Diagnostics refreshed.";
  }

  const summary = summarizeReportIssues(report);
  const actionableItems = summary.issueCount;
  const suggestions = report.suggestedCommands?.length ?? 0;
  const missing = report.sync?.missingKeys?.length ?? 0;
  const unused = report.sync?.unusedKeys?.length ?? 0;

  const parts: string[] = ["$(symbol-event) i18nsmith: Diagnostics refreshed"];
  parts.push(`• ${actionableItems} issue${actionableItems === 1 ? "" : "s"}`);
  if (suggestions) {
    parts.push(`• ${suggestions} suggestion${suggestions === 1 ? "" : "s"}`);
  }
  if (missing || unused) {
    parts.push(`• Drift: ${missing} missing / ${unused} unused`);
  }
  return parts.join("  ");
}

async function runHealthCheckWithSummary(
  options: { revealOutput?: boolean } = {}
) {
  if (!smartScanner) {
    return;
  }

  if (options.revealOutput) {
    smartScanner.showOutput();
  }

  const result = await smartScanner.scan("manual");
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
    "View Quick Actions",
    "Show Output"
  );

  if (choice === "View Quick Actions") {
    await vscode.commands.executeCommand("i18nsmith.actions");
    return;
  }

  if (choice === "Show Output") {
    smartScanner.showOutput();
  }
}

function buildHealthCheckSummary(
  result: ScanResult | null
): { title: string; detail: string } | null {
  const report = diagnosticsManager?.getReport?.();
  const summary = summarizeReportIssues(report);
  const actionableItems = summary.items;

  const filesWithIssues = new Set(
    actionableItems
      .map((item) => item.filePath)
      .filter((filePath): filePath is string => Boolean(filePath))
  );

  const suggestionCount = report?.suggestedCommands?.length ?? 0;
  const issueCount = summary.issueCount || result?.issueCount || 0;

  const title = issueCount
    ? `i18nsmith health check: ${issueCount} issue${issueCount === 1 ? "" : "s"} detected`
    : "i18nsmith health check: No issues detected";

  const details: string[] = [];
  details.push(`• ${issueCount} actionable item${issueCount === 1 ? "" : "s"}`);
  if (filesWithIssues.size) {
    details.push(
      `• ${filesWithIssues.size} file${filesWithIssues.size === 1 ? "" : "s"} with diagnostics`
    );
  }
  if (suggestionCount) {
    details.push(
      `• ${suggestionCount} recommended action${suggestionCount === 1 ? "" : "s"} ready in Quick Actions`
    );
  }
  if (result?.timestamp) {
    details.push(`• Completed at ${result.timestamp.toLocaleTimeString()}`);
  }
  details.push(
    "Select “View Quick Actions” to start fixing the highest-priority issues."
  );

  return { title, detail: details.join("\n") };
}

export function activate(context: vscode.ExtensionContext) {
  console.log("i18nsmith extension activated");

  // Initialize Service Container
  services = new ServiceContainer(context);

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

  cliService = services.cliService;
  configurationService = services.configurationService;

  context.subscriptions.push(
    services.configurationService.onDidChange(async () => {
      services.hoverProvider.clearCache();
      await services.reportWatcher.refresh();
      await services.smartScanner.scan("config-change");
    })
  );

  registerMarkdownPreviewProvider(context);

  // Ensure .gitignore has i18nsmith artifacts listed (non-blocking)
  cliService.ensureGitignoreEntries();

  // Detect framework adapter for context-aware Quick Actions (non-blocking)
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    services.frameworkDetectionService.detectFramework(workspaceRoot).then((info) => {
      detectedAdapter = info.adapter;
    }).catch(() => { /* ignore detection failures */ });
  }

  quickActionsProvider = new QuickActionsProvider();
  const quickActionsView = vscode.window.createTreeView(
    "i18nsmith.quickActionsView",
    {
      treeDataProvider: quickActionsProvider,
      showCollapseAll: false,
    }
  );
  context.subscriptions.push(quickActionsProvider, quickActionsView);

  const supportedLanguages = [
    { scheme: "file", language: "typescript" },
    { scheme: "file", language: "typescriptreact" },
    { scheme: "file", language: "javascript" },
    { scheme: "file", language: "javascriptreact" },
    { scheme: "file", language: "vue" },
    { scheme: "file", language: "svelte" },
  ];

  // Initialize CodeLens provider
  const codeLensProvider = new I18nCodeLensProvider(
    services.diagnosticsManager
  );
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      supportedLanguages,
      codeLensProvider
    )
  );

  // Initialize Hover provider
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      supportedLanguages,
      services.hoverProvider
    )
  );

  // Initialize Definition provider (Go to Definition on translation keys)
  const definitionProvider = new I18nDefinitionProvider(
    services.configurationService
  );
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      supportedLanguages,
      definitionProvider
    )
  );

  // Initialize CodeAction provider
  const codeActionProvider = new I18nCodeActionProvider(
    services.diagnosticsManager,
    services.configurationService
  );
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguages,
      codeActionProvider,
      {
        providedCodeActionKinds: I18nCodeActionProvider.providedCodeActionKinds,
      }
    )
  );

  // Connect scanner to diagnostics refresh
  services.smartScanner.onScanComplete((result) => {
    lastScanResult = result;
    services.hoverProvider.clearCache();
    if (!result.success) {
      // Clear diagnostics when scan fails to avoid showing stale results
      services.diagnosticsManager.clear();
      refreshQuickActionsModel({ silent: true });
    }
    services.reportWatcher.refresh();
    codeLensProvider.refresh();
  });

  // Refresh CodeLens when report watcher detects file changes
  services.reportWatcher.onDidRefresh(() => {
    codeLensProvider.refresh();
  });

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("i18nsmith.check", async () => {
      await runHealthCheckWithSummary({ revealOutput: true });
    }),
    vscode.commands.registerCommand("i18nsmith.sync", async () => {
      await syncController.runSync({ dryRunOnly: false });
    }),
    vscode.commands.registerCommand("i18nsmith.syncFile", async () => {
      await syncController.syncCurrentFile();
    }),
    vscode.commands.registerCommand(
      "i18nsmith.refreshDiagnostics",
      async () => {
        await refreshDiagnosticsWithMessage("command");
      }
    ),
    vscode.commands.registerCommand(
      "i18nsmith.extractKey",
      async (uri: vscode.Uri, range: vscode.Range, text: string) => {
        await extractionController.extractKeyFromSelection(uri, range, text);
      }
    ),
    vscode.commands.registerCommand("i18nsmith.actions", async () => {
      await showQuickActions();
    }),
    vscode.commands.registerCommand(
      "i18nsmith.quickActions.executeDefinition",
      async (action: QuickActionDefinition) => {
        await runQuickActionDefinition(action);
      }
    ),
    vscode.commands.registerCommand("i18nsmith.applyPreviewPlan", async () => {
      await services.previewPlanService.applyActivePlan();
    }),
    vscode.commands.registerCommand(
      "i18nsmith.renameSuspiciousKey",
      async (warning: SuspiciousKeyWarning) => {
        await syncController.renameSuspiciousKey(warning);
      }
    ),
    vscode.commands.registerCommand(
      "i18nsmith.renameAllSuspiciousKeys",
      async () => {
        await syncController.renameAllSuspiciousKeys();
      }
    ),
    vscode.commands.registerCommand(
      "i18nsmith.renameSuspiciousKeysInFile",
      async () => {
        await syncController.renameSuspiciousKeysInFile();
      }
    ),
    vscode.commands.registerCommand("i18nsmith.openLocaleFile", async () => {
      await openSourceLocaleFile();
    }),
    vscode.commands.registerCommand("i18nsmith.extractSelection", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showWarningMessage(
          "Select some text first to extract as a translation key"
        );
        return;
      }
      const text = editor.document.getText(editor.selection);
      await extractionController.extractKeyFromSelection(
        editor.document.uri,
        editor.selection,
        text
      );
    }),
    vscode.commands.registerCommand("i18nsmith.init", async () => {
      const autoScaffold = vscode.workspace
        .getConfiguration("i18nsmith")
        .get<boolean>("autoScaffold", false);
      const command = autoScaffold ? "i18nsmith init --scaffold" : "i18nsmith init";
      await cliService.runCliCommand(command, { interactive: true });
    }),
    vscode.commands.registerCommand("i18nsmith.transformFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor found");
        return;
      }
      const filePath = editor.document.uri.fsPath;
      await transformController.runTransform({ targets: [filePath] });
    }),
    vscode.commands.registerCommand("i18nsmith.showOutput", () => {
      services.smartScanner.showOutput();
    }),
    vscode.commands.registerCommand("i18nsmith.checkFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor found");
        return;
      }
      // Run a scan and refresh; the diagnostics already filter per-file
      await runHealthCheckWithSummary({ revealOutput: false });
    }),
    vscode.commands.registerCommand("i18nsmith.renameKey", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor found");
        return;
      }
      const document = editor.document;
      const position = editor.selection.active;
      const line = document.lineAt(position.line).text;
      const keyMatch = line.match(/\$?t\(\s*['"`]([^'"`]+)['"`]/);
      if (!keyMatch) {
        vscode.window.showWarningMessage("Place cursor on a t() or $t() call to rename the key.");
        return;
      }
      const oldKey = keyMatch[1];
      const newKey = await vscode.window.showInputBox({
        prompt: `Rename key "${oldKey}" to:`,
        value: oldKey,
        placeHolder: "e.g., common.new_key_name",
      });
      if (!newKey || newKey === oldKey) {
        return;
      }
      await syncController.renameKey(oldKey, newKey);
    }),
    vscode.commands.registerCommand("i18nsmith.ignoreSuspiciousKey", async (uri: vscode.Uri, line: number) => {
      if (!uri || typeof line !== 'number') {
        return;
      }
      const document = await vscode.workspace.openTextDocument(uri);
      const edit = new vscode.WorkspaceEdit();
      const lineText = document.lineAt(line).text;
      const indent = lineText.match(/^(\s*)/)?.[1] ?? '';
      edit.insert(uri, new vscode.Position(line, 0), `${indent}// i18nsmith-ignore-next-line\n`);
      await vscode.workspace.applyEdit(edit);
      await reportWatcher?.refresh();
    }),
    vscode.commands.registerCommand("i18nsmith.exportMissingTranslations", async () => {
      await syncController.exportMissingTranslations();
    })
    ,
    vscode.commands.registerCommand("i18nsmith.whitelistDynamicKeys", async () => {
      // Launch the dynamic key whitelist flow (shows QuickPick and persists selections)
      await configController.whitelistDynamicKeys();
    })
  );

  // Trigger an initial refresh of the report on startup so diagnostics appear immediately
  // if a report file already exists.
  void services.reportWatcher.refresh().catch((err) => {
    console.error("Initial report refresh failed:", err);
  });
}

export function deactivate() {
  // Clean up
}

/**
 * Preview UX helpers: every action should present the same sequence
 * 1. Summarize findings (non-modal notification) with optional "Preview" button
 * 2. If the user previews diffs, leave a persistent Apply/Cancel notification
 * 3. Applying runs via CLI progress, cancelling leaves preview artifacts untouched
 */

// Removed local definitions of persistDynamicKeyAssumptions, loadDynamicWhitelistSnapshot, DynamicWhitelistSnapshot
// as they are now imported from workspace-config.ts

function refreshQuickActionsModel(
  options: { silent?: boolean } = {}
): QuickActionBuildOutput {
  const report = diagnosticsManager?.getReport?.() ?? null;
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const model = buildQuickActionModel({
    report,
    hasSelection: getQuickActionSelectionState(),
    scanResult: lastScanResult,
    detectedAdapter,
    workspaceRoot,
  });

  if (quickActionsProvider) {
    quickActionsProvider.update(model);
  }

  if (!options.silent) {
    applyQuickActionContexts(model);
  } else if (!quickActionsProvider) {
    // Ensure contexts still get set at least once when provider is not ready
    applyQuickActionContexts(model);
  }

  return model;
}

function applyQuickActionContexts(model: QuickActionBuildOutput) {
  const hasActions = model.sections.some(
    (section) => section.actions.length > 0
  );
  vscode.commands.executeCommand(
    "setContext",
    "i18nsmith.runtimeReady",
    model.metadata.runtimeReady
  );
  vscode.commands.executeCommand(
    "setContext",
    "i18nsmith.quickActions.hasActions",
    hasActions
  );
}

function getQuickActionSelectionState(): boolean {
  const editor = vscode.window.activeTextEditor;
  return Boolean(editor && !editor.selection.isEmpty);
}

function buildQuickPickPlaceholder(metadata: QuickActionMetadata): string {
  const parts: string[] = [];
  if (metadata.issueCount) {
    parts.push(
      `${metadata.issueCount} outstanding issue${metadata.issueCount === 1 ? "" : "s"}`
    );
  }
  if (metadata.driftStats) {
    parts.push(
      `Drift: ${metadata.driftStats.missing} missing / ${metadata.driftStats.unused} unused`
    );
  }
  if (metadata.suggestionsCount) {
    parts.push(
      `${metadata.suggestionsCount} suggestion${metadata.suggestionsCount === 1 ? "" : "s"}`
    );
  }
  if (!parts.length) {
    parts.push("All clear – run health check to refresh diagnostics");
  }
  return `Select a quick action (${parts.join(" • ")})`;
}

function createQuickPickItem(action: QuickActionDefinition): QuickActionPick {
  const label = action.iconId
    ? `$(${action.iconId}) ${action.title}`
    : action.title;
  const detailParts: string[] = [];
  if (action.iconLabel) {
    detailParts.push(action.iconLabel);
  }
  if (action.detail) {
    detailParts.push(action.detail);
  }
  return {
    label,
    description: action.description,
    detail: detailParts.length ? detailParts.join(" • ") : undefined,
    action,
  };
}

async function runQuickActionDefinition(action: QuickActionDefinition) {
  if (action.confirmMessage) {
    const confirm = await vscode.window.showWarningMessage(
      action.confirmMessage,
      { modal: true },
      "Run"
    );
    if (confirm !== "Run") {
      return;
    }
  }

  const runner = async () => {
    if (action.previewIntent) {
      await executePreviewIntent(action.previewIntent);
      return;
    }

    if (!action.command) {
      vscode.window.showWarningMessage(
        "This quick action is not yet wired to a command."
      );
      return;
    }

    if (action.command.startsWith("i18nsmith.")) {
      await vscode.commands.executeCommand(action.command);
      return;
    }

    const handled = await tryHandlePreviewableCommand(action.command);
    if (!handled) {
      vscode.window.showWarningMessage(
        `Unsupported quick action command: ${action.command}`
      );
    }
  };

  if (shouldShowQuickActionProgress(action)) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `i18nsmith: ${action.title}`,
      },
      runner
    );
  } else {
    await runner();
  }

  await offerQuickActionOutputLink(action);
}

async function showQuickActions() {
  await ensureFreshDiagnosticsForQuickActions();
  const model = refreshQuickActionsModel();
  const metadata = model.metadata;
  const driftStats = metadata.driftStats;

  if (driftStats) {
    const totalDrift = driftStats.missing + driftStats.unused;
    logVerbose(
      `showQuickActions: Drift detected - ${driftStats.missing} missing, ${driftStats.unused} unused (total: ${totalDrift})`
    );
    if (totalDrift > 10) {
      const parts: string[] = [];
      if (driftStats.missing > 0) parts.push(`${driftStats.missing} missing`);
      if (driftStats.unused > 0) parts.push(`${driftStats.unused} unused`);
      vscode.window.showInformationMessage(
        `i18nsmith detected ${totalDrift} locale drift issues: ${parts.join(", ")}`
      );
    }
  }

  const quickPickItems: QuickActionPick[] = [];
  for (const section of model.sections) {
    if (!section.actions.length) {
      continue;
    }
    quickPickItems.push({
      label: section.title,
      kind: vscode.QuickPickItemKind.Separator,
    });
    quickPickItems.push(
      ...section.actions.map((action) => createQuickPickItem(action))
    );
  }

  const hasActions = quickPickItems.some((item) => Boolean(item.action));
  if (!hasActions) {
    vscode.window.showInformationMessage(
      "Nothing to fix right now. Run “i18nsmith: Run Health Check” to refresh diagnostics."
    );
    return;
  }

  const placeholder = buildQuickPickPlaceholder(metadata);
  const choice = (await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: placeholder,
  })) as QuickActionPick | undefined;
  if (
    !choice ||
    choice.kind === vscode.QuickPickItemKind.Separator ||
    !choice.action
  ) {
    return;
  }

  await runQuickActionDefinition(choice.action);
}

async function ensureFreshDiagnosticsForQuickActions() {
  if (!smartScanner) {
    return;
  }

  const lastTimestamp = smartScanner.lastResult?.timestamp?.getTime?.() ?? 0;
  const isFresh =
    smartScanner.lastResult &&
    Date.now() - lastTimestamp <= QUICK_ACTION_SCAN_STALE_MS;

  const runScan = async () => {
    await smartScanner.scan("quick-actions");
    await reportWatcher?.refresh();
  };

  if (isFresh) {
    await runScan();
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: "i18nsmith: Refreshing health report…",
    },
    runScan
  );
}

async function tryHandlePreviewableCommand(
  rawCommand: string
): Promise<boolean> {
  const parsed = parsePreviewableCommand(rawCommand);
  if (!parsed) {
    return false;
  }

  await executePreviewIntent(parsed);
  return true;
}

function shouldShowQuickActionProgress(action: QuickActionDefinition): boolean {
  if (action.interactive) {
    return false;
  }
  if (action.previewIntent) {
    // Preview intents handle their own progress (analysis phase)
    return false;
  }
  if (!action.command) {
    return false;
  }
  if (action.longRunning === false) {
    return false;
  }
  if (QUICK_ACTION_INSTANT_COMMANDS.has(action.command)) {
    return false;
  }
  return true;
}

async function offerQuickActionOutputLink(action: QuickActionDefinition) {
  if (action.previewIntent) {
    // Preview intents handle their own completion UX
    return;
  }

  // If a preview UI was shown to the user as part of this quick action,
  // avoid showing the "finished" notification — the preview flow will
  // surface its own Apply/Done UX when appropriate.
  try {
    if (services?.previewShown) {
      // clear the flag for subsequent actions and skip the offer
      services.previewShown = false;
      return;
    }
  } catch (e) {
    // ignore
  }

  const shouldOffer =
    action.postRunBehavior === "offer-output" ||
    (action.command && QUICK_ACTION_OUTPUT_COMMANDS.has(action.command));

  if (shouldOffer) {
    const choice = await vscode.window.showInformationMessage(
      `i18nsmith: ${action.title} finished.`,
      "Show Output"
    );
    if (choice === "Show Output") {
      smartScanner?.showOutput?.();
    }
    return;
  }

  vscode.window.setStatusBarMessage(
    `i18nsmith: ${action.title} completed.`,
    3000
  );
}

async function executePreviewIntent(intent: PreviewableCommand): Promise<void> {
  if (intent.kind === "sync") {
    // Pass through any extraArgs parsed from the CLI suggestion (e.g. --auto-rename-suspicious)
    // so that the preview includes the same behavior the raw CLI would.
    await syncController.runSync({ targets: intent.targets, extraArgs: intent.extraArgs });
    return;
  }

  if (intent.kind === 'validate-placeholders') {
    await syncController.resolvePlaceholderIssues({ targets: intent.targets, extraArgs: intent.extraArgs });
    return;
  }

  if (intent.kind === "transform") {
    // allow transform extras (e.g. target flags) to be passed through
    await transformController.runTransform({ targets: intent.targets, extraArgs: intent.extraArgs });
    return;
  }

  if (intent.kind === "rename-key") {
    await syncController.renameKey(intent.from, intent.to);
    return;
  }

  if (intent.kind === "translate") {
    // await runTranslateCommand(intent.options);
    vscode.window.showInformationMessage(
      "Translate preview is currently disabled during refactoring."
    );
    return;
  }

  if (intent.kind === "scaffold-adapter") {
    const rawCommand = `i18nsmith scaffold-adapter ${intent.args.join(" ")}`;
    await cliService.runCliCommand(rawCommand, { interactive: true });
    return;
  }
}

async function openSourceLocaleFile() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(
      "Open a workspace to locate your locale files."
    );
    return;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const snapshot = configurationService?.getSnapshot(workspaceRoot);
  const localesDir = snapshot?.localesDir ?? "locales";
  const sourceLanguage = snapshot?.sourceLanguage ?? "en";
  const candidatePaths = buildLocaleCandidatePaths(
    workspaceRoot,
    localesDir,
    sourceLanguage
  );
  const targetPath = candidatePaths.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  if (!targetPath) {
    vscode.window.showWarningMessage(
      `Could not find a ${sourceLanguage} locale file inside ${localesDir}. Update i18n.config.json or create the file first.`
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument(targetPath);
  await vscode.window.showTextDocument(document, { preview: false });
}

function buildLocaleCandidatePaths(
  workspaceRoot: string,
  localesDir: string,
  sourceLanguage: string
): string[] {
  const localeRoot = path.isAbsolute(localesDir)
    ? path.normalize(localesDir)
    : path.join(workspaceRoot, localesDir);
  const normalizedRoot = path.normalize(localeRoot);
  const extensions = [".json", ".jsonc", ".yaml", ".yml", ".ts", ".js"];
  const baseNames = Array.from(
    new Set([sourceLanguage, sourceLanguage.toLowerCase()])
  );
  const candidates: string[] = [];

  for (const base of baseNames) {
    for (const ext of extensions) {
      candidates.push(path.join(normalizedRoot, `${base}${ext}`));
    }
  }

  for (const base of baseNames) {
    const nestedDir = path.join(normalizedRoot, base);
    try {
      if (fs.existsSync(nestedDir) && fs.statSync(nestedDir).isDirectory()) {
        const entries = fs.readdirSync(nestedDir);
        for (const entry of entries) {
          if (/\.(jsonc?|ya?ml|tsx?|jsx?)$/i.test(entry)) {
            candidates.push(path.join(nestedDir, entry));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(new Set(candidates));
}
