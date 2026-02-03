import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  summarizeReportIssues,
  summarizeSuggestedCommands,
  assessStatusLevel,
  type IssueSeverityLevel,
  type SeverityCounts,
} from './report-utils';
import { quoteCliArg } from './command-helpers';
import { CliService } from './services/cli-service';

export type ScanState = 'idle' | 'scanning' | 'success' | 'error';

export interface ScanResult {
  success: boolean;
  timestamp: Date;
  issueCount: number;
  severityCounts: SeverityCounts;
  dominantSeverity: IssueSeverityLevel;
  suggestionCount: number;
  suggestionSeverityCounts: SeverityCounts;
  suggestionDominantSeverity: IssueSeverityLevel;
  statusLevel: IssueSeverityLevel;
  statusReasons: string[];
  warningCount: number;
  error?: string;
}

type ReportMetrics = Omit<ScanResult, 'success' | 'timestamp' | 'error'>;

function emptyReportMetrics(): ReportMetrics {
  return {
    issueCount: 0,
    severityCounts: { error: 0, warn: 0, info: 0 },
    dominantSeverity: 'none',
    suggestionCount: 0,
    suggestionSeverityCounts: { error: 0, warn: 0, info: 0 },
    suggestionDominantSeverity: 'none',
    statusLevel: 'none',
    statusReasons: ['Workspace healthy'],
    warningCount: 0,
  };
}

/**
 * Smart scanner that manages when and how to run i18nsmith checks.
 * 
 * Scanning triggers:
 * - On activation: background scan (non-blocking)
 * - On source file save: debounced (500ms)
 * - On locale file change: immediate
 * - On config change: full re-scan
 * - Manual command: immediate
 */
export class SmartScanner implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private currentScan: Promise<ScanResult> | null = null;
  
  private _state: ScanState = 'idle';
  private _lastResult: ScanResult | null = null;
  
  private readonly stateChangeEmitter = new vscode.EventEmitter<ScanState>();
  public readonly onStateChange = this.stateChangeEmitter.event;
  
  private readonly scanCompleteEmitter = new vscode.EventEmitter<ScanResult>();
  public readonly onScanComplete = this.scanCompleteEmitter.event;

  // Configuration
  private readonly sourceDebounceMs = 500;
  private readonly localeDebounceMs = 100;
  private scanOnSave = true;
  private scanOnActivation = true;

  constructor(
    private readonly cliService: CliService,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    this.loadConfig();
    this.setupWatchers();
  }

  dispose() {
    this.clearDebounce();
    this.disposables.forEach(d => d.dispose());
    this.stateChangeEmitter.dispose();
    this.scanCompleteEmitter.dispose();
  }

  get state(): ScanState {
    return this._state;
  }

  get lastResult(): ScanResult | null {
    return this._lastResult;
  }

  /**
   * Load configuration from VS Code settings
   */
  private loadConfig() {
    const config = vscode.workspace.getConfiguration('i18nsmith');
    this.scanOnSave = config.get<boolean>('scanOnSave', true);
    this.scanOnActivation = config.get<boolean>('scanOnActivation', true);
  }

  /**
   * Set up file watchers for source and locale files
   */
  private setupWatchers() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return;
    }

    // Watch source files (debounced)
    const sourcePattern = new vscode.RelativePattern(
      workspaceFolder,
      '**/*.{ts,tsx,js,jsx,vue,svelte}'
    );
    const sourceWatcher = vscode.workspace.createFileSystemWatcher(sourcePattern);
    sourceWatcher.onDidChange(() => this.debounceScan('source'));
    sourceWatcher.onDidCreate(() => this.debounceScan('source'));
    sourceWatcher.onDidDelete(() => this.debounceScan('source'));
    this.disposables.push(sourceWatcher);

    // Watch locale files (faster response)
    const localePattern = new vscode.RelativePattern(
      workspaceFolder,
      '**/locales/**/*.json'
    );
    const localeWatcher = vscode.workspace.createFileSystemWatcher(localePattern);
    localeWatcher.onDidChange(() => this.debounceScan('locale'));
    localeWatcher.onDidCreate(() => this.debounceScan('locale'));
    localeWatcher.onDidDelete(() => this.debounceScan('locale'));
    this.disposables.push(localeWatcher);

    // Watch config file (immediate)
    const configPattern = new vscode.RelativePattern(
      workspaceFolder,
      'i18n.config.json'
    );
    const configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);
    configWatcher.onDidChange(() => this.scan('config-change'));
    this.disposables.push(configWatcher);

    // Also listen for document saves (more reliable for edited files)
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        if (!this.scanOnSave) return;
        
        const ext = path.extname(doc.fileName);
        if (['.ts', '.tsx', '.js', '.jsx', '.vue', '.svelte'].includes(ext)) {
          this.debounceScan('source');
        } else if (ext === '.json' && doc.fileName.includes('locale')) {
          this.debounceScan('locale');
        }
      })
    );

    // Listen for config changes
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('i18nsmith')) {
          this.loadConfig();
          this.scan('config-change');
        }
      })
    );
  }

  /**
   * Run initial scan on activation (non-blocking)
   */
  async runActivationScan(): Promise<void> {
    if (!this.scanOnActivation) {
      this.log('[Scanner] Activation scan disabled by configuration');
      return;
    }

    this.log('[Scanner] Running activation scan...');
    // Don't await - let it run in background
    this.scan('activation').catch((err) => {
      this.log(`[Scanner] Activation scan failed: ${err}`);
    });
  }

  /**
   * Debounce a scan request
   */
  private debounceScan(trigger: 'source' | 'locale') {
    this.clearDebounce();
    
    const delay = trigger === 'locale' ? this.localeDebounceMs : this.sourceDebounceMs;
    
    this.debounceTimer = setTimeout(() => {
      this.scan(trigger);
    }, delay);
  }

  private clearDebounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }

  /**
   * Run a scan (coalesces multiple requests)
   */
  async scan(trigger: string = 'manual'): Promise<ScanResult> {
    // If already scanning, return existing promise
    if (this.currentScan) {
      this.log(`[Scanner] Scan already in progress, waiting...`);
      return this.currentScan;
    }

    this.log(`[Scanner] Starting scan (trigger: ${trigger})`);
    this.setState('scanning');

    this.currentScan = this.runCli()
      .then((result) => {
        this._lastResult = result;
        this.setState(result.success ? 'success' : 'error');
        this.scanCompleteEmitter.fire(result);
        if (!result.success) {
          vscode.window
            .showWarningMessage('i18nsmith background scan failed', 'Show Output')
            .then((choice) => {
              if (choice === 'Show Output') {
                this.showOutput();
              }
            });
        }
        return result;
      })
      .finally(() => {
        this.currentScan = null;
      });

    return this.currentScan;
  }

  /**
   * Detect if we're inside the i18nsmith monorepo and return the local CLI path
   */
  private detectLocalMonorepo(): string | null {
    // First try via extension path (works for installed extension in monorepo)
    const extensionPath = vscode.extensions.getExtension('ArturLavrov.i18nsmith-vscode')?.extensionPath;
    if (extensionPath) {
      // If running in the monorepo, the extension is at packages/vscode-extension
      // and the CLI is at packages/cli/dist/index.js
      const possibleCliPath = path.join(extensionPath, '..', 'cli', 'dist', 'index.js');
      if (fs.existsSync(possibleCliPath)) {
        this.log(`[Scanner] Detected local monorepo CLI at ${possibleCliPath}`);
        return possibleCliPath;
      }
    }

    // During development, try from the workspace root if it's the monorepo
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
      const monorepoCliPath = path.join(workspaceFolder.uri.fsPath, 'packages', 'cli', 'dist', 'index.js');
      if (fs.existsSync(monorepoCliPath)) {
        // Verify this is the i18nsmith monorepo by checking for workspace config
        const pnpmWorkspace = path.join(workspaceFolder.uri.fsPath, 'pnpm-workspace.yaml');
        if (fs.existsSync(pnpmWorkspace)) {
          this.log(`[Scanner] Detected development monorepo CLI at ${monorepoCliPath}`);
          return monorepoCliPath;
        }
      }
    }

    return null;
  }

  /**
   * Execute the CLI and return results
   */
  private async runCli(): Promise<ScanResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      const summary = emptyReportMetrics();
      return {
        success: false,
        timestamp: new Date(),
        issueCount: summary.issueCount,
        severityCounts: summary.severityCounts,
        dominantSeverity: summary.dominantSeverity,
        suggestionCount: summary.suggestionCount,
        suggestionSeverityCounts: summary.suggestionSeverityCounts,
        suggestionDominantSeverity: summary.suggestionDominantSeverity,
        statusLevel: summary.statusLevel,
        statusReasons: summary.statusReasons,
        warningCount: summary.warningCount,
        error: 'No workspace folder found',
      };
    }

    const config = vscode.workspace.getConfiguration('i18nsmith');
    const configuredCliPath = (config.get<string>('cliPath', '') ?? '').trim();
    let preferredCliPath = configuredCliPath;

    if (!preferredCliPath) {
      const localMonorepo = this.detectLocalMonorepo();
      if (localMonorepo) {
        preferredCliPath = localMonorepo;
      }
    }

    const reportPath = config.get<string>('reportPath', '.i18nsmith/check-report.json');
    const fullReportPath = path.join(workspaceFolder.uri.fsPath, reportPath);
    const commandParts = ['i18nsmith', 'check', '--json', '--report', quoteCliArg(reportPath)];
    const humanReadable = commandParts.join(' ').trim();

    this.log(`[Scanner] Running: ${humanReadable}`);
    this.log(`[Scanner] CWD: ${workspaceFolder.uri.fsPath}`);

    // Delete any existing report file to avoid using stale data
    try {
      if (fs.existsSync(fullReportPath)) {
        fs.unlinkSync(fullReportPath);
        this.log(`[Scanner] Cleared existing report file`);
      }
    } catch (error) {
      this.log(`[Scanner] Failed to clear existing report: ${error}`);
    }

    const stderrChunks: string[] = [];

    const result = await this.cliService.runCliCommand(humanReadable, {
      cwd: workspaceFolder.uri.fsPath,
      preferredCliPath,
      timeoutMs: 60000,
      showOutput: false,
      suppressNotifications: true,
      skipReportRefresh: true,
      label: 'Scanner',
      onStdout: (text) => {
        this.log(text);
      },
      onStderr: (text) => {
        stderrChunks.push(text);
        this.log(`[stderr] ${text}`);
      },
    });

    const timestamp = new Date();
    const aggregatedStderr = stderrChunks.join('');

    let reportExists = false;
    let reportSummary: ReportMetrics | null = null;

    try {
      if (fs.existsSync(fullReportPath)) {
        reportExists = true;
        const reportContent = fs.readFileSync(fullReportPath, 'utf8');
        const report = JSON.parse(reportContent);
        const issueSummary = summarizeReportIssues(report);
        const suggestionSummary = summarizeSuggestedCommands(report);
        const assessment = assessStatusLevel(report, {
          issueSummary,
          suggestionSummary,
        });
        reportSummary = {
          issueCount: issueSummary.issueCount,
          severityCounts: issueSummary.severityCounts,
          dominantSeverity: issueSummary.dominantSeverity,
          suggestionCount: suggestionSummary.total,
          suggestionSeverityCounts: suggestionSummary.severityCounts,
          suggestionDominantSeverity: suggestionSummary.dominantSeverity,
          statusLevel: assessment.level,
          statusReasons: assessment.reasons,
          warningCount: assessment.warningCount,
        };
      }
    } catch (parseError) {
      this.log(`[Scanner] Failed to parse report: ${parseError}`);
    }

    if (reportExists) {
      const summary = reportSummary ?? emptyReportMetrics();
      this.log(`[Scanner] Completed successfully (${summary.issueCount} issues found)`);
      return {
        success: true,
        timestamp,
        issueCount: summary.issueCount,
        severityCounts: summary.severityCounts,
        dominantSeverity: summary.dominantSeverity,
        suggestionCount: summary.suggestionCount,
        suggestionSeverityCounts: summary.suggestionSeverityCounts,
        suggestionDominantSeverity: summary.suggestionDominantSeverity,
        statusLevel: summary.statusLevel,
        statusReasons: summary.statusReasons,
        warningCount: summary.warningCount,
      };
    }

    if (!result?.success) {
      const errorMsg =
        result?.error?.message || aggregatedStderr || `Command exited with code ${result?.exitCode ?? 'unknown'}`;
      const stderrText = aggregatedStderr;
      const isNotFound =
        errorMsg.includes('E404') ||
        errorMsg.includes('not in this registry') ||
        stderrText.includes('E404') ||
        stderrText.includes('not in this registry');

      if (isNotFound && !configuredCliPath) {
        this.log(`[Scanner] i18nsmith CLI not found. Install it with: npm install -D i18nsmith`);
        this.log(`[Scanner] Or set 'i18nsmith.cliPath' in settings to point to a local CLI.`);
      } else {
        this.log(`[Scanner] Error: ${errorMsg}`);
      }

      const summary = emptyReportMetrics();
      return {
        success: false,
        timestamp,
        issueCount: summary.issueCount,
        severityCounts: summary.severityCounts,
        dominantSeverity: summary.dominantSeverity,
        suggestionCount: summary.suggestionCount,
        suggestionSeverityCounts: summary.suggestionSeverityCounts,
        suggestionDominantSeverity: summary.suggestionDominantSeverity,
        statusLevel: summary.statusLevel,
        statusReasons: summary.statusReasons,
        warningCount: summary.warningCount,
        error: errorMsg,
      };
    }

    this.log(`[Scanner] Completed (no report generated)`);
    const summary = emptyReportMetrics();
    return {
      success: true,
      timestamp,
      issueCount: summary.issueCount,
      severityCounts: summary.severityCounts,
      dominantSeverity: summary.dominantSeverity,
      suggestionCount: summary.suggestionCount,
      suggestionSeverityCounts: summary.suggestionSeverityCounts,
      suggestionDominantSeverity: summary.suggestionDominantSeverity,
      statusLevel: summary.statusLevel,
      statusReasons: summary.statusReasons,
      warningCount: summary.warningCount,
    };
  }

  private setState(state: ScanState) {
    if (this._state !== state) {
      this._state = state;
      this.stateChangeEmitter.fire(state);
    }
  }

  private log(message: string) {
    this.outputChannel.appendLine(message);
  }

  /**
   * Show the output channel
   */
  showOutput() {
    this.outputChannel.show();
  }
}
