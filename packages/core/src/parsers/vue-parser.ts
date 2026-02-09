/**
 * Vue Parser Implementation
 *
 * Uses vue-eslint-parser to parse Vue SFC files and extract translation
 * references from both template and script sections.
 */

import path from 'path';
import { createRequire } from 'module';
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
    // For ES modules, assume vue-eslint-parser is available if installed
    // TODO: Implement proper availability checking
    return true;
  }

  parseFile(
    filePath: string,
    content: string,
    translationIdentifier: string,
    workspaceRoot?: string
  ): ParseResult {
    const references: TranslationReference[] = [];
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];

    if (!this.isAvailable(workspaceRoot)) {
      return { references, dynamicKeyWarnings };
    }

    if (!this.isAvailable(workspaceRoot)) {
      console.log(`[DEBUG] VueParser not available for workspaceRoot: ${workspaceRoot}`);
      return { references, dynamicKeyWarnings };
    }

    try {
      // Lazy load vue-eslint-parser to avoid import issues when not available
      let parse: any;
      const require = createRequire(import.meta.url);
      
      if (workspaceRoot) {
        try {
          const resolved = require.resolve('vue-eslint-parser', {
            paths: [workspaceRoot, path.join(workspaceRoot, 'node_modules')],
          });
          parse = require(resolved).parse;
        } catch {
          // Fall through to default
        }
      }

      if (!parse) {
        parse = require('vue-eslint-parser').parse;
      }

      // Parse the Vue SFC
      const ast = parse(content, {
        sourceType: 'module',
        ecmaVersion: 2020,
        loc: true,
        range: true,
      });

      // Extract references from the AST
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
          // Vue template element
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
      }
    } else if (Array.isArray(node)) {
      // Handle arrays of nodes
      node.forEach(child => this.walkVueAST(child, visitor));
    }
    // Don't walk arbitrary object properties to avoid infinite recursion
  }

  private isTranslationCall(node: any, translationIdentifier: string): boolean {
    return (
      node.type === 'CallExpression' &&
      node.callee?.type === 'Identifier' &&
      (node.callee.name === translationIdentifier || 
       node.callee.name === '$' + translationIdentifier) // Handle $t in templates
    );
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