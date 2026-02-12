import * as vscode from 'vscode';
import type { CheckReport } from '../diagnostics';
import { buildDynamicCoverageEntries, type DynamicCoverageEntry } from './dynamic-coverage-model';

export type DynamicCoverageTreeNode =
  | { kind: 'pattern'; entry: DynamicCoverageEntry; missingTotal: number }
  | { kind: 'locale'; entry: DynamicCoverageEntry; locale: string; missingKeys: string[] }
  | { kind: 'key'; key: string }
  | { kind: 'empty'; label: string };

const MAX_KEYS_PER_LOCALE = 20;

function getMissingTotal(entry: DynamicCoverageEntry): number {
  return Object.values(entry.missingByLocale).reduce((sum, list) => sum + list.length, 0);
}

export class DynamicCoverageProvider
  implements vscode.TreeDataProvider<DynamicCoverageTreeNode>, vscode.Disposable
{
  private entries: DynamicCoverageEntry[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<DynamicCoverageTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  update(report: CheckReport | null) {
    this.entries = buildDynamicCoverageEntries(report);
    this.changeEmitter.fire(undefined);
  }

  getBadge(): vscode.ViewBadge | undefined {
    const totalMissing = this.entries.reduce((sum, entry) => sum + getMissingTotal(entry), 0);
    if (totalMissing === 0) {
      return undefined;
    }
    return {
      value: totalMissing,
      tooltip: `${totalMissing} missing translation${totalMissing === 1 ? '' : 's'} for dynamic keys`,
    };
  }

  getTreeItem(element: DynamicCoverageTreeNode): vscode.TreeItem {
    if (element.kind === 'empty') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.contextValue = 'i18nsmith.dynamicCoverage.empty';
      return item;
    }

    if (element.kind === 'pattern') {
      const label = `${element.entry.pattern} (${element.missingTotal} missing)`;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'i18nsmith.dynamicCoverage.pattern';
      item.tooltip = element.entry.expandedKeys.length
        ? `${element.entry.expandedKeys.length} expanded key${element.entry.expandedKeys.length === 1 ? '' : 's'}`
        : 'No expanded keys';
      item.iconPath = new vscode.ThemeIcon('shield');
      return item;
    }

    if (element.kind === 'locale') {
      const label = `${element.locale} (${element.missingKeys.length} missing)`;
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
      item.contextValue = 'i18nsmith.dynamicCoverage.locale';
      item.iconPath = new vscode.ThemeIcon('globe');
      return item;
    }

    const item = new vscode.TreeItem(element.key, vscode.TreeItemCollapsibleState.None);
    item.contextValue = 'i18nsmith.dynamicCoverage.key';
    item.iconPath = new vscode.ThemeIcon('circle-outline');
    return item;
  }

  getChildren(element?: DynamicCoverageTreeNode): DynamicCoverageTreeNode[] {
    if (!element) {
      if (!this.entries.length) {
        return [{ kind: 'empty', label: 'No dynamic key coverage data yet.' }];
      }
      return this.entries.map((entry) => ({
        kind: 'pattern',
        entry,
        missingTotal: getMissingTotal(entry),
      }));
    }

    if (element.kind === 'pattern') {
      const localeNodes = Object.entries(element.entry.missingByLocale).map(
        ([locale, missingKeys]) => ({
          kind: 'locale' as const,
          entry: element.entry,
          locale,
          missingKeys,
        })
      );
      return localeNodes.sort((a, b) => b.missingKeys.length - a.missingKeys.length);
    }

    if (element.kind === 'locale') {
      const visibleKeys = element.missingKeys.slice(0, MAX_KEYS_PER_LOCALE);
      const nodes: DynamicCoverageTreeNode[] = visibleKeys.map((key) => ({ kind: 'key', key }));
      if (element.missingKeys.length > MAX_KEYS_PER_LOCALE) {
        nodes.push({
          kind: 'empty',
          label: `...and ${element.missingKeys.length - MAX_KEYS_PER_LOCALE} more`,
        });
      }
      return nodes;
    }

    return [];
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}
