import * as vscode from 'vscode';
import {
  getWorkspaceConfigSnapshot,
  readWorkspaceConfigSnapshot,
  invalidateWorkspaceConfigCache,
  type WorkspaceConfigSnapshot,
} from '../workspace-config';

export interface ConfigurationChangeEvent {
  workspaceRoot: string;
  snapshot: WorkspaceConfigSnapshot | null;
  error?: Error;
}

export class ConfigurationService implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ConfigurationChangeEvent>();
  public readonly onDidChange = this.changeEmitter.event;

  private readonly watchers = new Map<string, vscode.FileSystemWatcher>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.registerWorkspaceWatchers();

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.registerWorkspaceWatchers();
      })
    );
  }

  public getSnapshot(workspaceRoot?: string): WorkspaceConfigSnapshot | null {
    const root = this.resolveWorkspaceRoot(workspaceRoot);
    if (!root) {
      return null;
    }
    return getWorkspaceConfigSnapshot(root);
  }

  public refresh(workspaceRoot?: string): WorkspaceConfigSnapshot | null {
    const root = this.resolveWorkspaceRoot(workspaceRoot);
    if (!root) {
      return null;
    }

    invalidateWorkspaceConfigCache(root);
    const result = readWorkspaceConfigSnapshot(root);

    if (result.ok) {
      this.changeEmitter.fire({ workspaceRoot: root, snapshot: result.snapshot });
      return result.snapshot;
    }

    this.changeEmitter.fire({ workspaceRoot: root, snapshot: null, error: result.error });
    return null;
  }

  dispose() {
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this.disposables.forEach((d) => d.dispose());
    this.changeEmitter.dispose();
  }

  private registerWorkspaceWatchers() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const currentRoots = new Set(folders.map((folder) => folder.uri.fsPath));

    // Remove watchers for folders that no longer exist
    for (const [root, watcher] of this.watchers.entries()) {
      if (!currentRoots.has(root)) {
        watcher.dispose();
        this.watchers.delete(root);
      }
    }

    // Add watchers for new folders
    for (const folder of folders) {
      const root = folder.uri.fsPath;
      if (this.watchers.has(root)) {
        continue;
      }

      const pattern = new vscode.RelativePattern(folder, 'i18n.config.json');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);

      const handleChange = () => this.refresh(root);
      watcher.onDidChange(handleChange);
      watcher.onDidCreate(handleChange);
      watcher.onDidDelete(() => {
        invalidateWorkspaceConfigCache(root);
        this.changeEmitter.fire({ workspaceRoot: root, snapshot: null });
      });

      this.watchers.set(root, watcher);
    }
  }

  private resolveWorkspaceRoot(workspaceRoot?: string): string | null {
    if (workspaceRoot) {
      return workspaceRoot;
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder?.uri.fsPath ?? null;
  }
}
