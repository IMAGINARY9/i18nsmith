import * as vscode from 'vscode';
import * as path from 'path';

type TemplateRange = { start: number; end: number } | null;

const cache = new Map<string, { version: number; templateRange: TemplateRange }>();

function tryResolveParser(workspaceRoot: string): string | null {
  try {
    // Try to resolve the parser from the workspace (so we use the project's install)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const resolved = require.resolve('vue-eslint-parser', { paths: [workspaceRoot] });
    return resolved;
  } catch {
    return null;
  }
}

export async function getVueTemplateRange(document: vscode.TextDocument): Promise<TemplateRange> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!workspaceFolder) return null;

  const cacheKey = document.uri.toString();
  const cached = cache.get(cacheKey);
  if (cached && cached.version === document.version) {
    return cached.templateRange;
  }

  const workspaceRoot = workspaceFolder.uri.fsPath;
  const parserPath = tryResolveParser(workspaceRoot);
  if (!parserPath) {
    cache.set(cacheKey, { version: document.version, templateRange: null });
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parser = require(parserPath);
    // parseForESLint is the recommended API
    const res = parser.parseForESLint(document.getText(), { filePath: document.fileName });
    const ast = (res && res.ast) ? res.ast : (res as any);
    const templateBody = (ast && (ast as any).templateBody) ? (ast as any).templateBody : null;
    if (templateBody && Array.isArray((templateBody as any).range) && (templateBody as any).range.length === 2) {
      const [start, end] = (templateBody as any).range as [number, number];
      const range = { start, end };
      cache.set(cacheKey, { version: document.version, templateRange: range });
      return range;
    }
    // Some parser versions expose loc instead
    if (templateBody && templateBody.loc && templateBody.loc.start && templateBody.loc.end) {
      // Convert line/column to offset by using document.positionAt
      const startPos = new vscode.Position(templateBody.loc.start.line - 1, templateBody.loc.start.column);
      const endPos = new vscode.Position(templateBody.loc.end.line - 1, templateBody.loc.end.column);
      const range = { start: document.offsetAt(startPos), end: document.offsetAt(endPos) };
      cache.set(cacheKey, { version: document.version, templateRange: range });
      return range;
    }
  } catch (e) {
    // parse failed — treat as not available
    cache.set(cacheKey, { version: document.version, templateRange: null });
    return null;
  }

  cache.set(cacheKey, { version: document.version, templateRange: null });
  return null;
}

export function clearVueAstCacheFor(document: vscode.TextDocument) {
  cache.delete(document.uri.toString());
}
