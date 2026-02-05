import path from 'path';
import {
  Node,
  JsxAttribute,
  JsxExpression,
  JsxText,
  SourceFile,
  SyntaxKind,
  Project,
} from 'ts-morph';
import type { I18nConfig } from '../config.js';
import { createScannerProject } from '../project-factory.js';
import type { ScanCandidate, CandidateKind, SkipReason, SkippedCandidate } from '../scanner.js';
import { DEFAULT_TRANSLATABLE_ATTRIBUTES } from '../scanner.js';
import type { FrameworkAdapter, TransformCandidate, MutationResult, AdapterScanOptions, AdapterMutateOptions } from './types.js';
import { shouldExtractText, generateKey, hashText, compilePatterns, type TextFilterConfig } from './utils/text-filters.js';

/**
 * React Framework Adapter
 *
 * Handles scanning and mutation of React/TypeScript files (.ts, .tsx, .js, .jsx).
 * Combines the functionality of the previous TypescriptParser and ReactWriter.
 */
export class ReactAdapter implements FrameworkAdapter {
  readonly id = 'react';
  readonly name = 'React';
  readonly extensions = ['.ts', '.tsx', '.js', '.jsx'];
  readonly capabilities = {
    scan: true,
    mutate: true,
    diff: true,
  };

  private config: I18nConfig;
  private workspaceRoot: string;
  private allowPatterns: RegExp[];
  private denyPatterns: RegExp[];
  private preserveNewlines: boolean;
  private decodeHtmlEntities: boolean;
  private translatableAttributes: Set<string>;
  private activeSkipLog?: SkippedCandidate[];
  private lastSkipped: SkippedCandidate[] = [];

  constructor(config: I18nConfig, workspaceRoot: string) {
    this.config = config;
    this.workspaceRoot = workspaceRoot;
    this.allowPatterns = compilePatterns(
      this.config.extraction?.allowPatterns
    );
    this.denyPatterns = compilePatterns(
      this.config.extraction?.denyPatterns
    );
    this.preserveNewlines = this.config.extraction?.preserveNewlines ?? false;
    this.decodeHtmlEntities =
      this.config.extraction?.decodeHtmlEntities ?? true;
    this.translatableAttributes = new Set(
      this.config.extraction?.translatableAttributes ?? Array.from(DEFAULT_TRANSLATABLE_ATTRIBUTES)
    );
  }

  checkDependencies(): Array<{ name: string; available: boolean; installHint: string }> {
    // React/TypeScript parsing doesn't require external dependencies beyond ts-morph
    // which is already a core dependency
    return [{ name: 'ts-morph', available: true, installHint: 'npm install ts-morph' }];
  }

  scan(filePath: string, content: string, options?: AdapterScanOptions): ScanCandidate[] {
    const candidates: ScanCandidate[] = [];
    const project = createScannerProject();
    const sourceFile = project.createSourceFile(filePath, content);

    if (!sourceFile) {
      return candidates;
    }

    this.activeSkipLog = [];
    this.lastSkipped = [];

    // Scan JSX elements and their attributes
    this.scanJsxElements(sourceFile, candidates, filePath);

    // Scan JSX text content
    this.scanJsxText(sourceFile, candidates, filePath);

    return candidates;
  }

  mutate(
    filePath: string,
    content: string,
    candidates: TransformCandidate[],
    options: AdapterMutateOptions
  ): MutationResult {
    const project = createScannerProject();
    const sourceFile = project.createSourceFile(filePath, content);

    if (!sourceFile) {
      return { didMutate: false, content, edits: [] };
    }

    const edits: Array<{ start: number; end: number; replacement: string }> = [];
    let didMutate = false;

    for (const candidate of candidates) {
      // Find the node to mutate based on position
      const node = this.findNodeByPosition(sourceFile, candidate);
      if (node) {
        const keyCall = `t('${candidate.suggestedKey}')`;
        const start = node.getStart();
        const end = node.getEnd();

        // Replace the node with the translation call
        edits.push({
          start,
          end,
          replacement: keyCall,
        });

        didMutate = true;
      }
    }

    return {
      didMutate,
      content: didMutate ? this.applyEdits(content, edits) : content,
      edits,
    };
  }

  private compilePatterns(patterns?: string[]): RegExp[] {
    if (!patterns) return [];
    return patterns.map((pattern) => new RegExp(pattern));
  }

  private scanJsxElements(sourceFile: SourceFile, candidates: ScanCandidate[], filePath: string): void {
    // Handle regular JSX elements
    const jsxElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement);
    for (const element of jsxElements) {
      const openingElement = element.getOpeningElement();
      for (const attr of openingElement.getAttributes()) {
        if (Node.isJsxAttribute(attr)) {
          this.processJsxAttribute(attr, candidates, filePath);
        }
      }
    }

    // Handle self-closing JSX elements
    const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
    for (const element of jsxSelfClosingElements) {
      for (const attr of element.getAttributes()) {
        if (Node.isJsxAttribute(attr)) {
          this.processJsxAttribute(attr, candidates, filePath);
        }
      }
    }
  }

  private scanJsxText(sourceFile: SourceFile, candidates: ScanCandidate[], filePath: string): void {
    const jsxTexts = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);

    for (const jsxText of jsxTexts) {
      const rawText = jsxText.getLiteralText();

      // Split by lines and process each line separately
      const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

      for (const line of lines) {
        if (this.shouldExtractText(line)) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${jsxText.getStart()}`,
            kind: 'jsx-text' as CandidateKind,
            filePath,
            text: line,
            position: {
              line: jsxText.getStartLineNumber(),
              column: jsxText.getStart() - jsxText.getStartLinePos(),
            },
            suggestedKey: this.generateKey(line),
            hash: this.hashText(line),
          };

          candidates.push(candidate);
        }
      }
    }
  }

  private processJsxAttribute(attr: JsxAttribute, candidates: ScanCandidate[], filePath: string): void {
    const attrNameNode = attr.getNameNode();
    const attrNameText = attrNameNode.getText();

    // Check if this attribute should be translated
    if (!this.translatableAttributes.has(attrNameText)) {
      return;
    }

    const initializer = attr.getInitializer();
    if (!initializer) return;

    if (Node.isStringLiteral(initializer)) {
      const text = initializer.getLiteralText();
      if (this.shouldExtractText(text)) {
        const candidate: ScanCandidate = {
          id: `${filePath}:${initializer.getStart()}`,
          kind: 'jsx-attribute' as CandidateKind,
          filePath,
          text,
          position: {
            line: initializer.getStartLineNumber(),
            column: initializer.getStart() - initializer.getStartLinePos(),
          },
          suggestedKey: this.generateKey(text),
          hash: this.hashText(text),
          context: attrNameText,
        };

        candidates.push(candidate);
      }
    }
  }

  private shouldExtractText(text: string): boolean {
    const config: TextFilterConfig = {
      allowPatterns: this.allowPatterns,
      denyPatterns: this.denyPatterns,
      skipHexColors: true, // React often has color values that shouldn't be translated
    };
    return shouldExtractText(text, config).shouldExtract;
  }

  private generateKey(text: string): string {
    return generateKey(text, 'snake');
  }

  private hashText(text: string): string {
    return hashText(text);
  }

  private findNodeByPosition(sourceFile: SourceFile, candidate: TransformCandidate): Node | null {
    // This is a simplified implementation - in practice you'd need more sophisticated
    // node matching based on the candidate's position and content
    const descendants = sourceFile.getDescendants();

    for (const node of descendants) {
      const startLine = node.getStartLineNumber();
      const startColumn = node.getStart() - node.getStartLinePos();

      if (startLine === candidate.position.line && startColumn === candidate.position.column) {
        return node;
      }
    }

    return null;
  }

  private applyEdits(content: string, edits: Array<{ start: number; end: number; replacement: string }>): string {
    // Sort edits by start position in reverse order to avoid offset issues
    edits.sort((a, b) => b.start - a.start);

    let result = content;
    for (const edit of edits) {
      result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
    }

    return result;
  }
}