import * as vscode from 'vscode';

export class MarkdownPreviewProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this._onDidChange.event;
  private contentMap = new Map<string, string>();

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentMap.get(uri.toString()) || '_No content available._';
  }

  public update(uri: vscode.Uri, content: string) {
    this.contentMap.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }
}

export const markdownPreviewProvider = new MarkdownPreviewProvider();

export function registerMarkdownPreviewProvider(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider('i18nsmith-preview', markdownPreviewProvider)
  );
}
