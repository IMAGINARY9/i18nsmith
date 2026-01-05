import * as vscode from "vscode";
import {
  loadDynamicWhitelistSnapshot,
  persistDynamicKeyAssumptions,
} from "../workspace-config";
import {
  deriveWhitelistSuggestions,
  resolveWhitelistAssumption,
  normalizeManualAssumption,
  type WhitelistSuggestion,
} from "../dynamic-key-whitelist";
import { DynamicKeyWarning } from "@i18nsmith/core";
import { ServiceContainer } from "../services/container";

interface ExtendedWhitelistSuggestion extends WhitelistSuggestion {
  count?: number;
  example?: string;
}

export class ConfigurationController implements vscode.Disposable {
  private dynamicWarningSuppressUntil = 0;
  private pendingDynamicWhitelistEntries = new Set<string>();
  private lastSyncDynamicWarnings: DynamicKeyWarning[] = [];

  constructor(private readonly services: ServiceContainer) {}

  dispose() {
    // No resources to dispose yet
  }

  public beginDynamicWarningSuppression(durationMs = 45000) {
    this.dynamicWarningSuppressUntil = Date.now() + durationMs;
    this.lastSyncDynamicWarnings = [];
    this.services.diagnosticsManager.suppressSyncWarnings([
      "dynamicKeyWarnings",
    ]);
  }

  public clearDynamicWarningSuppression() {
    this.dynamicWarningSuppressUntil = 0;
    this.pendingDynamicWhitelistEntries.clear();
  }

  public areDynamicWarningsSuppressed(): boolean {
    if (!this.dynamicWarningSuppressUntil) {
      return false;
    }
    if (Date.now() > this.dynamicWarningSuppressUntil) {
      this.dynamicWarningSuppressUntil = 0;
      return false;
    }
    return true;
  }

  public setLastSyncDynamicWarnings(warnings: DynamicKeyWarning[]) {
    this.lastSyncDynamicWarnings = warnings;
  }

  public getLastSyncDynamicWarnings(): DynamicKeyWarning[] {
    return this.lastSyncDynamicWarnings;
  }

  public async whitelistDynamicKeys() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    const warnings = this.lastSyncDynamicWarnings;
    if (!warnings.length) {
      vscode.window.showInformationMessage(
        "No dynamic key warnings to whitelist."
      );
      return;
    }

    const suggestions = deriveWhitelistSuggestions(
      warnings
    ) as ExtendedWhitelistSuggestion[];
    if (!suggestions.length) {
      vscode.window.showInformationMessage(
        "No valid whitelist suggestions could be derived."
      );
      return;
    }

    // Aggregate suggestions by their *normalized* assumption so we don't offer duplicates
    // that differ only by quoting/whitespace.
    const aggregated = new Map<
      string,
      { suggestion: WhitelistSuggestion; count: number; example: string }
    >();
    for (const s of suggestions) {
      const normalizedKey = normalizeManualAssumption(s.assumption) ?? s.assumption;
      if (!aggregated.has(normalizedKey)) {
        aggregated.set(normalizedKey, { suggestion: s, count: 0, example: s.expression });
      }
      aggregated.get(normalizedKey)!.count++;
    }

    const items = Array.from(aggregated.values()).map(
      ({ suggestion, count, example }) => ({
        label: suggestion.assumption,
        description: `${count} occurrence${count === 1 ? "" : "s"}`,
        detail: `Example: ${example}`,
        picked: true,
        suggestion,
      })
    );

    const selected = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: "Select dynamic patterns to whitelist",
      placeHolder: "Select patterns to add to i18n.config.json",
    });

    if (!selected || !selected.length) {
      return;
    }

    const additions = selected.map((s) => s.suggestion);

    // Optimistic update
    this.applyOptimisticDynamicWhitelist(additions);

    try {
      const snapshot = await loadDynamicWhitelistSnapshot(
        workspaceFolder.uri.fsPath
      );
      if (!snapshot) {
        throw new Error("Failed to load current whitelist snapshot");
      }

      await persistDynamicKeyAssumptions(
        workspaceFolder.uri.fsPath,
        additions,
        snapshot
      );

      this.services.configurationService.refresh(workspaceFolder.uri.fsPath);
      // Clear any short-lived suppression state and force a fresh report.
      this.clearDynamicWarningSuppression();
      await this.services.reportWatcher.refresh();

      // After refresh, also prune any warnings that are now covered by the *actual*
      // persisted whitelist, to avoid the action reappearing due to stale in-memory state.
      const refreshedSnapshot = await loadDynamicWhitelistSnapshot(workspaceFolder.uri.fsPath);
      if (refreshedSnapshot?.normalizedEntries?.length) {
        this.services.diagnosticsManager.pruneDynamicWarnings(
          new Set(refreshedSnapshot.normalizedEntries)
        );
      }

      vscode.window.showInformationMessage(
        `Added ${additions.length} pattern${additions.length === 1 ? "" : "s"} to whitelist.`
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update config: ${error}`);
      this.clearDynamicWarningSuppression();
      this.services.reportWatcher.refresh();
    }
  }

  private applyOptimisticDynamicWhitelist(additions: WhitelistSuggestion[]) {
    if (!additions.length) {
      return;
    }

    const normalizedEntries = new Set<string>();
    for (const addition of additions) {
      const normalized = normalizeManualAssumption(addition.assumption);
      if (normalized) {
        normalizedEntries.add(normalized);
      }
    }

    if (!normalizedEntries.size) {
      return;
    }

    normalizedEntries.forEach((value) =>
      this.pendingDynamicWhitelistEntries.add(value)
    );
    this.lastSyncDynamicWarnings = this.filterOutPendingDynamicWarnings(
      this.lastSyncDynamicWarnings
    );
    this.services.diagnosticsManager.pruneDynamicWarnings(normalizedEntries);
  }

  private filterOutPendingDynamicWarnings(
    warnings: DynamicKeyWarning[]
  ): DynamicKeyWarning[] {
    if (!warnings.length || !this.pendingDynamicWhitelistEntries.size) {
      return warnings;
    }

    return warnings.filter(
      (warning) => !this.isWarningCoveredByPendingWhitelist(warning)
    );
  }

  private isWarningCoveredByPendingWhitelist(
    warning: DynamicKeyWarning
  ): boolean {
    if (!this.pendingDynamicWhitelistEntries.size) {
      return false;
    }

    const derived = resolveWhitelistAssumption(warning);
    if (!derived) {
      return false;
    }

    return this.pendingDynamicWhitelistEntries.has(derived.assumption);
  }
}
