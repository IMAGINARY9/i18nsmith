import { describe, it, expect, vi, beforeEach } from 'vitest';
// Minimal vscode mock for tests
vi.mock('vscode', () => ({
  window: {
    showQuickPick: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/project' } }],
  },
}));
import * as vscode from 'vscode';
import { ConfigurationController } from './configuration-controller';
import * as dyn from '../dynamic-key-whitelist';
import * as wc from '../workspace-config';

describe('ConfigurationController.whitelistDynamicKeys', () => {
  const fakeServices: any = {
    diagnosticsManager: { pruneDynamicWarnings: vi.fn(), suppressSyncWarnings: vi.fn() },
    reportWatcher: { refresh: vi.fn() },
    configurationService: { refresh: vi.fn() },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('persists selected whitelist suggestions and refreshes diagnostics', async () => {
    const controller = new ConfigurationController(fakeServices as any);

    // Seed lastSyncDynamicWarnings
    controller.setLastSyncDynamicWarnings([{ filePath: 'src/App.vue', expression: "$t('errors.{{code}}')", reason: 'template' } as any]);


    // Mock deriveWhitelistSuggestions to produce suggestions
    const suggestions = [{ assumption: "errors.{{code}}", expression: "$t('errors.{{code}}')" }];
    vi.spyOn(dyn, 'deriveWhitelistSuggestions').mockReturnValue(suggestions as any);

    // Mock showQuickPick to return selected items (canPickMany -> returns array)
    vi.spyOn(vscode.window, 'showQuickPick' as any).mockResolvedValueOnce([
      { label: suggestions[0].assumption, description: '1 occurrence', detail: `Example: ${suggestions[0].expression}`, picked: true, suggestion: suggestions[0] } as any,
    ] as any);

    // Mock loadDynamicWhitelistSnapshot and persistDynamicKeyAssumptions
    const workspaceFolder = { uri: { fsPath: '/tmp/project' } } as vscode.WorkspaceFolder;
    vi.spyOn(wc, 'loadDynamicWhitelistSnapshot').mockResolvedValue({ normalizedEntries: ['errors.{{code}}'] } as any);
    const persistSpy = vi.spyOn(wc, 'persistDynamicKeyAssumptions').mockResolvedValue(undefined as any);

    // Mock workspaceFolders getter
    vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([workspaceFolder] as any);

    await controller.whitelistDynamicKeys();

    expect(persistSpy).toHaveBeenCalled();
    expect(fakeServices.configurationService.refresh).toHaveBeenCalledWith(workspaceFolder.uri.fsPath);
    expect(fakeServices.reportWatcher.refresh).toHaveBeenCalled();
  });
});
