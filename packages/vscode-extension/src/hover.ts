import * as vscode from 'vscode';
import * as path from 'path';
import { loadConfigWithMeta, LocaleStore } from '@i18nsmith/core';

/**
 * Hover provider that shows locale values when hovering over t('key') calls
 * Uses core LocaleStore for consistent key resolution and formatting
 */
export class I18nHoverProvider implements vscode.HoverProvider {
  private localeStores: Map<string, LocaleStore> = new Map();
  private localeData: Map<string, Record<string, string>> = new Map();
  private lastLoadTime: number = 0;
  private lastLoadedRoot: string | undefined;

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
    // Prefer the workspace folder that contains the hovered document so we load the correct i18n config
    const docFolder = vscode.workspace.getWorkspaceFolder(document.uri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!docFolder) {
      return null;
    }

    // Load locales asynchronously using the folder that actually contains the document
    return this.loadLocales(docFolder.uri.fsPath).then(async () => {
        console.log(`[hover] After loadLocales, localeData.size: ${this.localeData.size}`);
        console.log(`[hover] Looking up key: "${key}"`);
        if (this.localeData.size > 0) {
            const enData = this.localeData.get('en');
            console.log(`[hover] en locale keys:`, enData ? Object.keys(enData).slice(0, 10) : 'undefined');
            console.log(`[hover] Value for "${key}" in en:`, enData?.[key]);
        }
        
    let markdown = await this.buildHoverContent(key);
    if (!markdown) {
            // Fallback: try other workspace folders (multi-root scenarios) before giving up
            const folders = vscode.workspace.workspaceFolders ?? [];
            for (const f of folders) {
            if (f.uri.fsPath === docFolder.uri.fsPath) continue;
            console.log('[hover] Fallback: loading locales from other folder', f.uri.fsPath);
            // clear cache to force reload for a different root
            this.clearCache();
            // eslint-disable-next-line no-await-in-loop
            await this.loadLocales(f.uri.fsPath);
            // eslint-disable-next-line no-await-in-loop
            markdown = await this.buildHoverContent(key);
            if (markdown) {
                break;
            }
            }
        }

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
    // Only reload if more than 5 seconds have passed and we are still in the same workspace root
    if (
      this.lastLoadedRoot === workspaceRoot &&
      Date.now() - this.lastLoadTime < 5000 &&
      this.localeData.size > 0
    ) {
      console.log('[hover] Using cached locale data for root:', workspaceRoot);
      return;
    }

    console.log('[hover] Loading locales from:', workspaceRoot);
    this.localeData.clear();
    this.localeStores.clear();
    this.lastLoadTime = Date.now();
    this.lastLoadedRoot = workspaceRoot;

    try {
      // loadConfigWithMeta lets us specify the cwd so callers can pass a directory root
      const { config } = await loadConfigWithMeta(undefined, { cwd: workspaceRoot });
      console.log('[hover] Config loaded, localesDir:', config.localesDir);
      const localesDir = path.join(workspaceRoot, config.localesDir);
      
      const store = new LocaleStore(localesDir, {
        format: config.locales?.format ?? 'auto',
        delimiter: config.locales?.delimiter ?? '.',
        sortKeys: config.locales?.sortKeys ?? 'alphabetical',
      });

      // Load all locale files (source + targets)
      const allLocales = [config.sourceLanguage, ...config.targetLanguages];
      console.log('[hover] Loading locales:', allLocales);
      
      for (const locale of allLocales) {
        try {
          const data = await store.get(locale);
          console.log(`[hover] Loaded ${locale}:`, Object.keys(data).length, 'keys');
          this.localeData.set(locale, data);
          this.localeStores.set(locale, store);
        } catch (err) {
          console.error(`[hover] Failed to load ${locale}:`, err);
          // Locale file doesn't exist yet; skip
        }
      }
      console.log('[hover] Total locales loaded:', this.localeData.size);
    } catch (err) {
      console.error('[hover] Failed to load config:', err);
      // Config not found or invalid; use empty data
    }
  }

  /**
   * Build markdown content showing the key's values across locales
   */
  private async buildHoverContent(key: string): Promise<vscode.MarkdownString | null> {
    if (this.localeStores.size === 0) {
      return null;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(`### 🌐 \`${key}\`\n\n`);
    md.appendMarkdown('| Locale | Value |\n');
    md.appendMarkdown('|--------|-------|\n');

    let foundAny = false;
    const sortedLocales = Array.from(this.localeStores.keys()).sort();

    for (const locale of sortedLocales) {
      const store = this.localeStores.get(locale)!;
      let value: string | undefined;
      try {
        value = await store.getValue(locale, key);
      } catch (err) {
        value = undefined;
      }

      if (typeof value !== 'undefined') {
        foundAny = true;
        const displayValue = typeof value === 'string'
          ? value.length > 50 ? value.slice(0, 50) + '...' : value
          : JSON.stringify(value);
        md.appendMarkdown(`| **${locale}** | ${this.escapeMarkdown(displayValue)} |\n`);
      } else {
        md.appendMarkdown(`| **${locale}** | ⚠️ *missing* |\n`);
      }
    }

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
