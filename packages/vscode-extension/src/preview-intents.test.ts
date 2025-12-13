import { describe, expect, it } from 'vitest';
import { parsePreviewableCommand } from './preview-intents';

describe('parsePreviewableCommand', () => {
  it('detects sync commands invoked through node CLI entry', () => {
    const cmd =
      'node "/Users/me/projects/i18nsmith/packages/cli/dist/index.js" sync --apply-preview .i18nsmith/previews/sync-preview-1.json --selection-file .i18nsmith/previews/selection.json --prune';
    const parsed = parsePreviewableCommand(cmd);
    expect(parsed).toBeDefined();
    expect(parsed).toMatchObject({ kind: 'sync' });
  });

  it('detects commands launched via npx with version specifier', () => {
    const parsed = parsePreviewableCommand(
      'npx i18nsmith@latest transform --target src/components/HugePage.tsx'
    );
    expect(parsed).toMatchObject({ kind: 'transform', targets: ['src/components/HugePage.tsx'] });
  });

  it('ignores unrelated npm scripts', () => {
    const parsed = parsePreviewableCommand('npm run sync');
    expect(parsed).toBeNull();
  });
});
