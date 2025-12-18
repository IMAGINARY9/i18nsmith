import { describe, it, expect, vi } from 'vitest';
import { activate } from './extension';
import * as vscode from 'vscode';

// Mock vscode
vi.mock('vscode', () => {
  const EventEmitter = class {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  };
  return {
    window: {
      createOutputChannel: vi.fn().mockReturnValue({ appendLine: vi.fn(), dispose: vi.fn() }),
      createTerminal: vi.fn().mockReturnValue({ show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() }),
      onDidCloseTerminal: vi.fn(),
      setStatusBarMessage: vi.fn(),
      createStatusBarItem: vi.fn().mockReturnValue({ show: vi.fn(), hide: vi.fn(), dispose: vi.fn() }),
      createTreeView: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidChangeTextEditorSelection: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      activeTextEditor: null,
    },
    workspace: {
      getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }),
      workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
      createFileSystemWatcher: vi.fn().mockReturnValue({ onDidChange: vi.fn(), onDidCreate: vi.fn(), onDidDelete: vi.fn(), dispose: vi.fn() }),
      onDidChangeConfiguration: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    },
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn(),
    },
    languages: {
      registerCodeLensProvider: vi.fn(),
      registerHoverProvider: vi.fn(),
      registerDefinitionProvider: vi.fn(),
      registerCodeActionsProvider: vi.fn(),
      createDiagnosticCollection: vi.fn().mockReturnValue({ clear: vi.fn(), set: vi.fn(), delete: vi.fn(), dispose: vi.fn() }),
    },
    ThemeIcon: class {
      constructor(public id: string) {
        this.id = id;
      }
    },
    Uri: {
      parse: vi.fn(),
      file: vi.fn(),
    },
    Range: class {},
    Position: class {},
    Location: class {},
    Diagnostic: class {},
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    EventEmitter,
    Disposable: {
      from: vi.fn(),
    },
    CodeLens: class {},
    CodeAction: class {},
  CodeActionKind: { QuickFix: 'quickfix', RefactorRewrite: 'refactor.rewrite' },
    StatusBarAlignment: { Right: 1 },
  };
});

// Mock other modules
vi.mock('./services/container', () => ({
  ServiceContainer: vi.fn().mockImplementation(() => ({
    verboseOutputChannel: {},
    cliOutputChannel: {},
    diagnosticsManager: { getReport: vi.fn().mockReturnValue(null) },
    reportWatcher: {
      refresh: vi.fn(),
      onDidRefresh: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    },
    hoverProvider: { clearCache: vi.fn() },
    smartScanner: { onScanComplete: vi.fn(), runActivationScan: vi.fn(), scan: vi.fn() },
    statusBarManager: { refresh: vi.fn() },
    cliService: { ensureGitignoreEntries: vi.fn() },
    configurationService: {
      onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      getSnapshot: vi.fn().mockReturnValue(null),
    },
  })),
}));
vi.mock('./controllers/configuration-controller');
vi.mock('./controllers/sync-controller');
vi.mock('./controllers/transform-controller');
vi.mock('./controllers/extraction-controller');
vi.mock('./markdown-preview');
vi.mock('@i18nsmith/core', () => ({
  ensureGitignore: vi.fn(),
}));

describe('Extension Activation', () => {
  it('should activate successfully', () => {
    const context = {
      subscriptions: [],
      extensionUri: { fsPath: '/mock/extension' },
    } as any;

    activate(context);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('i18nsmith.check', expect.any(Function));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('i18nsmith.sync', expect.any(Function));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('i18nsmith.actions', expect.any(Function));
  });
});
