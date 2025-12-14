import { KeyGenerator } from '@i18nsmith/core';
import { getWorkspaceConfigSnapshot } from './workspace-config';

export function buildSuspiciousKeySuggestion(
  key: string,
  workspaceRoot?: string,
  filePath?: string
): string {
  try {
    const config = getWorkspaceConfigSnapshot(workspaceRoot);
    const generator = new KeyGenerator({
      namespace: config?.keyGeneration?.namespace,
      hashLength: config?.keyGeneration?.shortHashLen,
      workspaceRoot,
    });
    const baseText = key.replace(/-[a-f0-9]{6,}$/i, '').replace(/^[^.]+\./, '');
    const generated = generator.generate(baseText || key, {
      filePath: filePath ?? workspaceRoot ?? '',
      kind: 'jsx-text',
    });
    return generated.key;
  } catch {
    return key;
  }
}
