import * as fs from 'fs';
import * as path from 'path';
import { KeyGenerator } from '@i18nsmith/core';

export interface LightweightWorkspaceConfig {
  localesDir?: string;
  keyGeneration?: {
    namespace?: string;
    shortHashLen?: number;
  };
}

export function buildSuspiciousKeySuggestion(
  key: string,
  workspaceRoot?: string,
  filePath?: string
): string {
  try {
    const config = loadWorkspaceConfig(workspaceRoot);
    const generator = new KeyGenerator({
      namespace: config.keyGeneration?.namespace,
      hashLength: config.keyGeneration?.shortHashLen,
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

export function loadWorkspaceConfig(workspaceRoot?: string): LightweightWorkspaceConfig {
  if (!workspaceRoot) {
    return {};
  }

  const configPath = path.join(workspaceRoot, 'i18n.config.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(content);
    return {
      localesDir: parsed?.globs?.localesDir ?? parsed?.localesDir,
      keyGeneration: parsed?.keyGeneration,
    };
  } catch {
    return {};
  }
}
