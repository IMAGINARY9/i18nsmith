import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncController } from './sync-controller';
import { ServiceContainer } from '../services/container';
import { ConfigurationController } from './configuration-controller';

// Mock vscode
vi.mock('vscode', () => {
  const EventEmitter = class {
    event = vi.fn();
    fire = vi.fn();
  };
  return {
    window: {
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      withProgress: vi.fn((options, task) => task({ report: vi.fn() })),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: '/mock/workspace' } }],
    },
    Uri: {
      parse: vi.fn(),
    },
    ProgressLocation: {
      Notification: 15,
    },
    EventEmitter,
  };
});

// Mock vue parser check to avoid interacting with workspace file system in tests
vi.mock('../utils/vue-parser-check', () => ({ checkAndPromptForVueParser: vi.fn().mockResolvedValue(true) }));

describe('SyncController', () => {
  let syncController: SyncController;
  let mockServices: any;
  let mockConfigController: any;

  beforeEach(() => {
    mockServices = {
      cliService: {
        runCliCommand: vi.fn().mockResolvedValue({ success: true }),
      },
      previewManager: {
        createPreviewPlan: vi.fn(),
        run: vi.fn().mockResolvedValue({ payload: { summary: {} } }),
      },
      diagnosticsManager: {
        getReport: vi.fn(),
      },
      logVerbose: vi.fn(),
    };

    mockConfigController = {
      // mock methods if needed
    };

    syncController = new SyncController(mockServices as ServiceContainer, mockConfigController as ConfigurationController);
  });

  it('should run sync command via previewManager', async () => {
    await syncController.runSync({ dryRunOnly: false });
    expect(mockServices.previewManager.run).toHaveBeenCalled();
    const callArgs = mockServices.previewManager.run.mock.calls[0];
    expect(callArgs[0].kind).toBe('sync');
  });

  it('should handle dry run', async () => {
    await syncController.runSync({ dryRunOnly: true });
    expect(mockServices.previewManager.run).toHaveBeenCalled();
    expect(mockServices.logVerbose).toHaveBeenCalledWith(expect.stringContaining('Dry run complete'));
  });
});
