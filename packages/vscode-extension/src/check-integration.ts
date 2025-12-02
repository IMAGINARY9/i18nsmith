import * as vscode from 'vscode';
import * as path from 'path';
import { loadConfigWithMeta, CheckRunner, CheckSummary } from '@i18nsmith/core';

/**
 * Integration layer for running i18nsmith check directly via core CheckRunner
 * Provides richer, structured diagnostics without shelling out to CLI
 */
export class CheckIntegration {
  private lastCheck: CheckSummary | null = null;
  private lastCheckTime: number = 0;

  /**
   * Run check via core CheckRunner (no CLI subprocess)
   * Returns structured diagnostics, sync results, and scan candidates
   */
  async runCheck(
    workspaceRoot: string,
    options: {
      targets?: string[];
      invalidateCache?: boolean;
      scanHardcoded?: boolean;
    } = {}
  ): Promise<CheckSummary> {
  const { config, projectRoot } = await loadConfigWithMeta(undefined, { cwd: workspaceRoot });
  const runner = new CheckRunner(config, { workspaceRoot: projectRoot });
  const normalizedTargets = this.normalizeTargets(options.targets, projectRoot);
    
    const summary = await runner.run({
      validateInterpolations: config.sync?.validateInterpolations ?? false,
      emptyValuePolicy: config.sync?.emptyValuePolicy ?? 'warn',
      assumedKeys: options.targets ? [] : config.sync?.dynamicKeyAssumptions ?? [],
      diff: false,
  targets: normalizedTargets,
      invalidateCache: options.invalidateCache ?? false,
      scanHardcoded: options.scanHardcoded ?? true,
    });

    this.lastCheck = summary;
    this.lastCheckTime = Date.now();
    return summary;
  }

  /**
   * Get cached check results if fresh (within 5 seconds)
   */
  getCachedCheck(): CheckSummary | null {
    if (!this.lastCheck) return null;
    const isFresh = Date.now() - this.lastCheckTime < 5000;
    return isFresh ? this.lastCheck : null;
  }

  /**
   * Check a specific file or set of files (per-file onboarding)
   * Uses core's --target functionality for focused diagnostics
   */
  async checkFile(workspaceRoot: string, filePath: string): Promise<CheckSummary> {
    return this.runCheck(workspaceRoot, { targets: [filePath] });
  }

  private normalizeTargets(targets: string[] | undefined, projectRoot: string): string[] | undefined {
    if (!targets?.length) {
      return undefined;
    }

    return targets
      .map((target) => target?.trim())
      .filter((target): target is string => Boolean(target))
      .map((target) => (path.isAbsolute(target) ? path.relative(projectRoot, target) : target));
  }

  /**
   * Get suggested commands from the last check
   * These are actionable CLI commands based on diagnostics
   */
  getSuggestedCommands(): Array<{
    label: string;
    command: string;
    reason: string;
    severity: 'error' | 'warn' | 'info';
  }> {
    return this.lastCheck?.suggestedCommands ?? [];
  }

  /**
   * Check if check results indicate a working i18n setup
   */
  hasWorkingSetup(): boolean {
    if (!this.lastCheck) return false;
    return !this.lastCheck.hasConflicts && this.lastCheck.diagnostics.runtimePackages.length > 0;
  }
}
