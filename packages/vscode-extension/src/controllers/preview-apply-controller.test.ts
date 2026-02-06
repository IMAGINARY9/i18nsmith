import { describe, it, expect, vi, beforeEach } from 'vitest';
// Minimal vscode mock for tests
vi.mock('vscode', () => ({
  window: { showWarningMessage: vi.fn(), createTerminal: vi.fn() },
  workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/project' } }] },
}));
import * as vscode from 'vscode';
import * as adapterPreflight from '../utils/adapter-preflight';
import { PreviewApplyController } from './preview-apply-controller';
vi.mock('../utils/vue-parser-check', () => ({ checkAndPromptForVueParser: vi.fn().mockResolvedValue(true) }));

class DummyController extends PreviewApplyController {
  public async callApply(opts: any) {
    return this.applyPreviewCommand(opts);
  }
}

describe('PreviewApplyController preflight integration', () => {
  const fakeServices: any = {
    cliService: { runCliCommand: vi.fn().mockResolvedValue({ success: true }) },
    cliOutputChannel: { show: vi.fn(), appendLine: vi.fn() },
    reportWatcher: { refresh: vi.fn() },
    hoverProvider: { clearCache: vi.fn() },
    smartScanner: { scan: vi.fn() },
    frameworkDetectionService: { detectFramework: vi.fn().mockResolvedValue({ adapter: 'react-i18next' }) },
    logVerbose: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });


  it('aborts apply when user cancels preflight warning', async () => {
    const controller = new DummyController(fakeServices as any);
    const missing = [{ adapter: 'vue', dependency: 'vue-eslint-parser', installHint: 'npm i -D vue-eslint-parser' }];
    vi.spyOn(adapterPreflight, 'runAdapterPreflightCheck').mockReturnValue(missing as any);
    vi.spyOn(vscode.window, 'showWarningMessage' as any).mockResolvedValueOnce('Cancel');

    const res = await controller.callApply({ command: 'i18nsmith sync --apply-preview foo', progressTitle: 'x', successMessage: 's', scannerTrigger: 'sync' });
    expect(res).toBe(false);
  });
});
