/**
 * Parser Module Exports
 *
 * Provides the parser abstraction layer and default implementations.
 */

export * from './types.js';
export * from './typescript-parser.js';
export * from './vue-parser.js';

import type { Project } from 'ts-morph';
import { ParserRegistry } from './types.js';
import { TypeScriptParser } from './typescript-parser.js';
import { VueParser } from './vue-parser.js';

/**
 * Create a default parser registry with all available parsers.
 * @param project Optional ts-morph project to share across parsers
 */
export function createDefaultParserRegistry(project?: Project): ParserRegistry {
  const registry = new ParserRegistry();

  // Register TypeScript parser (always available)
  registry.register(new TypeScriptParser(project));

  // Register Vue parser (availability checked at runtime)
  registry.register(new VueParser());

  return registry;
}