import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class I18nDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    const keyRange = findKeyRangeAtPosition(document, position);
    if (!keyRange) return null;

    const key = document.getText(keyRange).replace(/^["'`]|["'`]$/g, '');
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return null;

    const { localesDir, sourceLanguage } = readConfig(workspaceFolder.uri.fsPath);
    const targetPath = path.join(workspaceFolder.uri.fsPath, localesDir, `${sourceLanguage}.json`);
    if (!fs.existsSync(targetPath)) return null;

    const content = fs.readFileSync(targetPath, 'utf8');
    const loc = findApproxLocationInJson(content, key);
    const uri = vscode.Uri.file(targetPath);

    if (loc) {
      const start = new vscode.Position(loc.line, loc.character);
      const range = new vscode.Range(start, start);
      return new vscode.Location(uri, range);
    }

    // Fallback: top of file
    return new vscode.Location(uri, new vscode.Position(0, 0));
  }
}

function readConfig(root: string): { localesDir: string; sourceLanguage: string } {
  const cfgPath = path.join(root, 'i18n.config.json');
  let localesDir = 'locales';
  let sourceLanguage = 'en';
  try {
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      localesDir = cfg.localesDir || localesDir;
      sourceLanguage = cfg.sourceLanguage || sourceLanguage;
    }
  } catch (error) {
    console.warn('Failed to read i18nsmith config for definition provider:', error);
  }
  return { localesDir, sourceLanguage };
}

function findKeyRangeAtPosition(document: vscode.TextDocument, position: vscode.Position): vscode.Range | null {
  const line = document.lineAt(position.line).text;
  const patterns = [
    /t\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /t\(\s*['"`]([^'"`]+)['"`]\s*,/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(line)) !== null) {
      const keyText = m[1];
      const startIdx = m.index + m[0].indexOf(keyText);
      const endIdx = startIdx + keyText.length;
      if (position.character >= startIdx && position.character <= endIdx) {
        return new vscode.Range(position.line, startIdx, position.line, endIdx);
      }
    }
  }
  return null;
}

function findApproxLocationInJson(content: string, key: string): { line: number; character: number } | null {
  // Try flat key first
  const flatNeedle = `"${key}"`;
  let idx = content.indexOf(flatNeedle);
  if (idx !== -1) return offsetToPosition(content, idx);

  // Try last segment (best effort for nested structures)
  const last = key.split('.').pop()!;
  const segNeedle = `"${last}"`;
  idx = content.indexOf(segNeedle);
  if (idx !== -1) return offsetToPosition(content, idx);

  return null;
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
  const head = text.slice(0, offset);
  const lines = head.split(/\r?\n/);
  const line = lines.length - 1;
  const character = lines[lines.length - 1]?.length ?? 0;
  return { line, character };
}
