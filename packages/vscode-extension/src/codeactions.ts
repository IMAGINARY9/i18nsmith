import * as vscode from "vscode";
import type { SuspiciousKeyWarning } from "@i18nsmith/core";
import { DiagnosticsManager } from "./diagnostics";
import { buildSuspiciousKeySuggestion } from "./suspicious-key-helpers";
import type { ConfigurationService } from "./services/configuration-service";

/**
 * Code Action provider for i18nsmith quick fixes
 */
export class I18nCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.RefactorRewrite,
  ];

  private static readonly MAX_SUSPICIOUS_KEY_ACTIONS = 10;

  constructor(
    private diagnosticsManager: DiagnosticsManager,
    private readonly configurationService: ConfigurationService
  ) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    // Get diagnostics for this document
    const diagnostics = context.diagnostics.filter(
      (d) => d.source === "i18nsmith"
    );

    const suspiciousDiagnostics: vscode.Diagnostic[] = [];
    let suspiciousRefactorActions = 0;

    for (const diagnostic of diagnostics) {
      // Check if this is a hardcoded text issue
      if (diagnostic.code === "hardcoded-text") {
        const extractAction = this.createExtractHardcodedTextAction(
          document,
          diagnostic
        );
        if (extractAction) {
          actions.push(extractAction);
        }

        // Also offer to run transform command
        const transformAction = this.createRunTransformAction(diagnostic);
        actions.push(transformAction);

        continue;
      }

      // Check if this is a missing key issue
      if (
        diagnostic.code === "missing-key" ||
        diagnostic.code === "sync-missing-key" ||
        diagnostic.message.includes("missing")
      ) {
        const key = this.extractKeyFromDiagnostic(diagnostic);
        if (key) {
          // Add placeholder to source locale
          const addAction = this.createAddPlaceholderAction(
            document,
            diagnostic,
            key
          );
          if (addAction) {
            actions.push(addAction);
          }

          // Run sync to fix
          const syncAction = this.createRunSyncAction(diagnostic);
          actions.push(syncAction);
        }
      }

      if (diagnostic.code === "suspicious-key") {
        suspiciousDiagnostics.push(diagnostic);

        if (
          suspiciousRefactorActions <
          I18nCodeActionProvider.MAX_SUSPICIOUS_KEY_ACTIONS
        ) {
          const refactorAction = this.createRefactorSuspiciousKeyAction(
            document,
            diagnostic
          );
          if (refactorAction) {
            actions.push(refactorAction);
          }
          suspiciousRefactorActions += 1;
        }

        const ignoreAction = this.createIgnoreSuspiciousKeyAction(
          document,
          diagnostic
        );
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

    if (
      suspiciousDiagnostics.length >
      I18nCodeActionProvider.MAX_SUSPICIOUS_KEY_ACTIONS
    ) {
      const renameAllAction = this.createRenameSuspiciousKeysInFileAction(
        document,
        suspiciousDiagnostics.length
      );
      if (renameAllAction) {
        actions.push(renameAllAction);
      }
    }

    // Also check if we're on a t('key') call and offer to extract
    const extractAction = this.createExtractKeyAction(document, range);
    if (extractAction) {
      actions.push(extractAction);
    }

    // Vue-specific code actions
    if (document.languageId === 'vue') {
      const vueActions = this.createVueSpecificActions(document, range);
      actions.push(...vueActions);
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
    const config = workspaceRoot
      ? this.configurationService.getSnapshot(workspaceRoot)
      : null;
    const suggestedKey = buildSuspiciousKeySuggestion(key, config, {
      workspaceRoot,
      filePath: warning.filePath ?? document.uri.fsPath,
    });

    const action = new vscode.CodeAction(
      `Refactor suspicious key to "${suggestedKey}"`,
      vscode.CodeActionKind.RefactorRewrite
    );

    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    action.command = {
      command: "i18nsmith.renameSuspiciousKey",
      title: "Rename suspicious key",
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
      command: "i18nsmith.ignoreSuspiciousKey",
      title: "Ignore suspicious key",
      arguments: [document.uri, diagnostic.range.start.line],
    };
    return action;
  }

  private createRenameSuspiciousKeysInFileAction(
    document: vscode.TextDocument,
    totalCount: number
  ): vscode.CodeAction | null {
    const action = new vscode.CodeAction(
      `Rename ${totalCount} suspicious key${totalCount === 1 ? "" : "s"} in this file`,
      vscode.CodeActionKind.RefactorRewrite
    );
    action.command = {
      command: "i18nsmith.renameSuspiciousKeysInFile",
      title: "Rename suspicious keys in file",
      arguments: [document.uri],
    };
    return action;
  }

  /**
   * Extract key from diagnostic message
   */
  private extractKeyFromDiagnostic(
    diagnostic: vscode.Diagnostic
  ): string | null {
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
      command: "i18nsmith.addPlaceholder",
      title: "Add Placeholder",
      arguments: [key, workspaceFolder.uri.fsPath],
    };

    return action;
  }

  /**
   * Create action to run sync
   */
  private createRunSyncAction(
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      "Run i18nsmith sync to fix",
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.command = {
      command: "i18nsmith.sync",
      title: "Sync Locales",
    };

    return action;
  }

  /**
   * Create action to run check
   */
  private createRunCheckAction(
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      "Run i18nsmith check",
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.command = {
      command: "i18nsmith.check",
      title: "Run Health Check",
    };

    return action;
  }

  /**
   * Create action to extract hardcoded text as a translation key
   */
  private createExtractHardcodedTextAction(
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction | null {
    // Extract the text from the diagnostic message
    const match = diagnostic.message.match(/Hardcoded text "([^"]+)"/);
    if (!match) {
      return null;
    }

    const text = match[1];
    const truncatedText = text.length > 30 ? `${text.slice(0, 27)}...` : text;

    const action = new vscode.CodeAction(
      `Extract "${truncatedText}" to translation key`,
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    action.command = {
      command: "i18nsmith.extractKey",
      title: "Extract Translation Key",
      arguments: [document.uri, diagnostic.range, text],
    };

    return action;
  }

  /**
   * Create action to run transform command
   */
  private createRunTransformAction(
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      "Run i18nsmith transform (extract all)",
      vscode.CodeActionKind.QuickFix
    );

    action.diagnostics = [diagnostic];
    action.command = {
      command: "i18nsmith.transformFile",
      title: "Transform File",
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
      (trimmed.startsWith("`") && trimmed.endsWith("`"))
    ) {
      const stringContent = trimmed.slice(1, -1);

      // Don't offer for already translated strings or very short strings
      if (stringContent.length < 2 || stringContent.includes("t(")) {
        return null;
      }

      const action = new vscode.CodeAction(
        `Extract "${stringContent.slice(0, 20)}${stringContent.length > 20 ? "..." : ""}" as translation key`,
        vscode.CodeActionKind.RefactorExtract
      );

      action.command = {
        command: "i18nsmith.extractKey",
        title: "Extract Translation Key",
        arguments: [document.uri, range, stringContent],
      };

      return action;
    }

    return null;
  }

  /**
   * Create Vue-specific code actions
   */
  private createVueSpecificActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Check if we're in a Vue template and can convert attributes
    const templateAttributeAction = this.createVueTemplateAttributeAction(document, range);
    if (templateAttributeAction) {
      actions.push(templateAttributeAction);
    }

    // Check if we need to import useI18n in script setup
    const importUseI18nAction = this.createVueImportUseI18nAction(document);
    if (importUseI18nAction) {
      actions.push(importUseI18nAction);
    }

    return actions;
  }

  /**
   * Convert Vue template attributes like placeholder="text" to :placeholder="$t('key')"
   */
  private createVueTemplateAttributeAction(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection
  ): vscode.CodeAction | null {
    const line = document.lineAt(range.start.line);
    const text = line.text;

    // Check if we're on a Vue template attribute with a string value
    const attributeMatch = text.match(/(\w+)="([^"]+)"/);
    if (!attributeMatch) {
      return null;
    }

    const [, attrName, attrValue] = attributeMatch;

    // Skip if already using : or $t
    if (text.includes(':') || text.includes('$t')) {
      return null;
    }

    // Skip very short values
    if (attrValue.length < 2) {
      return null;
    }

    const action = new vscode.CodeAction(
      `Convert to dynamic attribute with i18n: :${attrName}="$t('...')"`,
      vscode.CodeActionKind.RefactorRewrite
    );

    action.command = {
      command: "i18nsmith.convertVueAttribute",
      title: "Convert Vue Attribute to i18n",
      arguments: [document.uri, range.start.line, attrName, attrValue],
    };

    return action;
  }

  /**
   * Add useI18n import to Vue script setup
   */
  private createVueImportUseI18nAction(
    document: vscode.TextDocument
  ): vscode.CodeAction | null {
    const text = document.getText();

    // Check if it's a Vue SFC with script setup
    if (!text.includes('<script setup') && !text.includes("<script setup")) {
      return null;
    }

    // Check if useI18n is already imported
    if (text.includes('useI18n') || text.includes('vue-i18n')) {
      return null;
    }

    // Check if there are any $t() calls in template that would need useI18n
    const templateMatch = text.match(/<template[^>]*>([\s\S]*?)<\/template>/);
    if (!templateMatch || !templateMatch[1].includes('$t(')) {
      return null;
    }

    const action = new vscode.CodeAction(
      "Import useI18n from vue-i18n",
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      command: "i18nsmith.importVueUseI18n",
      title: "Import useI18n",
      arguments: [document.uri],
    };

    return action;
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
    reason:
      extractSuspiciousReasonCode(diagnostic.message) ?? "contains-spaces",
  };
}

function extractSuspiciousReasonCode(message: string): string | undefined {
  const match = message.match(/\(([^)]+)\)/);
  if (!match) {
    return undefined;
  }
  return match[1].trim().toLowerCase().replace(/\s+/g, "-");
}

function extractSuspiciousKeyFromMessage(message: string): string | null {
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : null;
}
