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
import { shouldExtractText, generateKey, hashText, compilePatterns, type TextFilterConfig, decodeHtmlEntities } from './utils/text-filters.js';

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
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });

    if (!sourceFile) {
      return candidates;
    }

    this.activeSkipLog = [];
    this.lastSkipped = [];

    // Scan JSX elements and their attributes
    this.scanJsxElements(sourceFile, candidates, filePath);

    // Scan JSX text content
    this.scanJsxText(sourceFile, candidates, filePath);
    this.scanJsxExpressions(sourceFile, candidates, filePath);

    // Scan translation call expressions if enabled
    if (options?.scanCalls) {
      this.scanCallExpressions(sourceFile, candidates, filePath);
    }

    return candidates;
  }

  mutate(
    filePath: string,
    content: string,
    candidates: TransformCandidate[],
    options: AdapterMutateOptions
  ): MutationResult {
  const project = createScannerProject();
  const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });

    if (!sourceFile) {
      return { didMutate: false, content, edits: [] };
    }

    const edits: Array<{ start: number; end: number; replacement: string }> = [];
    let didMutate = false;

    for (const candidate of candidates) {
      if (candidate.kind === 'call-expression') {
        // For renaming existing calls, find and replace the key
        const oldCall = `t('${candidate.text}')`;
        const newCall = `t('${candidate.suggestedKey}')`;
        const index = content.indexOf(oldCall);
        
        if (index !== -1) {
          edits.push({
            start: index,
            end: index + oldCall.length,
            replacement: newCall,
          });
          didMutate = true;
        }
      } else {
        // For transforming hardcoded text, replace the entire node with a translation call
        const node = this.findNodeByPosition(sourceFile, candidate);
        if (node) {
          let keyCall: string;
          if (candidate.kind === 'jsx-text' || candidate.kind === 'jsx-attribute') {
            // JSX text and attributes need curly braces for JavaScript expressions
            keyCall = `{t('${candidate.suggestedKey}')}`;
          } else {
            // jsx-expression and other contexts might not need braces
            keyCall = `t('${candidate.suggestedKey}')`;
          }
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
    }

    let mutatedContent = didMutate ? this.applyEdits(content, edits) : content;

    // If we made mutations, ensure the file has the necessary imports and hooks
    if (didMutate) {
      mutatedContent = this.ensureTranslationImportsAndHooks(mutatedContent, options);
    }

    return {
      didMutate,
      content: mutatedContent,
      edits,
    };
  }

  private ensureTranslationImportsAndHooks(content: string, options: AdapterMutateOptions): string {
    const translationAdapter = options.translationAdapter || { module: 'react-i18next', hookName: 'useTranslation' };
    const module = translationAdapter.module || 'react-i18next';
    const hookName = translationAdapter.hookName || 'useTranslation';

    // Check if import already exists
    const importRegex = new RegExp(`import\\s+{[^}]*${hookName}[^}]*}\\s+from\\s+['"]${module}['"]`, 'm');
    const hasImport = importRegex.test(content);

    // Check if hook is already used
    const hookRegex = new RegExp(`${hookName}\\(\\)`, 'm');
    const hasHook = hookRegex.test(content);

    let updatedContent = content;

    // Add import and hook if missing
    if (!hasImport) {
      // Find insertion point after any directives (like 'use client')
      const lines = content.split('\n');
      let insertIndex = 0;
      
      // Skip directive lines at the beginning
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("'use ") || line.startsWith('"use ') || line.startsWith('use ')) {
          insertIndex = i + 1;
        } else if (line === '' || line.startsWith('//') || line.startsWith('/*')) {
          // Skip empty lines and comments
          continue;
        } else {
          // Found first non-directive, non-comment, non-empty line
          break;
        }
      }
      
      // Insert import and hook at the correct position
      const before = lines.slice(0, insertIndex).join('\n');
      const after = lines.slice(insertIndex).join('\n');
      const importAndHook = `import { ${hookName} } from '${module}';\n\nconst { t } = ${hookName}();`;
      
      updatedContent = before + (before ? '\n' : '') + importAndHook + (after ? '\n\n' : '') + after;
    } else if (!hasHook && /t\(['"`]/.test(content)) {
      // Add hook after existing imports
      const importMatches = updatedContent.match(/^import\s+.*$/gm);
      const insertPos = importMatches ? updatedContent.lastIndexOf(importMatches[importMatches.length - 1]) + importMatches[importMatches.length - 1].length : 0;
      const before = updatedContent.slice(0, insertPos);
      const after = updatedContent.slice(insertPos);
      updatedContent = before + '\n\nconst { t } = ' + hookName + '();\n' + after;
    }

    return updatedContent;
  }

  private scanJsxElements(sourceFile: SourceFile, candidates: ScanCandidate[], filePath: string): void {
    // Handle regular JSX elements
    const jsxElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement);
    for (const element of jsxElements) {
      const openingElement = element.getOpeningElement();
      
      // Check if this element has directive attributes
      const { shouldSkip, shouldForce } = this.getElementDirectives(openingElement);
      
      // Check if this JSX is in a non-component callback
      const skipReason = shouldSkip ? 'directive_skip' : (this.isInNonComponentCallback(element) ? 'directive_skip' : undefined);
      
      for (const attr of openingElement.getAttributes()) {
        if (Node.isJsxAttribute(attr)) {
          this.processJsxAttribute(attr, candidates, filePath, skipReason, shouldForce);
        }
      }
    }

    // Handle self-closing JSX elements
    const jsxSelfClosingElements = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
    for (const element of jsxSelfClosingElements) {
      // Check if this element has directive attributes
      const { shouldSkip, shouldForce } = this.getElementDirectives(element);
      
      // Check if this JSX is in a non-component callback
      const skipReason = shouldSkip ? 'directive_skip' : (this.isInNonComponentCallback(element) ? 'directive_skip' : undefined);
      
      for (const attr of element.getAttributes()) {
        if (Node.isJsxAttribute(attr)) {
          this.processJsxAttribute(attr, candidates, filePath, skipReason, shouldForce);
        }
      }
    }
  }

  private getElementDirectives(element: Node): { shouldSkip: boolean; shouldForce: boolean } {
    let shouldSkip = false;
    let shouldForce = false;
    
    if (Node.isJsxElement(element)) {
      const attributes = element.getOpeningElement().getAttributes();
      for (const attr of attributes) {
        if (Node.isJsxAttribute(attr)) {
          const attrName = attr.getNameNode().getText();
          if (attrName === 'data-i18n-skip') {
            shouldSkip = true;
          } else if (attrName === 'data-i18n-force-extract') {
            shouldForce = true;
          }
        }
      }
    } else if (Node.isJsxSelfClosingElement(element)) {
      const attributes = element.getAttributes();
      for (const attr of attributes) {
        if (Node.isJsxAttribute(attr)) {
          const attrName = attr.getNameNode().getText();
          if (attrName === 'data-i18n-skip') {
            shouldSkip = true;
          } else if (attrName === 'data-i18n-force-extract') {
            shouldForce = true;
          }
        }
      }
    }
    
    return { shouldSkip, shouldForce };
  }

  private scanJsxText(sourceFile: SourceFile, candidates: ScanCandidate[], filePath: string): void {
    const jsxTexts = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText);

    for (const jsxText of jsxTexts) {
      // Check if parent element has directive attributes
      const parent = jsxText.getParent();
      let skipReason: SkipReason | undefined;
      let force = false;
      
      if (parent && (Node.isJsxElement(parent) || Node.isJsxSelfClosingElement(parent))) {
        const directives = this.getElementDirectives(parent);
        if (directives.shouldSkip) {
          skipReason = 'directive_skip';
        }
        if (directives.shouldForce) {
          force = true;
        }
      }

      // Check if this JSX text is in a non-component callback
      if (!skipReason && this.isInNonComponentCallback(jsxText)) {
        skipReason = 'directive_skip';
      }

      let rawText = jsxText.getLiteralText();

      // Decode HTML entities if enabled
      if (this.decodeHtmlEntities) {
        rawText = decodeHtmlEntities(rawText);
      }

      // Split by lines and process each line separately
      const lines = rawText.split('\n').map(line => line.trim()).filter(line => line.length > 0);

      for (const line of lines) {
        if (this.shouldExtractText(line) || force) {
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
            forced: force,
            skipReason,
          };

          candidates.push(candidate);
        }
      }
    }
  }

  private scanJsxExpressions(sourceFile: SourceFile, candidates: ScanCandidate[], filePath: string): void {
    const jsxExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.JsxExpression);

    for (const jsxExpr of jsxExpressions) {
      // Check if parent element has directive attributes
      const parent = jsxExpr.getParent();
      let skipReason: SkipReason | undefined;
      let force = false;

      if (parent && (Node.isJsxElement(parent) || Node.isJsxSelfClosingElement(parent))) {
        const directives = this.getElementDirectives(parent);
        if (directives.shouldSkip) {
          skipReason = 'directive_skip';
        }
        if (directives.shouldForce) {
          force = true;
        }
      }

      // Check if this JSX is in a non-component callback
      if (!skipReason && this.isInNonComponentCallback(jsxExpr)) {
        skipReason = 'directive_skip';
      }

      // Look for string literals inside the expression
      const stringLiterals = jsxExpr.getDescendantsOfKind(SyntaxKind.StringLiteral);
      for (const stringLiteral of stringLiterals) {
        // Skip string literals that are arguments to translation calls
        if (this.isInsideTranslationCall(stringLiteral)) {
          continue;
        }

        let text = stringLiteral.getLiteralText();

        // Decode HTML entities if enabled
        if (this.decodeHtmlEntities) {
          text = decodeHtmlEntities(text);
        }

        if (this.shouldExtractText(text) || force) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${stringLiteral.getStart()}`,
            kind: 'jsx-expression' as CandidateKind,
            filePath,
            text,
            position: {
              line: stringLiteral.getStartLineNumber(),
              column: stringLiteral.getStart() - stringLiteral.getStartLinePos(),
            },
            suggestedKey: this.generateKey(text),
            hash: this.hashText(text),
            forced: force,
            skipReason,
          };

          candidates.push(candidate);
        }
      }
    }
  }

  private shouldSkipJsxElement(element: Node): boolean {
    // Check for data-i18n-skip attribute
    if (Node.isJsxElement(element)) {
      const attributes = element.getOpeningElement().getAttributes();
      for (const attr of attributes) {
        if (Node.isJsxAttribute(attr)) {
          const attrName = attr.getNameNode().getText();
          if (attrName === 'data-i18n-skip') {
            return true;
          }
        }
      }
    } else if (Node.isJsxSelfClosingElement(element)) {
      const attributes = element.getAttributes();
      for (const attr of attributes) {
        if (Node.isJsxAttribute(attr)) {
          const attrName = attr.getNameNode().getText();
          if (attrName === 'data-i18n-skip') {
            return true;
          }
        }
      }
    }
    return false;
  }
  private processJsxAttribute(attr: JsxAttribute, candidates: ScanCandidate[], filePath: string, skipReason?: SkipReason, force?: boolean): void {
    const attrNameNode = attr.getNameNode();
    const attrNameText = attrNameNode.getText();

    // Check if this attribute should be translated
    if (!this.translatableAttributes.has(attrNameText)) {
      return;
    }

    const initializer = attr.getInitializer();
    if (!initializer) return;

    if (Node.isStringLiteral(initializer)) {
      let text = initializer.getLiteralText();
      
      // Decode HTML entities if enabled
      if (this.decodeHtmlEntities) {
        text = decodeHtmlEntities(text);
      }
      
      // Convert newlines to spaces if not preserving newlines
      if (!this.preserveNewlines) {
        text = text.replace(/\n/g, ' ');
      }
      
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
          forced: force,
          skipReason,
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

  private scanCallExpressions(sourceFile: SourceFile, candidates: ScanCandidate[], filePath: string): void {
    // Find all call expressions
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const callExpr of callExpressions) {
      const expression = callExpr.getExpression();
      const args = callExpr.getArguments();

      // Check if this is a translation call
      if (this.isTranslationCall(expression) && args.length > 0) {
        const firstArg = args[0];
        
        // Check for comment directives
        const hasSkipComment = this.hasSkipComment(callExpr);
        const hasForceComment = this.hasForceComment(callExpr);
        
        if (hasSkipComment) {
          continue; // Skip this call
        }
        
        // Handle string literals
        if (Node.isStringLiteral(firstArg)) {
          let text = firstArg.getLiteralText();
          
          // Decode HTML entities if enabled
          if (this.decodeHtmlEntities) {
            text = decodeHtmlEntities(text);
          }
          
          // Convert newlines to spaces if not preserving newlines
          if (!this.preserveNewlines) {
            text = text.replace(/\n/g, ' ');
          }
          
          if (this.shouldExtractText(text) || hasForceComment) {
            const candidate: ScanCandidate = {
              id: `${filePath}:${callExpr.getStart()}`,
              kind: 'call-expression' as CandidateKind,
              filePath,
              text,
              position: {
                line: callExpr.getStartLineNumber(),
                column: callExpr.getStart() - callExpr.getStartLinePos(),
              },
              suggestedKey: this.generateKey(text),
              hash: this.hashText(text),
              forced: hasForceComment,
            };

            candidates.push(candidate);
          }
        }
        // Handle template literals (no-substitution templates)
        else if (Node.isNoSubstitutionTemplateLiteral(firstArg)) {
          let text = firstArg.getLiteralText();
          
          // Decode HTML entities if enabled
          if (this.decodeHtmlEntities) {
            text = decodeHtmlEntities(text);
          }
          
          // Convert newlines to spaces if not preserving newlines
          if (!this.preserveNewlines) {
            text = text.replace(/\n/g, ' ');
          }
          
          if (this.shouldExtractText(text) || hasForceComment) {
            const candidate: ScanCandidate = {
              id: `${filePath}:${callExpr.getStart()}`,
              kind: 'call-expression' as CandidateKind,
              filePath,
              text,
              position: {
                line: callExpr.getStartLineNumber(),
                column: callExpr.getStart() - callExpr.getStartLinePos(),
              },
              suggestedKey: this.generateKey(text),
              hash: this.hashText(text),
              forced: hasForceComment,
            };

            candidates.push(candidate);
          }
        }
      }
    }
  }

  private hasSkipComment(node: Node): boolean {
    return this.hasCommentDirective(node, 'i18n:skip');
  }

  private hasForceComment(node: Node): boolean {
    return this.hasCommentDirective(node, 'i18n:force-extract');
  }

  private hasCommentDirective(node: Node, directive: string): boolean {
    // Check the source file text around the node for trailing comments on the same line
    const sourceFile = node.getSourceFile();
    if (!sourceFile) return false;
    
    const fullText = sourceFile.getFullText();
    const lines = fullText.split('\n');
    const lineNumber = node.getStartLineNumber() - 1; // 0-based
    
    if (lineNumber >= 0 && lineNumber < lines.length) {
      const line = lines[lineNumber];
      // Find the node's text in the line and check what comes after
      const nodeText = node.getText();
      const nodeIndex = line.indexOf(nodeText);
      
      if (nodeIndex !== -1) {
        const afterNode = line.substring(nodeIndex + nodeText.length);
        return afterNode.includes(`// ${directive}`) || afterNode.includes(`/* ${directive} */`);
      }
    }
    
    return false;
  }

  private isTranslationCall(expression: Node): boolean {
    // Check for direct calls: t('text')
    if (Node.isIdentifier(expression)) {
      return expression.getText() === 't';
    }

    // Check for property access: props.t('text'), i18n.t('text')
    if (Node.isPropertyAccessExpression(expression)) {
      return expression.getName() === 't';
    }

    // Check for element access: props['t']('text')
    if (Node.isElementAccessExpression(expression)) {
      const argument = expression.getArgumentExpression();
      if (Node.isStringLiteral(argument)) {
        return argument.getLiteralText() === 't';
      }
    }

    return false;
  }

  private isInsideTranslationCall(node: Node): boolean {
    // Walk up the AST to see if this node is inside a translation call
    let current: Node | undefined = node.getParent();
    while (current) {
      if (Node.isCallExpression(current)) {
        if (this.isTranslationCall(current.getExpression())) {
          return true;
        }
      }
      current = current.getParent();
    }
    return false;
  }

  private isInNonComponentCallback(node: Node): boolean {
    // Check if this JSX is inside a callback that's not a React component
    // e.g., loading callbacks in dynamic imports, error boundaries, etc.
    let current: Node | undefined = node.getParent();
    while (current) {
      // Check if we're inside an object property that looks like a callback
      if (Node.isPropertyAssignment(current)) {
        const propName = current.getNameNode();
        if (Node.isIdentifier(propName)) {
          const name = propName.getText();
          // Common non-component callback patterns
          if (['loading', 'error', 'fallback', 'suspense'].includes(name)) {
            return true;
          }
        }
      }
      
      // Check if we're inside a call expression argument that might be a callback
      if (Node.isCallExpression(current)) {
        const args = current.getArguments();
        const expr = current.getExpression();
        
        // Check for dynamic imports with loading callbacks
        if (Node.isIdentifier(expr) && expr.getText() === 'dynamic') {
          // This is likely a Next.js dynamic import
          return true;
        }
      }
      
      current = current.getParent();
    }
    return false;
  }

  private findNodeByPosition(sourceFile: SourceFile, candidate: TransformCandidate): Node | null {
    // Find node matching based on the candidate's position and content
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