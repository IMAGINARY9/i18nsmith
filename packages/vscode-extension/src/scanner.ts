import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export type ScanState = 'idle' | 'scanning' | 'success' | 'error';

export interface ScanResult {
  success: boolean;
  timestamp: Date;
  issueCount: number;
  error?: string;
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
  private outputChannel: vscode.OutputChannel;
  
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

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('i18nsmith');
    this.loadConfig();
    this.setupWatchers();
  }

  dispose() {
    this.clearDebounce();
    this.disposables.forEach(d => d.dispose());
    this.stateChangeEmitter.dispose();
    this.scanCompleteEmitter.dispose();
    this.outputChannel.dispose();
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
    const extensionPath = vscode.extensions.getExtension('ArturLavrov.i18nsmith-vscode')?.extensionPath;
    if (!extensionPath) {
      return null;
    }

    // If running in the monorepo, the extension is at packages/vscode-extension
    // and the CLI is at packages/cli/dist/index.js
    const possibleCliPath = path.join(extensionPath, '..', '..', 'cli', 'dist', 'index.js');
    if (fs.existsSync(possibleCliPath)) {
      this.log(`[Scanner] Detected local monorepo CLI at ${possibleCliPath}`);
      return possibleCliPath;
    }

    return null;
  }

  /**
   * Execute the CLI and return results
   */
  private async runCli(): Promise<ScanResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return {
        success: false,
        timestamp: new Date(),
        issueCount: 0,
        error: 'No workspace folder found',
      };
    }

    const config = vscode.workspace.getConfiguration('i18nsmith');
    let cliPath = config.get<string>('cliPath', '');

    // If no explicit cliPath, try to detect local monorepo
    if (!cliPath) {
      const localMonorepo = this.detectLocalMonorepo();
      if (localMonorepo) {
        cliPath = localMonorepo;
      }
    }

    const reportPath = config.get<string>('reportPath', '.i18nsmith/check-report.json');

    const cmd = cliPath
      ? `node "${cliPath}" check --json --report "${reportPath}"`
      : `npx @i18nsmith/cli check --json --report "${reportPath}"`;

    this.log(`[Scanner] Running: ${cmd}`);
    this.log(`[Scanner] CWD: ${workspaceFolder.uri.fsPath}`);

    return new Promise((resolve) => {
      exec(
        cmd,
        { cwd: workspaceFolder.uri.fsPath, timeout: 60000 },
        (error, stdout, stderr) => {
          const timestamp = new Date();

          if (stdout) {
            this.log(stdout);
          }
          if (stderr) {
            this.log(`[stderr] ${stderr}`);
          }

          // Check if the report file was created/updated successfully
          // The CLI may exit with non-zero codes when issues are found, but that's expected
          const fullReportPath = path.join(workspaceFolder.uri.fsPath, reportPath);
          let issueCount = 0;
          let reportExists = false;

          try {
            if (fs.existsSync(fullReportPath)) {
              reportExists = true;
              const reportContent = fs.readFileSync(fullReportPath, 'utf8');
              const report = JSON.parse(reportContent);
              // Count actionable items
              issueCount =
                (report.actionableItems?.length ?? 0) +
                (report.diagnostics?.actionableItems?.length ?? 0) +
                (report.sync?.actionableItems?.length ?? 0);
            }
          } catch (parseError) {
            this.log(`[Scanner] Failed to parse report: ${parseError}`);
          }

          // If report exists and was updated, consider it a success even with non-zero exit
          if (reportExists) {
            this.log(`[Scanner] Completed successfully (${issueCount} issues found)`);
            resolve({
              success: true,
              timestamp,
              issueCount,
            });
            return;
          }

          // Only treat as error if report doesn't exist AND there was an exec error
          if (error) {
            const errorMsg = error.message || '';
            
            // Check if this is a "not found" error (E404 from npm or npx)
            const isNotFound = errorMsg.includes('E404') || 
                               errorMsg.includes('not in this registry') ||
                               stderr.includes('E404') ||
                               stderr.includes('not in this registry');
            
            if (isNotFound && !cliPath) {
              this.log(`[Scanner] @i18nsmith/cli not found. Install it with: npm install -D @i18nsmith/cli`);
              this.log(`[Scanner] Or set 'i18nsmith.cliPath' in settings to point to a local CLI.`);
            } else {
              this.log(`[Scanner] Error: ${errorMsg}`);
            }

            resolve({
              success: false,
              timestamp,
              issueCount: 0,
              error: errorMsg,
            });
            return;
          }

          // No report and no error - unusual but treat as success with 0 issues
          this.log(`[Scanner] Completed (no report generated)`);
          resolve({
            success: true,
            timestamp,
            issueCount: 0,
          });
        }
      );
    });
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
