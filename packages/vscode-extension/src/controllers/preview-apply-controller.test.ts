import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { PreviewApplyController } from './preview-apply-controller';

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
    vi.spyOn(require('../utils/adapter-preflight'), 'runAdapterPreflightCheck').mockReturnValue(missing as any);
    vi.spyOn(vscode.window, 'showWarningMessage' as any).mockResolvedValueOnce('Cancel');

    const res = await controller.callApply({ command: 'i18nsmith sync --apply-preview foo', progressTitle: 'x', successMessage: 's', scannerTrigger: 'sync' });
    expect(res).toBe(false);
  });
});
