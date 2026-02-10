import * as vscode from 'vscode';

/**
 * Manages cache invalidation callbacks for installed dependencies.
 * Allows adapters to register invalidation logic for specific packages,
 * ensuring that after a successful install, caches are cleared and
 * fresh state is used immediately.
 */
export class DependencyCacheManager {
  private readonly invalidators = new Map<string, (workspaceRoot: string) => void>();

  /**
   * Register an invalidation callback for a specific package.
   * @param packageName The package name (e.g., 'vue-eslint-parser')
   * @param callback Function to call when the package is installed, receives workspaceRoot
   */
  register(packageName: string, callback: (workspaceRoot: string) => void): void {
    this.invalidators.set(packageName, callback);
  }

  /**
   * Notify that packages have been installed, triggering invalidation for matching packages.
   * @param installedPackages List of package names that were installed
   * @param workspaceRoot The workspace root path
   */
  notifyInstalled(installedPackages: string[], workspaceRoot: string): void {
    for (const pkg of installedPackages) {
      const callback = this.invalidators.get(pkg);
      if (callback) {
        try {
          callback(workspaceRoot);
        } catch (error) {
          console.warn(`[DependencyCacheManager] Failed to invalidate cache for ${pkg}:`, error);
        }
      }
    }
  }
}