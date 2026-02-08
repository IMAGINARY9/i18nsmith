/**
 * Parser Abstraction Layer
 *
 * Provides a uniform interface for parsing different file types and extracting
 * translation references. This abstraction allows the ReferenceExtractor to
 * work with multiple parser implementations without knowing framework details.
 */

import type { TranslationReference, DynamicKeyWarning } from '../reference-extractor.js';

/**
 * Result of parsing a file for translation references.
 */
export interface ParseResult {
  /** Translation key references found in the file */
  references: TranslationReference[];
  /** Warnings about dynamic keys that couldn't be statically analyzed */
  dynamicKeyWarnings: DynamicKeyWarning[];
}

/**
 * Core parser interface that all file parsers must implement.
 * Provides a uniform API for extracting translation references from different
 * file types and frameworks.
 */
export interface Parser {
  /** Unique parser identifier (e.g., 'typescript', 'vue') */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** File extensions this parser can handle */
  readonly extensions: string[];

  /**
   * Check if this parser is available in the current environment.
   * @param workspaceRoot Optional workspace root for resolving dependencies
   * @returns true if the parser can be used
   */
  isAvailable(workspaceRoot?: string): boolean;

  /**
   * Parse a file and extract translation references.
   * @param filePath Absolute path to the file to parse
   * @param content File content as string
   * @param translationIdentifier The identifier to look for (e.g., 't', '$t')
   * @param workspaceRoot Optional workspace root for context
   * @returns Parse result with references and warnings
   */
  parseFile(
    filePath: string,
    content: string,
    translationIdentifier: string,
    workspaceRoot?: string
  ): ParseResult;
}

/**
 * Registry for managing available parsers.
 * Similar to AdapterRegistry but for parsing capabilities.
 */
export class ParserRegistry {
  private parsers = new Map<string, Parser>();

  /**
   * Register a parser in the registry.
   */
  register(parser: Parser): void {
    this.parsers.set(parser.id, parser);
  }

  /**
   * Get a parser by its unique ID.
   */
  getById(id: string): Parser | undefined {
    return this.parsers.get(id);
  }

  /**
   * Get the parser that handles a specific file path.
   * Matches by file extension, first-match wins.
   */
  getForFile(filePath: string): Parser | undefined {
    const ext = path.extname(filePath).toLowerCase();
    for (const parser of this.parsers.values()) {
      if (parser.extensions.includes(ext)) {
        return parser;
      }
    }
    return undefined;
  }

  /**
   * Get all registered parsers.
   */
  getAll(): Parser[] {
    return Array.from(this.parsers.values());
  }

  /**
   * Get parser availability status for all parsers.
   * @param workspaceRoot Optional workspace root for dependency resolution
   */
  getAvailabilityStatus(workspaceRoot?: string): Record<string, boolean> {
    const status: Record<string, boolean> = {};
    for (const parser of this.parsers.values()) {
      status[parser.id] = parser.isAvailable(workspaceRoot);
    }
    return status;
  }
}

// Re-export path for convenience
import path from 'path';