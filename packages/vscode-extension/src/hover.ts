import * as vscode from 'vscode';
import * as path from 'path';
import { loadConfig, LocaleStore } from '@i18nsmith/core';

/**
 * Hover provider that shows locale values when hovering over t('key') calls
 * Uses core LocaleStore for consistent key resolution and formatting
 */
export class I18nHoverProvider implements vscode.HoverProvider {
  private localeStores: Map<string, LocaleStore> = new Map();
  private localeData: Map<string, Record<string, string>> = new Map();
  private lastLoadTime: number = 0;

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    // Find if we're hovering over a t('key') or t("key") call
    const range = this.findKeyAtPosition(document, position);
    if (!range) {
      return null;
    }

    const key = document.getText(range).replace(/['"]/g, '');
    if (!key) {
      return null;
    }

    // Load locale files and build hover content
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    // Load locales asynchronously
    return this.loadLocales(workspaceFolder.uri.fsPath).then(() => {
      const markdown = this.buildHoverContent(key);
      if (!markdown) {
        return new vscode.Hover(
          new vscode.MarkdownString(`**i18nsmith**: Key \`${key}\` not found in any locale`)
        );
      }

      return new vscode.Hover(markdown, range);
    });
  }

  /**
   * Find the translation key at the given position
   */
  private findKeyAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Range | null {
    const line = document.lineAt(position.line).text;
    
    // Pattern to match t('key'), t("key"), t(`key`)
    const patterns = [
      /t\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
      /t\(\s*['"`]([^'"`]+)['"`]\s*,/g,
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const keyStart = match.index + match[0].indexOf(match[1]);
        const keyEnd = keyStart + match[1].length;
        
        if (position.character >= keyStart && position.character <= keyEnd) {
          return new vscode.Range(
            position.line,
            keyStart,
            position.line,
            keyEnd
          );
        }
      }
    }

    return null;
  }

  /**
   * Load locale files from the configured directory using core LocaleStore
   */
  private async loadLocales(workspaceRoot: string) {
    // Only reload if more than 5 seconds have passed
    if (Date.now() - this.lastLoadTime < 5000 && this.localeData.size > 0) {
      return;
    }

    this.localeData.clear();
    this.localeStores.clear();
    this.lastLoadTime = Date.now();

    try {
      const { config } = loadConfig(workspaceRoot);
      const localesDir = path.join(workspaceRoot, config.localesDir);
      
      const store = new LocaleStore(localesDir, {
        format: config.locales?.format ?? 'auto',
        delimiter: config.locales?.delimiter ?? '.',
        sortKeys: config.locales?.sortKeys ?? 'alphabetical',
      });

      // Load all locale files (source + targets)
      const allLocales = [config.sourceLanguage, ...config.targetLanguages];
      
      for (const locale of allLocales) {
        try {
          const data = await store.get(locale);
          console.log(`[hover] Loaded locale ${locale}, keys:`, Object.keys(data).slice(0, 5));
          this.localeData.set(locale, data);
          this.localeStores.set(locale, store);
        } catch (err) {
          console.error(`[hover] Failed to load locale ${locale}:`, err);
          // Locale file doesn't exist yet; skip
        }
      }
      console.log(`[hover] Total locales loaded:`, this.localeData.size);
    } catch (err) {
      console.error('[hover] Failed to load config:', err);
      // Config not found or invalid; use empty data
    }
  }

  /**
   * Build markdown content showing the key's values across locales
   */
  private buildHoverContent(key: string): vscode.MarkdownString | null {
    if (this.localeData.size === 0) {
      console.log('[hover] No locale data available');
      return null;
    }

    console.log(`[hover] Looking up key: ${key}`);
    console.log(`[hover] Available locales:`, Array.from(this.localeData.keys()));

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(`### 🌐 \`${key}\`\n\n`);
    md.appendMarkdown('| Locale | Value |\n');
    md.appendMarkdown('|--------|-------|\n');

    let foundAny = false;
    const sortedLocales = Array.from(this.localeData.keys()).sort();

    for (const locale of sortedLocales) {
      const localeData = this.localeData.get(locale)!;
      const value = localeData[key]; // LocaleStore already flattened keys
      
      console.log(`[hover] Locale ${locale}, key ${key}, value:`, value);
      
      if (value !== undefined) {
        foundAny = true;
        const displayValue = typeof value === 'string' 
          ? value.length > 50 ? value.slice(0, 50) + '...' : value
          : JSON.stringify(value);
        md.appendMarkdown(`| **${locale}** | ${this.escapeMarkdown(displayValue)} |\n`);
      } else {
        md.appendMarkdown(`| **${locale}** | ⚠️ *missing* |\n`);
      }
    }

    console.log(`[hover] Found any: ${foundAny}`);

    if (!foundAny) {
      return null;
    }

    md.appendMarkdown('\n---\n');
    md.appendMarkdown('*i18nsmith*');

    return md;
  }

  /**
   * Escape markdown special characters
   */
  private escapeMarkdown(text: string): string {
    return text
      .replace(/\|/g, '\\|')
      .replace(/\n/g, ' ')
      .replace(/\r/g, '');
  }

  /**
   * Clear the locale cache
   */
  clearCache() {
    this.localeData.clear();
    this.localeStores.clear();
    this.lastLoadTime = 0;
  }
}
