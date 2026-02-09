/**
 * TypeScript/JavaScript Parser Implementation
 *
 * Uses ts-morph to parse TypeScript/JavaScript files and extract translation
 * references. This is the default parser for .ts, .tsx, .js, .jsx files.
 */

import path from 'path';
import { CallExpression, Node, Project, SourceFile } from 'ts-morph';
import type { TranslationReference, DynamicKeyWarning } from '../reference-extractor.js';
import type { Parser, ParseResult } from './types.js';

/**
 * Parser for TypeScript and JavaScript files using ts-morph.
 */
export class TypeScriptParser implements Parser {
  readonly id = 'typescript';
  readonly name = 'TypeScript/JavaScript Parser';
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx'];

  private project: Project;

  constructor(project?: Project) {
    // Use provided project or create a minimal one
    this.project = project ?? new Project({
      skipAddingFilesFromTsConfig: true,
      compilerOptions: {
        allowJs: true,
        checkJs: false,
      },
    });
  }

  isAvailable(): boolean {
    // ts-morph is always available as it's a core dependency
    return true;
  }

  parseFile(
    filePath: string,
    content: string,
    translationIdentifier: string,
    workspaceRoot?: string
  ): ParseResult {
    console.log(`[DEBUG] TypeScriptParser.parseFile called for ${filePath}, identifier: ${translationIdentifier}`);
    const references: TranslationReference[] = [];
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];

    // Add the file to the project
    const sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });

    // Extract references from the AST
    this.extractReferencesFromFile(sourceFile, translationIdentifier, references, dynamicKeyWarnings, workspaceRoot);

    return { references, dynamicKeyWarnings };
  }

  private extractReferencesFromFile(
    file: SourceFile,
    translationIdentifier: string,
    references: TranslationReference[],
    dynamicKeyWarnings: DynamicKeyWarning[],
    workspaceRoot?: string
  ): void {
    file.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const result = this.extractKeyFromCall(node, translationIdentifier);
        if (result) {
          if (result.kind === 'literal') {
            references.push(this.createReference(file, node, result.key, workspaceRoot));
          } else if (result.kind === 'dynamic') {
            dynamicKeyWarnings.push(this.createDynamicWarning(file, node, result.reason, workspaceRoot));
          }
        }
      }
    });
  }

  private extractKeyFromCall(
    node: CallExpression,
    translationIdentifier: string
  ):
    | { kind: 'literal'; key: string }
    | { kind: 'dynamic'; reason: import('../reference-extractor.js').DynamicKeyReason }
    | undefined {
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== translationIdentifier) {
      return undefined;
    }

    const [arg] = node.getArguments();
    if (!arg) {
      return undefined;
    }

    if (Node.isStringLiteral(arg)) {
      return { kind: 'literal', key: arg.getLiteralValue() };
    }

    if (Node.isNoSubstitutionTemplateLiteral(arg)) {
      return { kind: 'literal', key: arg.getLiteralValue() };
    }

    if (Node.isTemplateExpression(arg)) {
      return { kind: 'dynamic', reason: 'template' };
    }

    if (Node.isBinaryExpression(arg)) {
      return { kind: 'dynamic', reason: 'binary' };
    }

    return { kind: 'dynamic', reason: 'expression' };
  }

  private createReference(file: SourceFile, node: CallExpression, key: string, workspaceRoot?: string): TranslationReference {
    const position = file.getLineAndColumnAtPos(node.getStart());
    const filePath = workspaceRoot ? path.relative(workspaceRoot, file.getFilePath()) : file.getFilePath();
    return {
      key,
      filePath,
      position,
    };
  }

  private createDynamicWarning(
    file: SourceFile,
    node: CallExpression,
    reason: import('../reference-extractor.js').DynamicKeyReason,
    workspaceRoot?: string
  ): DynamicKeyWarning {
    const [arg] = node.getArguments();
    const position = file.getLineAndColumnAtPos((arg ?? node).getStart());
    const expression = arg ? arg.getText() : node.getText();
    const filePath = workspaceRoot ? path.relative(workspaceRoot, file.getFilePath()) : file.getFilePath();

    return {
      filePath,
      position,
      expression,
      reason,
    };
  }
}