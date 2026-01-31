import * as vscode from 'vscode';
import * as path from 'path';
import type { DynamicKeyWarning } from '@i18nsmith/core';
import { resolveWhitelistAssumption } from './dynamic-key-whitelist';
import { loadDynamicWhitelistSnapshot } from './workspace-config';

/**
 * Schema for actionable items from i18nsmith check/sync reports
 */
export interface ActionableItem {
  kind: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  key?: string;
}

/**
 * Schema for the check report JSON
 */
export interface CheckReport {
  diagnostics?: {
    actionableItems?: ActionableItem[];
  };
  sync?: {
    missingKeys?: Array<{ key: string; filePath?: string }>;
    unusedKeys?: Array<{ key: string; locales?: string[] }>;
    actionableItems?: ActionableItem[];
    dynamicKeyWarnings?: unknown[];
    suspiciousKeys?: unknown[];
  };
  actionableItems?: ActionableItem[];
  suggestedCommands?: Array<{
    label: string;
    command: string;
    reason?: string;
    severity?: 'error' | 'warn' | 'info';
    category?: 'extraction' | 'sync' | 'translation' | 'setup' | 'validation' | 'quality';
    relevantFiles?: string[];
    priority?: number;
  }>;
  hasConflicts?: boolean;
  hasDrift?: boolean;
  timestamp?: string;
}

/**
 * Manages VS Code diagnostics based on i18nsmith reports
 */
export class DiagnosticsManager implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private currentReport: CheckReport | null = null;
  private fileIssues: Map<string, ActionableItem[]> = new Map();
  private workspaceRoot: string | null = null;

  constructor() {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('i18nsmith');
  }

  dispose() {
    this.diagnosticCollection.dispose();
  }

  /**
   * Update diagnostics from a parsed report
   */
  updateFromReport(report: CheckReport, workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    // Best-effort: prune dynamic key warnings that are already whitelisted by config.
    // This avoids showing the "Resolve Dynamic Keys" action when it would do nothing.
    void this.pruneDynamicWarningsFromConfig(report, workspaceRoot);
    this.replaceDiagnostics(report, workspaceRoot);
  }

  private async pruneDynamicWarningsFromConfig(report: CheckReport, workspaceRoot: string) {
    if (!Array.isArray(report.sync?.dynamicKeyWarnings) || !report.sync?.dynamicKeyWarnings.length) {
      return;
    }
    const snapshot = await loadDynamicWhitelistSnapshot(workspaceRoot);
    if (!snapshot?.normalizedEntries?.length) {
      return;
    }
    const normalized = new Set(snapshot.normalizedEntries);
    const currentWarnings = report.sync.dynamicKeyWarnings as DynamicKeyWarning[];
    const filtered = currentWarnings.filter((warning) => {
      const derived = resolveWhitelistAssumption(warning);
      if (!derived) {
        return true;
      }
      return !normalized.has(derived.assumption);
    });
    report.sync.dynamicKeyWarnings = filtered;
  }

  private replaceDiagnostics(report: CheckReport, workspaceRoot: string) {
    this.currentReport = report;
    this.diagnosticCollection.clear();
    this.fileIssues.clear();

    const allItems: ActionableItem[] = [
      ...(report.actionableItems || []),
      ...(report.diagnostics?.actionableItems || []),
      ...(report.sync?.actionableItems || []),
    ];

    console.log(`[i18nsmith] Processing ${allItems.length} actionable items from report`);
    console.log(`[i18nsmith] Workspace root: ${workspaceRoot}`);

    // Group items by file
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const item of allItems) {
      const filePath = item.filePath 
        ? path.resolve(workspaceRoot, item.filePath)
        : undefined;
      
      if (filePath) {
        // Track for CodeLens
        if (!this.fileIssues.has(filePath)) {
          this.fileIssues.set(filePath, []);
        }
        this.fileIssues.get(filePath)!.push(item);

        // Create diagnostic
        const range = new vscode.Range(
          new vscode.Position((item.line || 1) - 1, (item.column || 1) - 1),
          new vscode.Position((item.line || 1) - 1, 1000)
        );

        const severity = this.mapSeverity(item.severity);
        const diagnostic = new vscode.Diagnostic(range, item.message, severity);
        diagnostic.source = 'i18nsmith';
        diagnostic.code = item.kind;

        if (!byFile.has(filePath)) {
          byFile.set(filePath, []);
        }
        byFile.get(filePath)!.push(diagnostic);
      }
    }

    console.log(`[i18nsmith] Setting diagnostics for ${byFile.size} files`);

    // Also add workspace-level diagnostics for items without file paths
    const workspaceDiagnostics: vscode.Diagnostic[] = [];
    for (const item of allItems) {
      if (!item.filePath) {
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 0),
          item.message,
          this.mapSeverity(item.severity)
        );
        diagnostic.source = 'i18nsmith';
        diagnostic.code = item.kind;
        workspaceDiagnostics.push(diagnostic);
      }
    }

    // Set diagnostics for each file
    for (const [filePath, diagnostics] of byFile) {
      const uri = vscode.Uri.file(filePath);
      this.diagnosticCollection.set(uri, diagnostics);
    }

    // If there are workspace-level issues, attach to config file
    if (workspaceDiagnostics.length > 0) {
      const configUri = vscode.Uri.file(path.join(workspaceRoot, 'i18n.config.json'));
      this.diagnosticCollection.set(configUri, workspaceDiagnostics);
    }
  }

  /**
   * Clear all diagnostics
   */
  clear() {
    this.diagnosticCollection.clear();
    this.fileIssues.clear();
    this.currentReport = null;
    this.workspaceRoot = null;
  }

  suppressSyncWarnings(kinds: Array<'dynamicKeyWarnings' | 'suspiciousKeys'>) {
    if (!this.currentReport || typeof this.currentReport.sync !== 'object') {
      return;
    }

    const syncSection = { ...this.currentReport.sync } as Record<string, unknown>;
    let changed = false;

    if (kinds.includes('dynamicKeyWarnings') && Array.isArray(syncSection.dynamicKeyWarnings) && syncSection.dynamicKeyWarnings.length) {
      syncSection.dynamicKeyWarnings = [];
      changed = true;
    }

    if (kinds.includes('suspiciousKeys') && Array.isArray(syncSection.suspiciousKeys) && syncSection.suspiciousKeys.length) {
      syncSection.suspiciousKeys = [];
      changed = true;
    }

    if (!changed) {
      return;
    }

    const nextReport: CheckReport = {
      ...this.currentReport,
      sync: syncSection as CheckReport['sync'],
    };

    if (this.workspaceRoot) {
      this.replaceDiagnostics(nextReport, this.workspaceRoot);
    } else {
      this.currentReport = nextReport;
    }
  }

  pruneDynamicWarnings(normalizedExpressions: Set<string>) {
    if (!normalizedExpressions.size) {
      return;
    }

    if (!this.currentReport || !Array.isArray(this.currentReport.sync?.dynamicKeyWarnings)) {
      return;
    }

    const currentWarnings = this.currentReport.sync!.dynamicKeyWarnings as DynamicKeyWarning[];
    const filtered = currentWarnings.filter((warning) => {
      const derived = resolveWhitelistAssumption(warning);
      if (!derived) {
        return true;
      }
      return !normalizedExpressions.has(derived.assumption);
    });

    if (filtered.length === currentWarnings.length) {
      return;
    }

    const nextSync: CheckReport['sync'] = {
      ...(this.currentReport.sync ?? {}),
      dynamicKeyWarnings: filtered,
    };
    const nextReport: CheckReport = {
      ...this.currentReport,
      sync: nextSync,
    };

    if (this.workspaceRoot) {
      this.replaceDiagnostics(nextReport, this.workspaceRoot);
    } else {
      this.currentReport = nextReport;
    }
  }

  /**
   * Get issues for a specific file (for CodeLens)
   */
  getIssuesForFile(filePath: string): ActionableItem[] {
    return this.fileIssues.get(filePath) || [];
  }

  /**
   * Check if there are any issues
   */
  hasIssues(): boolean {
    return this.fileIssues.size > 0;
  }

  /**
   * Get the current report
   */
  getReport(): CheckReport | null {
    return this.currentReport;
  }

  private mapSeverity(severity: string): vscode.DiagnosticSeverity {
    switch (severity) {
      case 'error':
        return vscode.DiagnosticSeverity.Error;
      case 'warn':
        return vscode.DiagnosticSeverity.Warning;
      case 'info':
      default:
        return vscode.DiagnosticSeverity.Information;
    }
  }
}
