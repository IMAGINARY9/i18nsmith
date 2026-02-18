import { Node, JsxAttribute, JsxElement, JsxText, SourceFile, SyntaxKind } from 'ts-morph';
import type { I18nConfig } from '../config.js';
import { createScannerProject } from '../project-factory.js';
import type { ScanCandidate, CandidateKind, SkipReason, SkippedCandidate } from '../scanner.js';
import { DEFAULT_TRANSLATABLE_ATTRIBUTES } from '../scanner.js';
import type { FrameworkAdapter, TransformCandidate, MutationResult, AdapterScanOptions, AdapterMutateOptions } from './types.js';
import { shouldExtractText, generateKey, hashText, compilePatterns, type TextFilterConfig, decodeHtmlEntities, extractTranslatablePrefix } from './utils/text-filters.js';
import { analyzeJsxExpression, ExpressionType } from './utils/expression-analyzer.js';
import { analyzeAdjacentContent, AdjacentStrategy } from './utils/adjacent-text-handler.js';
import { mergeStringConcatenation, MergeStrategy } from './utils/string-concat-merger.js';
import { handleTemplateLiteral } from './utils/template-literal-handler.js';
import { planEdits as planConflictEdits, validateEditPlan } from './utils/edit-conflict-detector.js';

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
  // Track JSX elements that have been handled as combined adjacent-content
  private handledAdjacentElements: Set<number> = new Set();

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
    // Reset per-scan state for adjacent-element handling
    this.handledAdjacentElements.clear();

    // Scan JSX elements and their attributes
    this.scanJsxElements(sourceFile, candidates, filePath);

    // Scan JSX text content
    this.scanJsxText(sourceFile, candidates, filePath);
    this.scanJsxExpressions(sourceFile, candidates, filePath);

    // Scan translation call expressions if enabled
    if (options?.scanCalls) {
      this.scanCallExpressions(sourceFile, candidates, filePath, options);
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
        // For renaming existing translation call arguments we must perform
        // an AST-aware replacement of the first argument so we preserve
        // surrounding formatting, additional arguments and quoting style.
        const node = this.findNodeByPosition(sourceFile, candidate);
        let literalNode: Node | null = node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) ? node : null;

        // Fallback: try to locate a string/template literal at the same position
        if (!literalNode) {
          const literalsAtPos = sourceFile.getDescendants()
            .filter((n) => (Node.isStringLiteral(n) || Node.isNoSubstitutionTemplateLiteral(n)) &&
                           n.getStartLineNumber() === candidate.position.line &&
                           (n.getStart() - n.getStartLinePos()) === candidate.position.column);
          if (literalsAtPos.length > 0) literalNode = literalsAtPos[0];
        }

        if (literalNode) {
          // Preserve original quoting (single, double, or template) when
          // replacing the literal.
          const originalText = literalNode.getText();
          const quote = originalText[0] || '\'';
          let replacementLiteral: string;
          if (quote === '`') {
            replacementLiteral = `\`${candidate.suggestedKey}\``;
          } else if (quote === '"') {
            replacementLiteral = `"${candidate.suggestedKey}"`;
          } else {
            replacementLiteral = `'${candidate.suggestedKey}'`;
          }

          edits.push({ start: literalNode.getStart(), end: literalNode.getEnd(), replacement: replacementLiteral });
          didMutate = true;
        }
      } else {
        // For transforming hardcoded text, replace the entire node with a translation call
        const node = this.findNodeByPosition(sourceFile, candidate);
        if (node) {
          let keyCall: string;
          
          // Check if candidate has interpolation parameters
          const hasInterpolation = candidate.interpolation && 
                                   candidate.interpolation.variables && 
                                   candidate.interpolation.variables.length > 0;
          
          if (hasInterpolation) {
            // Build params object for t() call
            const params = candidate.interpolation!.variables!
              .map(v => v.name === v.expression ? v.name : `${v.name}: ${v.expression}`)
              .join(', ');
            
            if (candidate.kind === 'jsx-text' || candidate.kind === 'jsx-attribute' || candidate.kind === 'jsx-expression') {
              keyCall = `{t('${candidate.suggestedKey}', { ${params} })}`;
            } else {
              keyCall = `t('${candidate.suggestedKey}', { ${params} })`;
            }
          } else {
            // Simple translation without parameters
            if (candidate.kind === 'jsx-text' || candidate.kind === 'jsx-attribute' || candidate.kind === 'jsx-expression') {
              keyCall = `{t('${candidate.suggestedKey}')}`;
            } else {
              keyCall = `t('${candidate.suggestedKey}')`;
            }
          }
          
          let start = node.getStart();
          let end = node.getEnd();
          let replacement = keyCall;

          // For jsx-text nodes we need special handling:
          // 1. Preserve trailing whitespace that was stripped during extraction
          // 2. Preserve any suffix that was stripped (e.g. "(" from "Items (")
          // 3. Preserve non-translatable suffix (e.g. SQL code after a prefix)
          if (candidate.kind === 'jsx-text' && Node.isJsxText(node)) {
            const rawNodeText = (node as JsxText).getLiteralText();
            const rawTrimmed = rawNodeText.trim();
            const extractedText = candidate.text;

            // Check if the raw node text has trailing whitespace that should be preserved
            // as a space between {t(...)} and the next sibling expression
            const hasTrailingSpace = rawNodeText !== rawNodeText.trimEnd();

            // Check if we only extracted a prefix (e.g. "SQL-like:" from "SQL-like: WHERE ...")
            // In that case we need to keep the suffix as plain text in the output
            const suffixAfterExtracted = rawTrimmed.length > extractedText.length
              ? rawTrimmed.slice(extractedText.length)
              : '';

            // Build the replacement: {t('key')} + any suffix + trailing space
            let suffix = '';
            if (suffixAfterExtracted) {
              // Keep the non-translatable suffix as plain text JSX
              suffix += suffixAfterExtracted;
            }
            if (hasTrailingSpace && !suffix.startsWith(' ') && !suffixAfterExtracted) {
              suffix += ' ';
            }
            replacement = keyCall + suffix;
          }

          // For jsx-expression candidates that target a JsxElement (combined adjacent content):
          // Replace the element's INNER content (between > and </tag>), keeping the wrapper.
          if (candidate.kind === 'jsx-expression' && Node.isJsxElement(node)) {
            const openingElement = node.getOpeningElement();
            const closingElement = node.getClosingElement();
            // Inner content runs from end of opening tag to start of closing tag
            start = openingElement.getEnd();
            end = closingElement.getStart();
            // Remove outer braces from keyCall since we're inside a JSX element
            replacement = keyCall;
          }

          // Replace the node (or inner content) with the translation call
          edits.push({
            start,
            end,
            replacement,
          });

          didMutate = true;
        }
      }
    }

    let mutatedContent = content;
    if (didMutate) {
      const planned = planConflictEdits(
        edits.map((edit, index) => ({
          id: `${filePath}:${index}:${edit.start}-${edit.end}`,
          range: { start: edit.start, end: edit.end },
          replacement: edit.replacement,
          priority: 0,
        })),
        { autoResolveContainment: true }
      );

      const validation = validateEditPlan(planned, content.length);
      if (!validation.isValid) {
        return { didMutate: false, content, edits: [] };
      }

      const plannedSimpleEdits = planned.map((edit) => ({
        start: edit.range.start,
        end: edit.range.end,
        replacement: edit.replacement,
      }));

      mutatedContent = this.applyEdits(content, plannedSimpleEdits);
    }

    const mode = options.mode ?? 'transform';

    // If we made mutations, ensure the file has the necessary imports and hooks
    if (didMutate && mode !== 'rename') {
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

      // If this element contains a mix of text + expression children treat it
      // as an adjacent-content candidate (prefer a single interpolated string)
      const jsxChildren = element.getJsxChildren();
      const hasTextChild = jsxChildren.some(c => Node.isJsxText(c));
      const hasExprChild = jsxChildren.some(c => Node.isJsxExpression(c));

      if (hasTextChild && hasExprChild) {
        const adj = analyzeAdjacentContent(element as JsxElement, { strategy: AdjacentStrategy.Interpolate, format: 'i18next', translationFn: 't', keyGenerator: (t: string) => this.generateKey(t) });

        // Only emit a combined/interpolated candidate when the analysis
        // strongly indicates interpolation is desirable (e.g. multiple
        // dynamic expressions). For simple "text + single variable" cases
        // prefer leaving separate jsx-text / jsx-expression candidates so
        // callers can extract the static label independently.
        const shouldEmitCombined = adj.hasAdjacentPattern && adj.canInterpolate && adj.suggestedStrategy === AdjacentStrategy.Interpolate && (adj.expressions.length > 1 || (adj.interpolationTemplate && adj.staticText && adj.staticText.length === 0));

        if (shouldEmitCombined && (adj.interpolationTemplate || adj.staticText)) {
          const text = adj.interpolationTemplate || adj.staticText;
          // Prefer the static-only derived key (adj.suggestedKey) when available
          // so we don't accidentally generate a key from a merged/interpolation
          // string that may include structural punctuation or placeholders.
          const suggestedKey = adj.suggestedKey || (adj.staticText ? this.generateKey(adj.staticText) : this.generateKey(text));

          const candidate: ScanCandidate = {
            id: `${filePath}:${element.getStartLineNumber()}:${element.getStart()}`,
            kind: 'jsx-expression' as CandidateKind,
            filePath,
            text,
            position: {
              line: element.getStartLineNumber(),
              column: element.getStart() - element.getStartLinePos(),
            },
            suggestedKey,
            hash: this.hashText(text),
            interpolation: adj.interpolationTemplate || adj.localeValue
              ? { template: adj.interpolationTemplate || text, variables: adj.expressions.map(e => ({ name: e.name, expression: e.expression })), localeValue: adj.localeValue || adj.interpolationTemplate || text }
              : undefined,
          };

          candidates.push(candidate);
          // mark element as handled so child text/expression scanners skip individual nodes
          this.handledAdjacentElements.add(element.getStart());
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
      // Skip if parent element was already handled as an adjacent-content unit
      if (parent && (Node.isJsxElement(parent) || Node.isJsxSelfClosingElement(parent))) {
        if (this.handledAdjacentElements.has(parent.getStart())) continue;
      }
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

      for (const rawLine of lines) {
        // Work on a copy so we can trim structural punctuation when needed
        let line = rawLine;

        // If the NEXT sibling is a dynamic JSX expression, trim any
        // trailing opening structural punctuation from this text fragment
        // (e.g. "Items (" -> "Items") so the extracted value doesn't
        // include punctuation that belongs to the syntax rather than the
        // human-readable label.
        const src = jsxText.getSourceFile().getFullText();
        const afterPos = jsxText.getEnd();
        const m = src.slice(afterPos).match(/^\s*(.)/s);
        const nextChar = m ? m[1] : undefined;
        if (nextChar === '{') {
          const openingPunctMatch = line.match(/[([{<]+\s*$/);
          if (openingPunctMatch) {
            line = line.slice(0, -openingPunctMatch[0].length).trimEnd();
          }
        }

        if (!line || line.length === 0) continue;

        // If the line contains an embedded code-like fragment (SQL etc.),
        // prefer the human-readable prefix for translation extraction.
        // The mutation will preserve the non-translatable suffix in the output.
        const textToCheck = extractTranslatablePrefix(line);
        if ((!textToCheck || textToCheck.trim().length === 0) && !force) continue;

        // Note: generateKey() now automatically strips structural punctuation via toKeySafeText()
        if (this.shouldExtractText(textToCheck) || force) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${jsxText.getStart()}`,
            kind: 'jsx-text' as CandidateKind,
            filePath,
            text: textToCheck,
            position: {
              line: jsxText.getStartLineNumber(),
              column: jsxText.getStart() - jsxText.getStartLinePos(),
            },
            suggestedKey: this.generateKey(textToCheck),
            hash: this.hashText(textToCheck),
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

    // Track positions that have been handled as part of larger expressions
    const handledPositions = new Set<number>();

    for (const jsxExpr of jsxExpressions) {
      const attributeParent = jsxExpr.getParentIfKind(SyntaxKind.JsxAttribute);
      const attributeName = attributeParent?.getNameNode().getText();

      if (attributeName && !this.translatableAttributes.has(attributeName)) {
        continue;
      }

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

      // Get the expression inside JSX braces
      const innerExpression = jsxExpr.getExpression();
      if (!innerExpression) {
        continue;
      }

      // Analyze the full expression to determine how to handle it
      const analysis = analyzeJsxExpression(innerExpression);

      // Handle based on expression type
      if (analysis.type === ExpressionType.NonTranslatable) {
        // Skip non-translatable patterns (JSON, SQL, format specifiers, etc.)
        continue;
      }

      if (analysis.type === ExpressionType.PureDynamic) {
        // Pure dynamic expressions can't be translated
        continue;
      }

      // Handle concatenation expressions
      if (analysis.type === ExpressionType.StaticConcatenation || analysis.type === ExpressionType.MixedConcatenation) {
        const mergeResult = mergeStringConcatenation(innerExpression);
        
        if (mergeResult.strategy === MergeStrategy.FullMerge || mergeResult.strategy === MergeStrategy.Interpolation) {
          // Mark all string literal positions as handled
          const stringLiterals = innerExpression.getDescendantsOfKind(SyntaxKind.StringLiteral);
          for (const lit of stringLiterals) {
            handledPositions.add(lit.getStart());
          }

          // Use mergedValue for full merge, interpolationTemplate for interpolation
          const text = mergeResult.strategy === MergeStrategy.FullMerge 
            ? mergeResult.mergedValue 
            : mergeResult.interpolationTemplate;
            
          if (text && (this.shouldExtractText(text, attributeName ? { attribute: attributeName } : undefined) || force)) {
            const candidate: ScanCandidate = {
              id: `${filePath}:${jsxExpr.getStart()}`,
              kind: 'jsx-expression' as CandidateKind,
              filePath,
              text,
              position: {
                line: jsxExpr.getStartLineNumber(),
                column: jsxExpr.getStart() - jsxExpr.getStartLinePos(),
              },
              // Use the merger's suggestedKey when available (it derives the key
              // from static parts) otherwise fall back to generating from the
              // final text.
              suggestedKey: mergeResult.suggestedKey || this.generateKey(text),
              hash: this.hashText(text),
              forced: force,
              skipReason,
            };

            // Add interpolation info for mixed concatenation
            if (mergeResult.strategy === MergeStrategy.Interpolation && mergeResult.variables && mergeResult.variables.length > 0) {
              candidate.interpolation = {
                template: mergeResult.interpolationTemplate || text,
                variables: mergeResult.variables.map(v => ({ name: v.name, expression: v.expression })),
                localeValue: mergeResult.interpolationTemplate || text,
              };
            }

            candidates.push(candidate);
          }
          continue;
        }
      }

      // Handle template literals
      if (analysis.type === ExpressionType.SimpleTemplateLiteral || analysis.type === ExpressionType.TemplateWithExpressions) {
        const templateResult = handleTemplateLiteral(innerExpression);
        
        if (templateResult.canTransform) {
          // Mark template literal position as handled
          const noSubNodes = innerExpression.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral);
          const templateExprNodes = innerExpression.getDescendantsOfKind(SyntaxKind.TemplateExpression);
          for (const node of [...noSubNodes, ...templateExprNodes]) {
            handledPositions.add(node.getStart());
          }

          // Use staticValue for simple templates, interpolationTemplate for complex ones
          const text = templateResult.staticValue || templateResult.interpolationTemplate;
          if (text && (this.shouldExtractText(text, attributeName ? { attribute: attributeName } : undefined) || force)) {
            const candidate: ScanCandidate = {
              id: `${filePath}:${jsxExpr.getStart()}`,
              kind: 'jsx-expression' as CandidateKind,
              filePath,
              text,
              position: {
                line: jsxExpr.getStartLineNumber(),
                column: jsxExpr.getStart() - jsxExpr.getStartLinePos(),
              },
              // Prefer the handler-provided suggestedKey (from static parts)
              // to avoid keys that include interpolation/punctuation.
              suggestedKey: templateResult.suggestedKey || this.generateKey(text),
              hash: this.hashText(text),
              forced: force,
              skipReason,
            };

            // Add interpolation info for template literals with expressions
            if (templateResult.variables && templateResult.variables.length > 0) {
              candidate.interpolation = {
                template: templateResult.interpolationTemplate || text,
                variables: templateResult.variables.map(v => ({ name: v.name, expression: v.expression })),
                localeValue: templateResult.localeValue || templateResult.interpolationTemplate || text,
              };
            }

            candidates.push(candidate);
          }
          continue;
        }
      }

      // Fall back to extracting individual string literals (legacy behavior)
      // Only for SimpleString type or if above handlers didn't process
      const stringLiterals = jsxExpr.getDescendantsOfKind(SyntaxKind.StringLiteral);
      for (const stringLiteral of stringLiterals) {
        // Skip if this position was already handled
        if (handledPositions.has(stringLiteral.getStart())) {
          continue;
        }

        if (this.isTranslationFallback(stringLiteral)) {
          continue;
        }
        // Skip string literals that are arguments to translation calls
        if (this.isInsideTranslationCall(stringLiteral)) {
          continue;
        }

        let text = stringLiteral.getLiteralText();

        // Decode HTML entities if enabled
        if (this.decodeHtmlEntities) {
          text = decodeHtmlEntities(text);
        }

        if (this.shouldExtractText(text, attributeName ? { attribute: attributeName } : undefined) || force) {
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
      
      if (this.shouldExtractText(text, { attribute: attrNameText })) {
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

  private shouldExtractText(text: string, context?: { attribute?: string }): boolean {
    const config: TextFilterConfig = {
      allowPatterns: this.allowPatterns,
      denyPatterns: this.denyPatterns,
      skipHexColors: true, // React often has color values that shouldn't be translated
      context,
    };
    return shouldExtractText(text, config).shouldExtract;
  }

  private generateKey(text: string): string {
    return generateKey(text, 'snake');
  }

  private hashText(text: string): string {
    return hashText(text);
  }

  private scanCallExpressions(sourceFile: SourceFile, candidates: ScanCandidate[], filePath: string, options?: AdapterScanOptions): void {
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
          
          if (this.shouldExtractText(text) || hasForceComment || options?.scanCalls) {
            const candidate: ScanCandidate = {
              id: `${filePath}:${firstArg.getStart()}`,
              kind: 'call-expression' as CandidateKind,
              filePath,
              text,
              position: {
                line: firstArg.getStartLineNumber(),
                column: firstArg.getStart() - firstArg.getStartLinePos(),
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
          
          if (this.shouldExtractText(text) || hasForceComment || options?.scanCalls) {
            const candidate: ScanCandidate = {
              id: `${filePath}:${firstArg.getStart()}`,
              kind: 'call-expression' as CandidateKind,
              filePath,
              text,
              position: {
                line: firstArg.getStartLineNumber(),
                column: firstArg.getStart() - firstArg.getStartLinePos(),
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

  private isTranslationFallback(literal: Node): boolean {
    const binaryExpr = literal.getParentIfKind(SyntaxKind.BinaryExpression);
    if (!binaryExpr) return false;

    const operator = binaryExpr.getOperatorToken().getText();
    if (operator !== '||' && operator !== '??') {
      return false;
    }

    if (binaryExpr.getRight() !== literal) {
      return false;
    }

    const left = binaryExpr.getLeft();
    if (!Node.isCallExpression(left)) {
      return false;
    }

    return this.isTranslationCall(left.getExpression());
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
    const matchesPosition = (node: Node) => {
      const startLine = node.getStartLineNumber();
      const startColumn = node.getStart() - node.getStartLinePos();
      return startLine === candidate.position.line && startColumn === candidate.position.column;
    };

    if (candidate.kind === 'jsx-text') {
      const jsxText = sourceFile.getDescendantsOfKind(SyntaxKind.JsxText).find(matchesPosition);
      if (jsxText) return jsxText;
    }

    if (candidate.kind === 'jsx-expression') {
      const jsxExpr = sourceFile.getDescendantsOfKind(SyntaxKind.JsxExpression).find(matchesPosition);
      if (jsxExpr) return jsxExpr;
      // Combined adjacent-content candidates target a JsxElement, not a JsxExpression
      const jsxElem = sourceFile.getDescendantsOfKind(SyntaxKind.JsxElement).find(matchesPosition);
      if (jsxElem) return jsxElem;
    }

    if (candidate.kind === 'jsx-attribute') {
      const literal = sourceFile
        .getDescendants()
        .find((node) =>
          (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) &&
          matchesPosition(node)
        );
      if (literal) return literal;
    }

    if (candidate.kind === 'call-expression') {
      const literal = sourceFile
        .getDescendants()
        .find((node) =>
          (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) &&
          matchesPosition(node)
        );
      if (literal) return literal;
    }

    // Fallback: any node matching position
    const descendants = sourceFile.getDescendants();
    for (const node of descendants) {
      if (matchesPosition(node)) {
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