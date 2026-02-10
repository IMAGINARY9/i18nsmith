import * as vscode from "vscode";
import { DiagnosticsManager } from "../diagnostics";
import { ReportWatcher } from "../watcher";
import { I18nHoverProvider } from "../hover";
import { SmartScanner } from "../scanner";
import { StatusBarManager } from "../statusbar";
import { CheckIntegration } from "../check-integration";
import { DiffPeekProvider } from "../diff-peek";
import { PreviewManager } from "../preview-manager";
import { PreviewPlanService } from "../preview-flow";
import { CliService } from "./cli-service";
import { DiffPreviewService } from "./diff-preview";
import { ConfigurationService } from "./configuration-service";
import { FrameworkDetectionService } from "./framework-detection-service";
import { OutputChannelService } from "./output-channel-service";
import { DependencyCacheManager } from "./dependency-cache-manager";

export class ServiceContainer implements vscode.Disposable {
  // Set to true when a preview UI (diff/plan) was shown to the user.
  // Used by the extension runtime to avoid showing a premature "finished" notification
  // for quick actions that open interactive previews and wait for user Apply.
  public previewShown: boolean = false;
  public readonly outputChannelService: OutputChannelService;
  public readonly verboseOutputChannel: vscode.OutputChannel;
  public readonly cliOutputChannel: vscode.OutputChannel;
  public readonly primaryOutputChannel: vscode.OutputChannel;
  public readonly diagnosticsManager: DiagnosticsManager;
  public readonly reportWatcher: ReportWatcher;
  public readonly hoverProvider: I18nHoverProvider;
  public readonly smartScanner: SmartScanner;
  public readonly statusBarManager: StatusBarManager;
  public readonly checkIntegration: CheckIntegration;
  public readonly diffPeekProvider: DiffPeekProvider;
  public readonly previewManager: PreviewManager;
  public readonly previewPlanService: PreviewPlanService;
  public readonly cliService: CliService;
  public readonly diffPreviewService: DiffPreviewService;
  public readonly configurationService: ConfigurationService;
  public readonly frameworkDetectionService: FrameworkDetectionService;
  public readonly dependencyCacheManager: DependencyCacheManager;

  constructor(context: vscode.ExtensionContext) {
    this.outputChannelService = new OutputChannelService(context);
    context.subscriptions.push(this.outputChannelService);

    this.verboseOutputChannel = this.outputChannelService.verbose;
    this.cliOutputChannel = this.outputChannelService.cli;
    this.primaryOutputChannel = this.outputChannelService.main;

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

    this.smartScanner = new SmartScanner(
      this.cliService,
      this.primaryOutputChannel
    );
    context.subscriptions.push(this.smartScanner);

    this.statusBarManager = new StatusBarManager(this.smartScanner);
    context.subscriptions.push(this.statusBarManager);

    this.checkIntegration = new CheckIntegration();
    this.diffPeekProvider = new DiffPeekProvider();
    this.previewManager = new PreviewManager(
      this.cliService,
      this.cliOutputChannel
    );
    this.previewPlanService = new PreviewPlanService();
    context.subscriptions.push(this.previewPlanService);
    this.diffPreviewService = new DiffPreviewService(this.diffPeekProvider);
    this.frameworkDetectionService = new FrameworkDetectionService();
    this.dependencyCacheManager = new DependencyCacheManager();
    this.registerDependencyInvalidators();
  }

  private registerDependencyInvalidators(): void {
    // Register Vue parser invalidation
    this.dependencyCacheManager.register('vue-eslint-parser', (workspaceRoot: string) => {
      // Clear AST cache for all open documents
      for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'vue') {
          // Import here to avoid circular dependency
          import('../utils/vue-ast').then(({ clearVueAstCacheFor }) => {
            clearVueAstCacheFor(document);
          });
        }
      }
      // Clear require cache for the parser module
      try {
        const resolved = require.resolve('vue-eslint-parser', { paths: [workspaceRoot] });
        delete require.cache[resolved];
      } catch {
        // ignore if not resolvable
      }
    });
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
