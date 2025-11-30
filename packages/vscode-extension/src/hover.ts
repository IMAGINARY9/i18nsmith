import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Hover provider that shows locale values when hovering over t('key') calls
 */
export class I18nHoverProvider implements vscode.HoverProvider {
  private localeCache: Map<string, Record<string, unknown>> = new Map();
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

    this.loadLocales(workspaceFolder.uri.fsPath);

    const markdown = this.buildHoverContent(key);
    if (!markdown) {
      return new vscode.Hover(
        new vscode.MarkdownString(`**i18nsmith**: Key \`${key}\` not found in any locale`)
      );
    }

    return new vscode.Hover(markdown, range);
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
   * Load locale files from the configured directory
   */
  private loadLocales(workspaceRoot: string) {
    // Only reload if more than 5 seconds have passed
    if (Date.now() - this.lastLoadTime < 5000 && this.localeCache.size > 0) {
      return;
    }

    this.localeCache.clear();
    this.lastLoadTime = Date.now();

    // Try to find locales directory from config
    const configPath = path.join(workspaceRoot, 'i18n.config.json');
    let localesDir = 'locales';

    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        localesDir = config.localesDir || 'locales';
      }
    } catch {
      // Use default
    }

    const localesPath = path.join(workspaceRoot, localesDir);
    
    try {
      if (!fs.existsSync(localesPath)) {
        return;
      }

      const files = fs.readdirSync(localesPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const locale = file.replace('.json', '');
          const filePath = path.join(localesPath, file);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            this.localeCache.set(locale, content);
          } catch {
            // Skip invalid JSON files
          }
        }
      }
    } catch {
      // Directory doesn't exist or isn't readable
    }
  }

  /**
   * Build markdown content showing the key's values across locales
   */
  private buildHoverContent(key: string): vscode.MarkdownString | null {
    if (this.localeCache.size === 0) {
      return null;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    md.appendMarkdown(`### 🌐 \`${key}\`\n\n`);
    md.appendMarkdown('| Locale | Value |\n');
    md.appendMarkdown('|--------|-------|\n');

    let foundAny = false;
    const sortedLocales = Array.from(this.localeCache.keys()).sort();

    for (const locale of sortedLocales) {
      const localeData = this.localeCache.get(locale)!;
      const value = this.getNestedValue(localeData, key);
      
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

    if (!foundAny) {
      return null;
    }

    md.appendMarkdown('\n---\n');
    md.appendMarkdown('*i18nsmith*');

    return md;
  }

  /**
   * Get a nested value from an object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, key: string): unknown {
    // First try direct key lookup (flat structure)
    if (key in obj) {
      return obj[key];
    }

    // Then try nested lookup
    const parts = key.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
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
    this.localeCache.clear();
    this.lastLoadTime = 0;
  }
}
