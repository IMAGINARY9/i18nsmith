import * as vscode from "vscode";
import { DiagnosticsManager } from "../diagnostics";
import { ReportWatcher } from "../watcher";
import { I18nHoverProvider } from "../hover";
import { SmartScanner } from "../scanner";
import { StatusBarManager } from "../statusbar";
import { CheckIntegration } from "../check-integration";
import { DiffPeekProvider } from "../diff-peek";
import { PreviewManager } from "../preview-manager";
import { CliService } from "./cli-service";
import { DiffPreviewService } from "./diff-preview";
import { ConfigurationService } from "./configuration-service";

export class ServiceContainer implements vscode.Disposable {
  public readonly verboseOutputChannel: vscode.OutputChannel;
  public readonly cliOutputChannel: vscode.OutputChannel;
  public readonly diagnosticsManager: DiagnosticsManager;
  public readonly reportWatcher: ReportWatcher;
  public readonly hoverProvider: I18nHoverProvider;
  public readonly smartScanner: SmartScanner;
  public readonly statusBarManager: StatusBarManager;
  public readonly checkIntegration: CheckIntegration;
  public readonly diffPeekProvider: DiffPeekProvider;
  public readonly previewManager: PreviewManager;
  public readonly cliService: CliService;
  public readonly diffPreviewService: DiffPreviewService;
  public readonly configurationService: ConfigurationService;

  constructor(context: vscode.ExtensionContext) {
    this.verboseOutputChannel = vscode.window.createOutputChannel(
      "i18nsmith (Verbose)"
    );
    context.subscriptions.push(this.verboseOutputChannel);

    this.cliOutputChannel = vscode.window.createOutputChannel("i18nsmith CLI");
    context.subscriptions.push(this.cliOutputChannel);

    this.diagnosticsManager = new DiagnosticsManager();
    context.subscriptions.push(this.diagnosticsManager);

    this.reportWatcher = new ReportWatcher(this.diagnosticsManager);
    context.subscriptions.push(this.reportWatcher);

    this.hoverProvider = new I18nHoverProvider();
    // Hover provider registration happens in extension.ts for now

    this.configurationService = new ConfigurationService();
    context.subscriptions.push(this.configurationService);

    this.cliService = new CliService(
      this.verboseOutputChannel,
      this.cliOutputChannel,
      this.reportWatcher
    );

    this.smartScanner = new SmartScanner(this.cliService);
    context.subscriptions.push(this.smartScanner);

    this.statusBarManager = new StatusBarManager(this.smartScanner);
    context.subscriptions.push(this.statusBarManager);

    this.checkIntegration = new CheckIntegration();
    this.diffPeekProvider = new DiffPeekProvider();
    this.previewManager = new PreviewManager(
      this.cliService,
      this.cliOutputChannel
    );
    this.diffPreviewService = new DiffPreviewService(this.diffPeekProvider);
  }

  public logVerbose(message: string) {
    const config = vscode.workspace.getConfiguration("i18nsmith");
    if (config.get<boolean>("enableVerboseLogging", false)) {
      this.verboseOutputChannel.appendLine(
        `[${new Date().toISOString()}] ${message}`
      );
    }
  }

  dispose() {
    // Most services are disposed via context.subscriptions
  }
}
