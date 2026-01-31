import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export type FrameworkType = 'react' | 'vue' | 'next' | 'nuxt' | 'svelte' | 'unknown';

export interface FrameworkInfo {
  type: FrameworkType;
  adapter: string;
  confidence: number; // 0-1, how confident we are in the detection
  features: string[]; // e.g., ['hooks', 'composables', 'directives']
}

/**
 * Service for detecting the framework used in a workspace
 */
export class FrameworkDetectionService {
  private cachedResult: FrameworkInfo | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  /**
   * Detect the framework used in the workspace
   */
  async detectFramework(workspaceRoot: string): Promise<FrameworkInfo> {
    // Check cache first
    const now = Date.now();
    if (this.cachedResult && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      return this.cachedResult;
    }

    const result = await this.performDetection(workspaceRoot);
    this.cachedResult = result;
    this.cacheTimestamp = now;
    return result;
  }

  private async performDetection(workspaceRoot: string): Promise<FrameworkInfo> {
    // Check package.json for dependencies
    const packageJsonPath = path.join(workspaceRoot, 'package.json');
    let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};

    try {
      const content = await fs.promises.readFile(packageJsonPath, 'utf8');
      packageJson = JSON.parse(content);
    } catch {
      // If no package.json, assume unknown
      return { type: 'unknown', adapter: 'custom', confidence: 0, features: [] };
    }

    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies
    };

    // Vue detection
    if (dependencies['vue']) {
      const hasVueI18n = !!dependencies['vue-i18n'];
      const hasNuxt = !!dependencies['nuxt'];

      if (hasNuxt) {
        return {
          type: 'nuxt',
          adapter: 'vue-i18n',
          confidence: 0.9,
          features: ['composables', 'auto-imports']
        };
      }

      return {
        type: 'vue',
        adapter: hasVueI18n ? 'vue-i18n' : 'custom',
        confidence: hasVueI18n ? 0.8 : 0.6,
        features: ['composables', 'directives', 'sfc']
      };
    }

    // React detection
    if (dependencies['react']) {
      const hasReactI18next = !!dependencies['react-i18next'];
      const hasNextIntl = !!dependencies['next-intl'];
      const hasLingui = !!dependencies['@lingui/react'];

      // Next.js detection
      if (dependencies['next']) {
        if (hasNextIntl) {
          return {
            type: 'next',
            adapter: 'next-intl',
            confidence: 0.9,
            features: ['app-router', 'server-components', 'hooks']
          };
        }
        return {
          type: 'next',
          adapter: hasReactI18next ? 'react-i18next' : 'custom',
          confidence: hasReactI18next ? 0.8 : 0.6,
          features: ['pages-router', 'hooks']
        };
      }

      // Regular React
      if (hasReactI18next) {
        return {
          type: 'react',
          adapter: 'react-i18next',
          confidence: 0.8,
          features: ['hooks', 'hoc']
        };
      }

      if (hasLingui) {
        return {
          type: 'react',
          adapter: '@lingui/react',
          confidence: 0.8,
          features: ['hooks', 'macros']
        };
      }

      return {
        type: 'react',
        adapter: 'custom',
        confidence: 0.5,
        features: ['hooks']
      };
    }

    // Svelte detection
    if (dependencies['svelte']) {
      const hasSvelteI18n = !!dependencies['svelte-i18n'];
      return {
        type: 'svelte',
        adapter: hasSvelteI18n ? 'svelte-i18n' : 'custom',
        confidence: hasSvelteI18n ? 0.7 : 0.5,
        features: ['stores', 'actions']
      };
    }

    // Check for Vue files as fallback
    try {
      const hasVueFiles = await this.hasVueFiles(workspaceRoot);
      if (hasVueFiles) {
        return {
          type: 'vue',
          adapter: 'custom',
          confidence: 0.4,
          features: ['sfc']
        };
      }
    } catch {
      // Ignore errors
    }

    return {
      type: 'unknown',
      adapter: 'custom',
      confidence: 0,
      features: []
    };
  }

  private async hasVueFiles(workspaceRoot: string): Promise<boolean> {
    // Simple check for .vue files in the workspace using VS Code API
    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(workspaceRoot));
      if (!workspaceFolder) {
        return false;
      }

      const vueFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, '**/*.vue'),
        null,
        1 // Just need to know if at least one exists
      );
      return vueFiles.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Clear the detection cache
   */
  clearCache(): void {
    this.cachedResult = null;
    this.cacheTimestamp = 0;
  }
}