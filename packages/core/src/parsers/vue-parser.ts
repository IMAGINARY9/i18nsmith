/**
 * Vue Parser Implementation
 *
 * Uses vue-eslint-parser to parse Vue SFC files and extract translation
 * references from both template and script sections.
 */

import path from 'path';
import { isPackageResolvable, requireFromWorkspace } from '../utils/dependency-resolution.js';
import type { TranslationReference, DynamicKeyWarning } from '../reference-extractor.js';
import type { Parser, ParseResult } from './types.js';

/**
 * Parser for Vue Single File Components using vue-eslint-parser.
 */
export class VueParser implements Parser {
  readonly id = 'vue';
  readonly name = 'Vue SFC Parser';
  readonly extensions = ['.vue'];

  // Cache for parser availability to avoid repeated resolution attempts
  private availabilityCache: { workspaceRoot?: string; available: boolean } | null = null;

  isAvailable(workspaceRoot?: string): boolean {
    // Only short-circuit when we previously confirmed availability.
    // If the parser was missing, re-check so newly installed deps are detected.
    if (
      this.availabilityCache &&
      this.availabilityCache.workspaceRoot === workspaceRoot &&
      this.availabilityCache.available
    ) {
      return true;
    }

    let available = workspaceRoot
      ? isPackageResolvable('vue-eslint-parser', workspaceRoot)
      : false;

    // If not resolvable from the workspace, allow using the CLI/runtime copy
    // of the parser (useful in test environments and when the parser is a
    // transitive dependency of the monorepo). This mirrors the runtime
    // fallback in ReferenceExtractor.getVueEslintParser().
    if (!available) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('vue-eslint-parser');
        available = true;
      } catch {
        // leave available as false
      }
    }

    this.availabilityCache = { workspaceRoot, available };

    return available;
  }

  parseFile(
    filePath: string,
    content: string,
    translationIdentifier: string,
    workspaceRoot?: string
  ): ParseResult {
    if (process.env.DEBUG_VUE_PARSER === '1') {
      console.log(`[DEBUG] VueParser.parseFile called for ${filePath}, identifier: ${translationIdentifier}`);
    }
    const references: TranslationReference[] = [];
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];

    if (!this.isAvailable(workspaceRoot)) {
      return { references, dynamicKeyWarnings };
    }

    try {
      // Lazy load vue-eslint-parser to avoid import issues when not available
      // Prefer loading from the project's workspace first; if that fails,
      // fall back to the CLI/runtime copy of the parser (mirrors
      // ReferenceExtractor.getVueEslintParser behavior).
      let parserModule: any;
      try {
        parserModule = requireFromWorkspace('vue-eslint-parser', workspaceRoot || process.cwd());
      } catch (err) {
        // Fallback to runtime/CLI copy
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        parserModule = require('vue-eslint-parser');
      }
      const parse = parserModule.parse;

      // Parse the Vue SFC
      const parserOptions: any = {
        sourceType: 'module',
        ecmaVersion: 2020,
        loc: true,
        range: true,
      };

      // Check if @typescript-eslint/parser is available for TypeScript support in <script lang="ts">
      // If available, configure vue-eslint-parser to use it for TypeScript files
      const hasTypescriptParser = isPackageResolvable('@typescript-eslint/parser', workspaceRoot || process.cwd());
      if (hasTypescriptParser) {
        parserOptions.parser = '@typescript-eslint/parser';
      }

      let ast: any;
      try {
        if (process.env.DEBUG_VUE_PARSER === '1') {
          console.log(`[DEBUG] VueParser: Attempting to parse, hasTypescriptParser = ${hasTypescriptParser}, parser = ${parserOptions.parser}`);
          console.log(`[DEBUG] VueParser: Content first 200 chars:`, content.substring(0, 200));
        }
        ast = parse(content, parserOptions);
        if (process.env.DEBUG_VUE_PARSER === '1') {
          console.log(`[DEBUG] VueParser: Parse returned, ast type =`, typeof ast, 'ast.type =', ast?.type);
        }
      } catch (parseError) {
        if (process.env.DEBUG_VUE_PARSER === '1') {
          // Debug-only: surface parse error when debugging parser behavior
          // eslint-disable-next-line no-console
          console.log(`[DEBUG] VueParser: Initial parse failed:`, parseError);
        }
        // If parsing failed (likely due to TypeScript syntax without TS parser),
        // try parsing with parser: false which only parses the template
        try {
          if (process.env.DEBUG_VUE_PARSER === '1') console.log(`[DEBUG] VueParser: Trying fallback with parser: false`);
          ast = parse(content, {
            ...parserOptions,
            parser: false, // Skip script parsing, only parse template
          });
          if (process.env.DEBUG_VUE_PARSER === '1') console.log(`[DEBUG] VueParser: Fallback parse succeeded, ast.type = ${ast?.type}`);
        } catch (fallbackError) {
          if (process.env.DEBUG_VUE_PARSER === '1') {
            // Debug-only: surface fallback parse error
            // eslint-disable-next-line no-console
            console.log(`[DEBUG] VueParser: Fallback parse also failed:`, fallbackError);
          }
          throw parseError; // Rethrow original error
        }
      }

      // Extract references from the AST
      if (process.env.DEBUG_VUE_PARSER === '1') console.log(`[DEBUG] VueParser: ast.type = ${ast.type}, has templateBody = ${!!ast.templateBody}`);
      this.extractReferencesFromVueAST(
        filePath,
        ast,
        translationIdentifier,
        references,
        dynamicKeyWarnings,
        workspaceRoot
      );

    } catch (error) {
      // If parsing fails, return empty results rather than throwing
      // This allows the system to continue with other files
      console.warn(`Failed to parse Vue file ${filePath}:`, error);
    }
    
    if (process.env.DEBUG_VUE_PARSER === '1') console.log(`[DEBUG] VueParser found ${references.length} references in ${filePath}`);
    return { references, dynamicKeyWarnings };
  }

  private extractReferencesFromVueAST(
    filePath: string,
    ast: any,
    translationIdentifier: string,
    references: TranslationReference[],
    dynamicKeyWarnings: DynamicKeyWarning[],
    workspaceRoot?: string
  ): void {
    // Walk the script AST (JavaScript/TypeScript code)
    this.walkVueAST(ast, (node: any) => {
      if (this.isTranslationCall(node, translationIdentifier)) {
        const result = this.extractKeyFromVueCall(node);
        if (result) {
          if (result.kind === 'literal') {
            references.push(this.createReference(filePath, node, result.key, workspaceRoot));
          } else if (result.kind === 'dynamic') {
            dynamicKeyWarnings.push(this.createDynamicWarning(filePath, node, result.reason, workspaceRoot));
          }
        }
      }
    });

    // Walk the template AST if it exists
    if (ast.templateBody) {
      this.walkVueAST(ast.templateBody, (node: any) => {
        if (this.isTranslationCall(node, translationIdentifier)) {
          const result = this.extractKeyFromVueCall(node);
          if (result) {
            if (result.kind === 'literal') {
              references.push(this.createReference(filePath, node, result.key, workspaceRoot));
            } else if (result.kind === 'dynamic') {
              dynamicKeyWarnings.push(this.createDynamicWarning(filePath, node, result.reason, workspaceRoot));
            }
          }
        }
      });
    }
  }

  private walkVueAST(node: any, visitor: (node: any) => void): void {
    if (!node || typeof node !== 'object') return;

    visitor(node);

    // Walk child nodes based on AST node type
    if (node.type) {
      // For different AST node types, walk their specific child properties
      switch (node.type) {
        case 'Program':
          if (node.body && Array.isArray(node.body)) {
            node.body.forEach((child: any) => this.walkVueAST(child, visitor));
          }
          break;
        case 'ExpressionStatement':
          if (node.expression) {
            this.walkVueAST(node.expression, visitor);
          }
          break;
        case 'CallExpression':
          if (node.callee) {
            this.walkVueAST(node.callee, visitor);
          }
          if (node.arguments && Array.isArray(node.arguments)) {
            node.arguments.forEach((arg: any) => this.walkVueAST(arg, visitor));
          }
          break;
        case 'MemberExpression':
          if (node.object) {
            this.walkVueAST(node.object, visitor);
          }
          if (node.property) {
            this.walkVueAST(node.property, visitor);
          }
          break;
        case 'Identifier':
          // Leaf node, no children
          break;
        case 'Literal':
          // Leaf node, no children
          break;
        case 'BinaryExpression':
          if (node.left) {
            this.walkVueAST(node.left, visitor);
          }
          if (node.right) {
            this.walkVueAST(node.right, visitor);
          }
          break;
        case 'FunctionDeclaration':
          if (node.body && node.body.body && Array.isArray(node.body.body)) {
            node.body.body.forEach((stmt: any) => this.walkVueAST(stmt, visitor));
          }
          break;
        case 'VElement':
          // Vue template element — walk both bound-attribute expressions
          // (e.g. :placeholder="$t(...)") and child nodes.
          if (node.startTag && Array.isArray(node.startTag.attributes)) {
            node.startTag.attributes.forEach((attr: any) => {
              // Only directive attributes carry a VExpressionContainer value
              if (attr.directive && attr.value && attr.value.type === 'VExpressionContainer') {
                this.walkVueAST(attr.value, visitor);
              }
            });
          }
          if (node.children && Array.isArray(node.children)) {
            node.children.forEach((child: any) => this.walkVueAST(child, visitor));
          }
          break;
        case 'VText':
          // Vue text node - no children
          break;
        case 'VExpressionContainer':
          // Vue expression container like {{ ... }}
          if (node.expression) {
            this.walkVueAST(node.expression, visitor);
          }
          break;
        case 'ObjectExpression':
          // Walk object properties so nested expressions (e.g. $t(...) inside
          // an object literal passed as an argument) are visited.
          if (node.properties && Array.isArray(node.properties)) {
            node.properties.forEach((p: any) => this.walkVueAST(p, visitor));
          }
          break;
        case 'Property':
          // Property nodes have key and value
          if (node.key) this.walkVueAST(node.key, visitor);
          if (node.value) this.walkVueAST(node.value, visitor);
          break;
        case 'ArrayExpression':
          if (node.elements && Array.isArray(node.elements)) {
            node.elements.forEach((el: any) => this.walkVueAST(el, visitor));
          }
          break;
        case 'TemplateLiteral':
          if (node.quasis && Array.isArray(node.quasis)) node.quasis.forEach((q: any) => this.walkVueAST(q, visitor));
          if (node.expressions && Array.isArray(node.expressions)) node.expressions.forEach((e: any) => this.walkVueAST(e, visitor));
          break;
        case 'ConditionalExpression':
          if (node.test) this.walkVueAST(node.test, visitor);
          if (node.consequent) this.walkVueAST(node.consequent, visitor);
          if (node.alternate) this.walkVueAST(node.alternate, visitor);
          break;
      }
    } else if (Array.isArray(node)) {
      // Handle arrays of nodes
      node.forEach(child => this.walkVueAST(child, visitor));
    }
    // Don't walk arbitrary object properties to avoid infinite recursion
  }

  private isTranslationCall(node: any, translationIdentifier: string): boolean {
    if (node.type !== 'CallExpression') {
      return false;
    }

    // Check for direct identifier calls: t(...) or $t(...)
    if (node.callee?.type === 'Identifier') {
      const calleeName = node.callee.name;
      // Support both 't' and '$t' style calls
      const isMatch = calleeName === translationIdentifier || calleeName === `$${translationIdentifier}`;
      if (isMatch && process.env.DEBUG_VUE_PARSER === '1') {
        // Debug logging only when explicitly enabled
        // eslint-disable-next-line no-console
        console.log(`[DEBUG] VueParser: Found translation call ${calleeName}(...)`);
      }
      return isMatch;
    }

    // Check for member expression calls: i18n.t(...) or this.t(...)
    if (node.callee?.type === 'MemberExpression') {
      const propertyName = node.callee.property?.name;
      return propertyName === translationIdentifier;
    }

    return false;
  }

  private extractKeyFromVueCall(node: any):
    | { kind: 'literal'; key: string }
    | { kind: 'dynamic'; reason: import('../reference-extractor.js').DynamicKeyReason }
    | undefined {
    const [arg] = node.arguments || [];
    if (!arg) return undefined;

    if (arg.type === 'Literal' && typeof arg.value === 'string') {
      return { kind: 'literal', key: arg.value };
    }

    if (arg.type === 'TemplateLiteral' && arg.quasis?.length === 1) {
      // Simple template literal with no expressions
      return { kind: 'literal', key: arg.quasis[0].value.cooked };
    }

    if (arg.type === 'TemplateLiteral') {
      return { kind: 'dynamic', reason: 'template' };
    }

    if (arg.type === 'BinaryExpression') {
      return { kind: 'dynamic', reason: 'binary' };
    }

    return { kind: 'dynamic', reason: 'expression' };
  }

  private createReference(filePath: string, node: any, key: string, workspaceRoot?: string): TranslationReference {
    // Convert ESTree location to our format
    const position = {
      line: node.loc?.start?.line ?? 1,
      column: node.loc?.start?.column ?? 0,
    };

    const relativePath = workspaceRoot ? path.relative(workspaceRoot, filePath) : path.basename(filePath);

    return {
      key,
      filePath: relativePath,
      position,
    };
  }

  private createDynamicWarning(
    filePath: string,
    node: any,
    reason: import('../reference-extractor.js').DynamicKeyReason,
    workspaceRoot?: string
  ): DynamicKeyWarning {
    const position = {
      line: node.loc?.start?.line ?? 1,
      column: node.loc?.start?.column ?? 0,
    };

    const relativePath = workspaceRoot ? path.relative(workspaceRoot, filePath) : path.basename(filePath);

    return {
      filePath: relativePath,
      position,
      expression: node.callee?.name + '()',
      reason,
    };
  }
}