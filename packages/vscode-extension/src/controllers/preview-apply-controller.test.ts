import { describe, it, expect, vi, beforeEach } from 'vitest';
// Minimal vscode mock for tests
vi.mock('vscode', () => ({
  window: { showWarningMessage: vi.fn(), createTerminal: vi.fn() },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/project' } }],
    textDocuments: [],
  },
}));
vi.mock('../utils/vue-ast', () => ({
  clearVueAstCacheFor: vi.fn(),
}));
import * as vscode from 'vscode';
import * as adapterPreflight from '../utils/adapter-preflight';
import * as vueAst from '../utils/vue-ast';
import { PreviewApplyController } from './preview-apply-controller';
vi.mock('../utils/vue-parser-check', () => ({ checkAndPromptForVueParser: vi.fn().mockResolvedValue(true) }));

class DummyController extends PreviewApplyController {
  public async callApply(opts: any) {
    return this.applyPreviewCommand(opts);
  }
}

describe('PreviewApplyController preflight integration', () => {
  let fakeServices: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    (vscode.workspace as any).textDocuments = [];
      fakeServices = {
        cliService: { runCliCommand: vi.fn().mockResolvedValue({ success: true }) },
        cliOutputChannel: { show: vi.fn(), appendLine: vi.fn() },
        reportWatcher: { refresh: vi.fn() },
        hoverProvider: { clearCache: vi.fn() },
        smartScanner: { scan: vi.fn() },
        frameworkDetectionService: { detectFramework: vi.fn().mockResolvedValue({ adapter: 'react-i18next' }) },
        dependencyCacheManager: { notifyInstalled: vi.fn() },
        logVerbose: vi.fn(),
      };
  });


  it('aborts apply when user cancels preflight warning', async () => {
    const controller = new DummyController(fakeServices as any);
    const missing = [{ adapter: 'vue', dependency: 'vue-eslint-parser', installHint: 'npm i -D vue-eslint-parser' }];
    vi.spyOn(adapterPreflight, 'runAdapterPreflightCheck').mockReturnValue(missing as any);
    vi.spyOn(vscode.window, 'showWarningMessage' as any).mockResolvedValueOnce('Cancel');

    const res = await controller.callApply({ command: 'i18nsmith sync --apply-preview foo', progressTitle: 'x', successMessage: 's', scannerTrigger: 'sync' });
    expect(res).toBe(false);
  });

  it('installs dependencies and retries operation when user chooses "Install & Retry"', async () => {
    const controller = new DummyController(fakeServices as any);
    const missing = [{ adapter: 'vue', dependency: 'vue-eslint-parser', installHint: 'npm i -D vue-eslint-parser' }];
    
    // Mock the preflight check to return missing dependencies
    vi.spyOn(adapterPreflight, 'runAdapterPreflightCheck').mockReturnValue(missing as any);
    
    // Mock user choosing "Install & Retry"
    vi.spyOn(vscode.window, 'showWarningMessage' as any).mockResolvedValueOnce('Install & Retry');
    
    // Mock successful installation
    const installSpy = vi.spyOn(controller as any, 'installDependencies').mockResolvedValue(true);
    
    // Mock the retry callback
    const retryCallback = vi.fn().mockResolvedValue(undefined);
    
    const res = await controller.callApply({ 
      command: 'i18nsmith sync --apply-preview foo', 
      progressTitle: 'x', 
      successMessage: 's', 
      scannerTrigger: 'sync' 
    });
    
    // Should have attempted to install dependencies
    expect(installSpy).toHaveBeenCalledWith(['npm i -D vue-eslint-parser'], expect.any(Object));
    
    // Should not have proceeded with the original command since we mocked preflight to return missing deps
    // The retry logic is tested separately in handleMissingDependencies
  });

  it('handleMissingDependencies calls retry callback after successful install', async () => {
    const controller = new DummyController(fakeServices as any);
    const missing = [{ adapter: 'vue', dependency: 'vue-eslint-parser', installHint: 'npm i -D vue-eslint-parser' }];
    
    // Mock user choosing "Install & Retry"
    vi.spyOn(vscode.window, 'showWarningMessage' as any).mockResolvedValueOnce('Install & Retry');
    
    // Mock successful installation
    const installSpy = vi.spyOn(controller as any, 'installDependencies').mockResolvedValue(true);
    
    // Mock the retry callback
    const retryCallback = vi.fn().mockResolvedValue(undefined);
    
    const result = await (controller as any).handleMissingDependencies(missing, { uri: { fsPath: '/tmp/project' } }, retryCallback);
    
    // Should have attempted to install dependencies
    expect(installSpy).toHaveBeenCalledWith(['npm i -D vue-eslint-parser'], expect.any(Object));
    
    // Should have called the retry callback
    expect(retryCallback).toHaveBeenCalled();
    
    // Should return false (don't proceed with current operation, let retry handle it)
    expect(result).toBe(false);
  });

  it('handleMissingDependencies does not call retry when install fails', async () => {
    const controller = new DummyController(fakeServices as any);
    const missing = [{ adapter: 'vue', dependency: 'vue-eslint-parser', installHint: 'npm i -D vue-eslint-parser' }];
    
    // Mock user choosing "Install & Retry"
    vi.spyOn(vscode.window, 'showWarningMessage' as any).mockResolvedValueOnce('Install & Retry');
    
    // Mock failed installation
    const installSpy = vi.spyOn(controller as any, 'installDependencies').mockResolvedValue(false);
    
    // Mock the retry callback
    const retryCallback = vi.fn().mockResolvedValue(undefined);
    
    const result = await (controller as any).handleMissingDependencies(missing, { uri: { fsPath: '/tmp/project' } }, retryCallback);
    
    // Should have attempted to install dependencies
    expect(installSpy).toHaveBeenCalledWith(['npm i -D vue-eslint-parser'], expect.any(Object));
    
    // Should NOT have called the retry callback
    expect(retryCallback).not.toHaveBeenCalled();
    
    // Should return false (don't proceed)
    expect(result).toBe(false);
  });

  it('notifies dependency cache manager after successful install', async () => {
    const controller = new DummyController(fakeServices as any);
    const notifySpy = vi.spyOn(fakeServices.dependencyCacheManager, 'notifyInstalled');

    // Mock cliService to succeed
    fakeServices.cliService.runCliCommand.mockResolvedValue({ success: true });

    // Call installDependencies directly
    const result = await (controller as any).installDependencies(['npm i -D vue-eslint-parser'], {
      uri: { fsPath: '/tmp/project' },
    } as any);

    expect(result).toBe(true);
    expect(notifySpy).toHaveBeenCalledWith(['vue-eslint-parser'], '/tmp/project');
  });
});
