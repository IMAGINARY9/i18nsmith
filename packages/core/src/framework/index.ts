/**
 * Framework Support Module
 *
 * Provides the core abstractions for multi-framework scanning and mutation.
 * Each framework (React, Vue, Svelte, etc.) implements the FrameworkAdapter
 * interface to provide framework-specific parsing and code transformation.
 */

// Export all types
export type {
  AdapterCapabilities,
  AdapterDependencyCheck,
  MutationEdit,
  MutationResult,
  FrameworkAdapter,
  AdapterScanOptions,
  AdapterMutateOptions,
  CandidateStatus,
  TransformCandidate,
} from './types.js';

// Export registry
export { AdapterRegistry } from './registry.js';

// Export adapters
export { ReactAdapter } from './ReactAdapter.js';
export { VueAdapter } from './adapters/vue.js';