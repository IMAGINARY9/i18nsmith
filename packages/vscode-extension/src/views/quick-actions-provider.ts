import * as vscode from 'vscode';
import type {
  QuickActionBuildOutput,
  QuickActionDefinition,
  QuickActionMetadata,
  QuickActionSection,
} from '../quick-actions-data';

export type QuickActionTreeNode =
  | { kind: 'section'; section: QuickActionSection }
  | { kind: 'action'; action: QuickActionDefinition };

export class QuickActionsProvider
  implements vscode.TreeDataProvider<QuickActionTreeNode>, vscode.Disposable
{
  private sections: QuickActionSection[] = [];
  private metadata: QuickActionMetadata | null = null;
  private readonly changeEmitter = new vscode.EventEmitter<QuickActionTreeNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  update(model: QuickActionBuildOutput) {
    this.sections = model.sections;
    this.metadata = model.metadata;
    vscode.commands.executeCommand('setContext', 'i18nsmith.runtimeReady', model.metadata.runtimeReady);
    vscode.commands.executeCommand(
      'setContext',
      'i18nsmith.quickActions.hasActions',
      this.sections.some((section) => section.actions.length > 0)
    );
    this.changeEmitter.fire(undefined);
  }

  getMetadata(): QuickActionMetadata | null {
    return this.metadata;
  }

  getTreeItem(element: QuickActionTreeNode): vscode.TreeItem {
    if (element.kind === 'section') {
      const item = new vscode.TreeItem(element.section.title, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'i18nsmith.quickActions.section';
      return item;
    }

    const action = element.action;
    const label = action.title;
    const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    treeItem.description = action.description;
    treeItem.tooltip = [action.description, action.detail].filter(Boolean).join('\n\n');
    treeItem.iconPath = new vscode.ThemeIcon(action.iconId);
    treeItem.command = {
      command: 'i18nsmith.quickActions.executeDefinition',
      title: 'Run Quick Action',
      arguments: [action],
    };
    treeItem.contextValue = 'i18nsmith.quickActions.action';
    return treeItem;
  }

  getChildren(element?: QuickActionTreeNode): QuickActionTreeNode[] {
    if (!element) {
      return this.sections.map((section) => ({ kind: 'section', section }));
    }

    if (element.kind === 'section') {
      return element.section.actions.map((action) => ({ kind: 'action', action }));
    }

    return [];
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}
