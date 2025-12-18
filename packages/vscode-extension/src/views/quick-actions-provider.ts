import * as vscode from 'vscode';
import type {
  QuickActionBuildOutput,
  QuickActionDefinition,
  QuickActionMetadata,
  QuickActionSection,
  QuickActionChildDefinition,
} from '../quick-actions-data';

export type QuickActionTreeNode =
  | { kind: 'section'; section: QuickActionSection }
  | { kind: 'action'; action: QuickActionDefinition }
  | { kind: 'child'; parent: QuickActionDefinition; child: QuickActionChildDefinition };

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
    // Log for dev host troubleshooting so we can confirm model updates are received
    // This appears in the Extension Host log during development (helps verify reloads)
    // eslint-disable-next-line no-console
    console.log(`[i18nsmith] QuickActionsProvider.update: sections=${model.sections.length} suspicious=${model.metadata.suspiciousWarnings.length}`);
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

    if (element.kind === 'action') {
      const action = element.action;
      const collapsibleState = action.children?.length
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
      const treeItem = new vscode.TreeItem(action.title, collapsibleState);
      treeItem.description = action.description;
      treeItem.tooltip = [action.description, action.detail].filter(Boolean).join('\n\n');
      treeItem.iconPath = new vscode.ThemeIcon(action.iconId);
      treeItem.command = action.children?.length
        ? undefined
        : {
            command: 'i18nsmith.quickActions.executeDefinition',
            title: 'Run Quick Action',
            arguments: [action],
          };
      treeItem.contextValue = action.children?.length
        ? 'i18nsmith.quickActions.actionWithChildren'
        : 'i18nsmith.quickActions.action';
      return treeItem;
    }

    const child = element.child;
    const childItem = new vscode.TreeItem(child.label, vscode.TreeItemCollapsibleState.None);
    childItem.description = child.description;
    childItem.tooltip = [child.description, child.detail].filter(Boolean).join('\n');
    if (child.iconId) {
      childItem.iconPath = new vscode.ThemeIcon(child.iconId);
    }
    const command = buildChildCommand(child);
    if (command) {
      childItem.command = command;
    }
    childItem.contextValue = 'i18nsmith.quickActions.child';
    return childItem;
  }

  getChildren(element?: QuickActionTreeNode): QuickActionTreeNode[] {
    if (!element) {
      return this.sections.map((section) => ({ kind: 'section', section }));
    }

    if (element.kind === 'section') {
      return element.section.actions.map((action) => ({ kind: 'action', action }));
    }

    if (element.kind === 'action') {
      if (!element.action.children?.length) {
        return [];
      }
      return element.action.children.map((child) => ({ kind: 'child', parent: element.action, child }));
    }

    return [];
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}

function buildChildCommand(child: QuickActionChildDefinition): vscode.Command | undefined {
  if (!child.command) {
    return undefined;
  }
  return {
    command: child.command,
    title: 'Run Quick Action Item',
    arguments: child.commandArgs ?? [],
  };
}
