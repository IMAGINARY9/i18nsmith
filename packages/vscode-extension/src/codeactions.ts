import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
  // Find config to get locales dir and source language
  const configPath = path.join(workspaceRoot, 'i18n.config.json');
  let localesDir = 'locales';
  let sourceLanguage = 'en';

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      localesDir = config.localesDir || 'locales';
      sourceLanguage = config.sourceLanguage || 'en';
    }
  } catch {
    // Use defaults
  }

  const localePath = path.join(workspaceRoot, localesDir, `${sourceLanguage}.json`);

  try {
    let localeData: Record<string, unknown> = {};
    
    if (fs.existsSync(localePath)) {
      localeData = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    }

    // Add the key with a TODO placeholder
    setNestedValue(localeData, key, `[TODO: ${key}]`);

    // Write back
    fs.writeFileSync(localePath, JSON.stringify(localeData, null, 2) + '\n', 'utf8');

    vscode.window.showInformationMessage(`Added placeholder for '${key}' to ${sourceLanguage}.json`);

    // Open the locale file
    const doc = await vscode.workspace.openTextDocument(localePath);
    await vscode.window.showTextDocument(doc);
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to add placeholder: ${error}`);
  }
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj: Record<string, unknown>, key: string, value: unknown): void {
  // For flat keys (containing dots but stored as-is), just set directly
  // This matches i18nsmith's default behavior
  obj[key] = value;
}
