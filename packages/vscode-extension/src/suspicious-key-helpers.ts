import { KeyGenerator } from '@i18nsmith/core';
import type { WorkspaceConfigSnapshot } from './workspace-config';

interface SuspiciousKeySuggestionOptions {
  workspaceRoot?: string;
  filePath?: string;
}

export function buildSuspiciousKeySuggestion(
  key: string,
  config: WorkspaceConfigSnapshot | null,
  options: SuspiciousKeySuggestionOptions = {}
): string {
  try {
    const generator = new KeyGenerator({
      namespace: config?.keyGeneration?.namespace,
      hashLength: config?.keyGeneration?.shortHashLen,
      workspaceRoot: options.workspaceRoot,
    });
    const baseText = key.replace(/-[a-f0-9]{6,}$/i, '').replace(/^[^.]+\./, '');
    const generated = generator.generate(baseText || key, {
      filePath: options.filePath ?? options.workspaceRoot ?? '',
      kind: 'jsx-text',
    });
    return generated.key;
  } catch {
    return key;
  }
}
