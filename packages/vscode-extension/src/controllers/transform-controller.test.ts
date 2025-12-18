import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { TransformController } from './transform-controller';
import { ServiceContainer } from '../services/container';

// Mock vscode
vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showQuickPick: vi.fn().mockResolvedValue({ label: 'Apply', action: 'apply' }),
    withProgress: vi.fn((options, task) => task({ report: vi.fn() })),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
  },
  ProgressLocation: {
    Notification: 15,
  },
}));

describe('TransformController', () => {
  let transformController: TransformController;
  let mockServices: any;

  beforeEach(() => {
    mockServices = {
      cliService: {
        runCliCommand: vi.fn().mockResolvedValue({ success: true }),
      },
      previewManager: {
        createPreviewPlan: vi.fn(),
        run: vi.fn().mockResolvedValue({
          payload: {
            summary: {
              candidates: [
                { status: 'pending', filePath: 'test.ts', text: 't("hello")' },
                { status: 'existing', filePath: 'test2.ts', text: 't("world")' },
                { status: 'skipped', filePath: 'test3.ts', text: 'console.log("skip")' }
              ]
            }
          }
        }),
      },
      hoverProvider: {
        clearCache: vi.fn(),
      },
      reportWatcher: {
        refresh: vi.fn(),
      },
      smartScanner: {
        scan: vi.fn(),
      },
      logVerbose: vi.fn(),
    };

    transformController = new TransformController(mockServices as ServiceContainer);
  });

  it('should run transform command via previewManager', async () => {
    await transformController.runTransform();
    expect(mockServices.previewManager.run).toHaveBeenCalled();
    const callArgs = mockServices.previewManager.run.mock.calls[0];
    expect(callArgs[0].kind).toBe('transform');
  });

  it('should handle transform with specific targets', async () => {
    const targets = ['src/components/Button.tsx'];
    await transformController.runTransform({ targets, label: 'Button component' });
    expect(mockServices.previewManager.run).toHaveBeenCalled();
    const callArgs = mockServices.previewManager.run.mock.calls[0];
    expect(callArgs[0].args).toEqual(['--target', '"src/components/Button.tsx"']);
  });

  it('should show error when no workspace folder found', async () => {
    // Mock no workspace folders
    const originalFolders = vscode.workspace.workspaceFolders;
    (vscode.workspace as any).workspaceFolders = undefined;

    await transformController.runTransform();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('No workspace folder found');

    // Restore
    (vscode.workspace as any).workspaceFolders = originalFolders;
  });

  it('should filter transformable candidates from preview', async () => {
    await transformController.runTransform();
    expect(mockServices.logVerbose).toHaveBeenCalledWith(
      expect.stringContaining('2 transformable candidates')
    );
  });
});