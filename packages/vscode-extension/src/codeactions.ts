import * as vscode from 'vscode';
import type { SuspiciousKeyWarning } from '@i18nsmith/core';
import { DiagnosticsManager } from './diagnostics';
import { buildSuspiciousKeySuggestion } from './suspicious-key-helpers';

/**
 * Code Action provider for i18nsmith quick fixes
 */
export class I18nCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  private static readonly MAX_SUSPICIOUS_KEY_ACTIONS = 3;

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

    const suspiciousDiagnostics: vscode.Diagnostic[] = [];
    let suspiciousRefactorActions = 0;

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
        suspiciousDiagnostics.push(diagnostic);

        if (suspiciousRefactorActions < I18nCodeActionProvider.MAX_SUSPICIOUS_KEY_ACTIONS) {
          const refactorAction = this.createRefactorSuspiciousKeyAction(document, diagnostic);
          if (refactorAction) {
            actions.push(refactorAction);
          }
          suspiciousRefactorActions += 1;
        }

        const ignoreAction = this.createIgnoreSuspiciousKeyAction(document, diagnostic);
        if (ignoreAction) {
          actions.push(ignoreAction);
        }

        const checkAction = this.createRunCheckAction(diagnostic);
        actions.push(checkAction);

        continue;
      }

      // For any i18nsmith diagnostic, offer to run check
      const checkAction = this.createRunCheckAction(diagnostic);
      actions.push(checkAction);
    }

    if (suspiciousDiagnostics.length > I18nCodeActionProvider.MAX_SUSPICIOUS_KEY_ACTIONS) {
      const renameAllAction = this.createRenameSuspiciousKeysInFileAction(document, suspiciousDiagnostics.length);
      if (renameAllAction) {
        actions.push(renameAllAction);
      }
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
    const warning = buildSuspiciousKeyWarning(key, document, diagnostic);
    const suggestedKey = buildSuspiciousKeySuggestion(
      key,
      workspaceRoot,
      warning.filePath ?? document.uri.fsPath
    );

    const action = new vscode.CodeAction(
      `Refactor suspicious key to "${suggestedKey}"`,
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.command = {
      command: 'i18nsmith.renameSuspiciousKey',
      title: 'Rename suspicious key',
      arguments: [warning],
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

  private createRenameSuspiciousKeysInFileAction(
    document: vscode.TextDocument,
    totalCount: number
  ): vscode.CodeAction | null {
    const action = new vscode.CodeAction(
      `Rename ${totalCount} suspicious key${totalCount === 1 ? '' : 's'} in this file`,
      vscode.CodeActionKind.QuickFix
    );
    action.command = {
      command: 'i18nsmith.renameSuspiciousKeysInFile',
      title: 'Rename suspicious keys in file',
      arguments: [document.uri],
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

function buildSuspiciousKeyWarning(
  key: string,
  document: vscode.TextDocument,
  diagnostic: vscode.Diagnostic
): SuspiciousKeyWarning {
  return {
    key,
    filePath: document.uri.fsPath,
    position: {
      line: diagnostic.range.start.line + 1,
      column: diagnostic.range.start.character + 1,
    },
    reason: extractSuspiciousReasonCode(diagnostic.message) ?? 'contains-spaces',
  };
}

function extractSuspiciousReasonCode(message: string): string | undefined {
  const match = message.match(/\(([^)]+)\)/);
  if (!match) {
    return undefined;
  }
  return match[1].trim().toLowerCase().replace(/\s+/g, '-');
}

function extractSuspiciousKeyFromMessage(message: string): string | null {
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : null;
}
