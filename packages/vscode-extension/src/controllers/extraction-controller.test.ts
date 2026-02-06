import { describe, it, expect, vi } from 'vitest';
// Minimal vscode mock for tests that import modules which reference 'vscode'
vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: '/tmp/project' } }] },
  Position: class {},
  Range: class {},
  window: { showInformationMessage: vi.fn(), showWarningMessage: vi.fn() },
}));
import { ExtractionController } from './extraction-controller';

describe('ExtractionController.buildReplacement', () => {
  const fakeServices: any = {
    previewManager: {},
    diffPreviewService: {},
    hoverProvider: { clearCache: () => {} },
    reportWatcher: { refresh: () => {} },
    logVerbose: () => {},
  };

  it('returns Vue template replacement when inside template', async () => {
    const controller = new ExtractionController(fakeServices as any);
    // @ts-ignore - stub private method
    controller.isInsideVueTemplate = async () => true;

    const doc: any = {
      languageId: 'vue',
      uri: { fsPath: '/tmp/App.vue' },
      fileName: '/tmp/App.vue',
      version: 1,
      getText: () => '<template> Hello World </template>',
      offsetAt: (_: any) => 12,
  positionAt: (_: any) => ({ line: 0, character: 0 }),
      lineAt: (_: any) => ({ text: ' Hello World ' }),
      lineCount: 1,
    };

  const startPos: any = { line: 0, character: 0, translate: (d: number, c: number) => ({ line: 0, character: 1 }) };
  const endPos: any = { line: 0, character: 5, translate: (d: number, c: number) => ({ line: 0, character: 6 }) };
  const replacement = await (controller as any).buildReplacement(doc, { start: startPos, end: endPos } as any, 'Hello World', 'common.hello');
    expect(replacement).toBe("{{ $t('common.hello') }}");
  });

  it('returns t(...) in script region', async () => {
    const controller = new ExtractionController(fakeServices as any);
    // @ts-ignore - stub private method
    controller.isInsideVueTemplate = async () => false;

    const doc: any = {
      languageId: 'vue',
      uri: { fsPath: '/tmp/App.vue' },
      fileName: '/tmp/App.vue',
      version: 1,
      getText: () => '<script> const s = "hello"; </script>',
      offsetAt: (_: any) => 12,
  positionAt: (_: any) => ({ line: 0, character: 0 }),
      lineAt: (_: any) => ({ text: ' const s = "hello"; ' }),
      lineCount: 1,
    };

  const startPos2: any = { line: 0, character: 0, translate: (d: number, c: number) => ({ line: 0, character: 1 }) };
  const endPos2: any = { line: 0, character: 5, translate: (d: number, c: number) => ({ line: 0, character: 6 }) };
  const replacement = await (controller as any).buildReplacement(doc, { start: startPos2, end: endPos2 } as any, 'hello', 'common.hello');
    expect(replacement).toBe("t('common.hello')");
  });
});
