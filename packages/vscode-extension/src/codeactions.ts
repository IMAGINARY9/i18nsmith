import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { KeyGenerator, loadConfig, LocaleStore } from '@i18nsmith/core';
import { DiagnosticsManager } from './diagnostics';

/**
 * Code Action provider for i18nsmith quick fixes
 */
export class I18nCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  constructor(private diagnosticsManager: DiagnosticsManager) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Get diagnostics for this document
    const diagnostics = context.diagnostics.filter(d => d.source === 'i18nsmith');

    for (const diagnostic of diagnostics) {
      // Check if this is a missing key issue
      if (diagnostic.code === 'missing-key' || 
          diagnostic.code === 'sync-missing-key' ||
          diagnostic.message.includes('missing')) {
        
        const key = this.extractKeyFromDiagnostic(diagnostic);
        if (key) {
          // Add placeholder to source locale
          const addAction = this.createAddPlaceholderAction(document, diagnostic, key);
          if (addAction) {
            actions.push(addAction);
          }

          // Run sync to fix
          const syncAction = this.createRunSyncAction(diagnostic);
          actions.push(syncAction);
        }
      }

      if (diagnostic.code === 'suspicious-key') {
        const refactorAction = this.createRefactorSuspiciousKeyAction(document, diagnostic);
        if (refactorAction) {
          actions.push(refactorAction);
        }

        const ignoreAction = this.createIgnoreSuspiciousKeyAction(document, diagnostic);
        if (ignoreAction) {
          actions.push(ignoreAction);
        }
      }

      // For any i18nsmith diagnostic, offer to run check
      const checkAction = this.createRunCheckAction(diagnostic);
      actions.push(checkAction);
    }

    // Also check if we're on a t('key') call and offer to extract
    const extractAction = this.createExtractKeyAction(document, range);
    if (extractAction) {
      actions.push(extractAction);
    }

    return actions;
  }

  private createRefactorSuspiciousKeyAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | null {
  const key = extractSuspiciousKeyFromMessage(diagnostic.message);
    if (!key) {
      return null;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const suggestedKey = buildSuspiciousKeySuggestion(key, document.uri.fsPath, workspaceRoot);

    const action = new vscode.CodeAction(
      `Refactor suspicious key to "${suggestedKey}"`,
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.command = {
      command: 'i18nsmith.renameSuspiciousKey',
      title: 'Rename suspicious key',
      arguments: [key, suggestedKey],
    };

    return action;
  }

  private createIgnoreSuspiciousKeyAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | null {
    const action = new vscode.CodeAction(
      `Ignore suspicious key warning here`,
      vscode.CodeActionKind.QuickFix
    );
    action.diagnostics = [diagnostic];
    action.command = {
      command: 'i18nsmith.ignoreSuspiciousKey',
      title: 'Ignore suspicious key',
      arguments: [document.uri, diagnostic.range.start.line],
    };
    return action;
  }

  /**
   * Extract key from diagnostic message
   */
  private extractKeyFromDiagnostic(diagnostic: vscode.Diagnostic): string | null {
    // Try to extract key from message patterns like:
    // "Key 'common.greeting' is missing"
    // "Missing key: common.greeting"
    const patterns = [
      /Key ['"`]([^'"`]+)['"`]/,
      /Missing key:\s*(['"`]?)([^'"`\s]+)\1/,
      /key:\s*(['"`]?)([^'"`\s]+)\1/i,
    ];

    for (const pattern of patterns) {
      const match = diagnostic.message.match(pattern);
      if (match) {
        return match[2] || match[1];
      }
    }

    return null;
  }

  /**
   * Create action to add placeholder value to locale file
   */
  private createAddPlaceholderAction(
    _document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic,
    key: string
  ): vscode.CodeAction | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    const action = new vscode.CodeAction(
      `Add placeholder for '${key}'`,
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.isPreferred = true;

    // Create command to add the key
    action.command = {
      command: 'i18nsmith.addPlaceholder',
      title: 'Add Placeholder',
      arguments: [key, workspaceFolder.uri.fsPath],
    };

    return action;
  }

  /**
   * Create action to run sync
   */
  private createRunSyncAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Run i18nsmith sync to fix',
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.command = {
      command: 'i18nsmith.sync',
      title: 'Sync Locales',
    };

    return action;
  }

  /**
   * Create action to run check
   */
  private createRunCheckAction(diagnostic: vscode.Diagnostic): vscode.CodeAction {
    const action = new vscode.CodeAction(
      'Run i18nsmith check',
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.command = {
      command: 'i18nsmith.check',
      title: 'Run Health Check',
    };

    return action;
  }

  /**
   * Create action to extract a string literal as a translation key
   */
  private createExtractKeyAction(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction | null {
    // Check if we're selecting a string literal
    const text = document.getText(range);
    if (!text || text.length < 2) {
      return null;
    }

    // Check if it looks like a string literal (starts and ends with quotes)
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('`') && trimmed.endsWith('`'))
    ) {
      const stringContent = trimmed.slice(1, -1);
      
      // Don't offer for already translated strings or very short strings
      if (stringContent.length < 2 || stringContent.includes('t(')) {
        return null;
      }

      const action = new vscode.CodeAction(
        `Extract "${stringContent.slice(0, 20)}${stringContent.length > 20 ? '...' : ''}" as translation key`,
        vscode.CodeActionKind.RefactorExtract
      );

      action.command = {
        command: 'i18nsmith.extractKey',
        title: 'Extract Translation Key',
        arguments: [document.uri, range, stringContent],
      };

      return action;
    }

    return null;
  }
}

/**
 * Add a placeholder key to the source locale file
 */
export async function addPlaceholderToLocale(key: string, workspaceRoot: string): Promise<void> {
  try {
    const { config } = loadConfig(workspaceRoot);
    const localesDir = path.join(workspaceRoot, config.localesDir);
    const store = new LocaleStore(localesDir, {
      format: config.locales?.format ?? 'auto',
      delimiter: config.locales?.delimiter ?? '.',
      sortKeys: config.locales?.sortKeys ?? 'alphabetical',
    });

    const sourceLanguage = config.sourceLanguage;
    const seed = config.sync?.seedValue ?? `[TODO: ${key}]`;
    await store.upsert(sourceLanguage, key, seed);
    await store.flush();

    vscode.window.showInformationMessage(`Added placeholder for '${key}' to ${sourceLanguage}.json`);

    const localePath = path.join(localesDir, `${sourceLanguage}.json`);
    const doc = await vscode.workspace.openTextDocument(localePath);
    await vscode.window.showTextDocument(doc);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add placeholder: ${error}`);
  }
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj: Record<string, any>, key: string, value: unknown): void {
  const keys = key.split('.');
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const currentKey = keys[i];
    if (typeof current[currentKey] !== 'object' || current[currentKey] === null) {
      current[currentKey] = {};
    }
    current = current[currentKey];
  }

  current[keys[keys.length - 1]] = value;
}

function buildSuspiciousKeySuggestion(key: string, filePath: string, workspaceRoot?: string): string {
  // Use the shared KeyGenerator from core to honor workspace config (namespace, hash length, style)
  try {
    if (workspaceRoot) {
      const { config } = loadConfig(workspaceRoot);
      const hashLength = config.keyGeneration?.shortHashLen ?? 6;
      const namespace = config.keyGeneration?.namespace ?? 'common';
      const generator = new KeyGenerator({ namespace, hashLength });
      const { key: generated } = generator.generate(key, { filePath, kind: 'locale' });
      return generated;
    }
  } catch {
    // Fall back to local heuristic below if config load fails
  }

  // Fallback heuristic (no config): preserve namespace and add short hash
  const lastDot = key.lastIndexOf('.');
  const ns = lastDot > 0 ? key.slice(0, lastDot) : 'common';
  const leaf = lastDot > 0 ? key.slice(lastDot + 1) : key;
  const sanitizedLeaf = leaf
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase() || 'key';
  const hash = createHash('sha1').update(`${key}|${filePath ?? ''}`).digest('hex').slice(0, 6);
  return `${ns}.${sanitizedLeaf}.${hash}`;
}

function loadWorkspaceConfig(workspaceRoot?: string): { localesDir?: string } {
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
    return { localesDir: parsed.localesDir };
  } catch {
    return {};
  }
}

function extractSuspiciousKeyFromMessage(message: string): string | null {
  const match = message.match(/"([^\"]+)"/);
  return match ? match[1] : null;
}
