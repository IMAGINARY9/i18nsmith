import path from 'path';
import type { FrameworkAdapter, AdapterDependencyCheck } from './types.js';

/**
 * Registry for framework adapters.
 *
 * Manages the available adapters and provides lookup by ID or file extension.
 * Used by Scanner and Transformer to discover adapters for specific files.
 */
export class AdapterRegistry {
  private adapters = new Map<string, FrameworkAdapter>();

  /**
   * Register an adapter in the registry.
   * @param adapter The adapter to register
   */
  register(adapter: FrameworkAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Get an adapter by its unique ID.
   * @param id The adapter ID (e.g., 'react', 'vue')
   * @returns The adapter or undefined if not found
   */
  getById(id: string): FrameworkAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Get the adapter that handles a specific file path.
   * Matches by file extension, first-match wins.
   * @param filePath The file path to check
   * @returns The matching adapter or undefined if none found
   */
  getForFile(filePath: string): FrameworkAdapter | undefined {
    const ext = path.extname(filePath).toLowerCase();
    for (const adapter of this.adapters.values()) {
      if (adapter.extensions.includes(ext)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * Get all registered adapters.
   * @returns Array of all adapters
   */
  getAll(): FrameworkAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Run preflight checks for all registered adapters.
   * Returns a map of adapter IDs to their dependency check results.
   * @returns Map of adapter ID to dependency check results
   */
  preflightCheck(): Map<string, AdapterDependencyCheck[]> {
    const results = new Map<string, AdapterDependencyCheck[]>();
    for (const adapter of this.adapters.values()) {
      results.set(adapter.id, adapter.checkDependencies());
    }
    return results;
  }
}

/**
 * Creates a default adapter registry with React and Vue adapters.
 */
export function createDefaultRegistry(config: import('../config.js').I18nConfig, workspaceRoot: string): AdapterRegistry {
  const registry = new AdapterRegistry();
  // Import here to avoid circular dependencies
  const { ReactAdapter } = require('../framework/ReactAdapter.js');
  const { VueAdapter } = require('../framework/adapters/vue.js');
  
  registry.register(new ReactAdapter(config, workspaceRoot));
  registry.register(new VueAdapter(config, workspaceRoot));
  return registry;
}