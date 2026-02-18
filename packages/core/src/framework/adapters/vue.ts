import MagicString from 'magic-string';
import type { I18nConfig } from '../../config.js';
import type { ScanCandidate, CandidateKind, SkippedCandidate } from '../../scanner.js';
import type { FrameworkAdapter, TransformCandidate, MutationResult, AdapterScanOptions, AdapterMutateOptions } from '../types.js';
import { shouldExtractText, generateKey, hashText, compilePatterns, type TextFilterConfig, extractTranslatablePrefix } from '../utils/text-filters.js';
import { analyzeVueExpression, analyzeVueAdjacentContent, generateVueReplacement, generateVueAttributeReplacement } from '../utils/vue-expression-handler.js';
import { requireFromWorkspace, isPackageResolvable } from '../../utils/dependency-resolution.js';

const LETTER_REGEX_GLOBAL = /\p{L}/gu;
const MAX_DIRECTIVE_COMMENT_DEPTH = 4;
const HTML_ENTITY_PATTERN = /^&[a-z][a-z0-9-]*;$/i;
const REPEATED_SYMBOL_PATTERN = /^([^\p{L}\d\s])\1{1,}$/u;

/**
 * Attributes that typically contain translatable text
 */
const DEFAULT_TRANSLATABLE_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-placeholder',
  'aria-description',
  'aria-valuetext',
  'helperText',
  'helper-text',
  'label',
  'placeholder',
  'title',
  'tooltip',
  'message',
  'error-message',
  'errorMessage',
  'success-message',
  'successMessage',
  'description',
  'hint',
  'caption',
  'msg',  // Common Vue prop for messages
]);

/**
 * Attributes that should never be considered for translation
 */
const DEFAULT_NON_TRANSLATABLE_ATTRIBUTES = new Set([
  'class',
  'classname',
  'className',
  'class-name',
  'id',
  'name',
  'type',
  'for',
  'ref',
  'key',
  'href',
  'src',
  'style',
  'width',
  'height',
  'data-testid',
  'data-test',
  'data-cy',
  'role',
  'as',
  'format',
  'mode',
  'sizes',
  'loading',
  'xmlns',
  'viewbox',
  'd',
  'aria-hidden',
  'aria-checked',
  'aria-selected',
  'aria-expanded',
  'aria-current',
  'aria-controls',
  'aria-describedby',
  'aria-labelledby',
  'tabindex',
  'target',
  'rel',
  'method',
  'action',
  'encoding',
  'enctype',
  'autocomplete',
  'autofocus',
  'disabled',
  'readonly',
  'required',
  'checked',
  'selected',
  'multiple',
  'accept',
  'pattern',
  'min',
  'max',
  'step',
  'maxlength',
  'minlength',
  'cols',
  'rows',
  'size',
]);

/**
 * Vue Framework Adapter
 *
 * Handles scanning and mutation of Vue Single File Components (.vue).
 * Combines the functionality of the previous VueParser and VueWriter.
 */
export class VueAdapter implements FrameworkAdapter {
  readonly id = 'vue';
  readonly name = 'Vue SFC';
  readonly extensions = ['.vue'];
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
  private nonTranslatableAttributes: Set<string>;
  private attributeSuffixes: string[];
  private activeSkipLog?: SkippedCandidate[];
  private seenCandidateIds: Set<string> = new Set();
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
    const extraTranslatable = this.config.extraction?.translatableAttributes ?? [];
    const extraNonTranslatable = this.config.extraction?.nonTranslatableAttributes ?? [];
    const suffixes = this.config.extraction?.attributeSuffixes;
    this.translatableAttributes = new Set([
      ...DEFAULT_TRANSLATABLE_ATTRIBUTES,
      ...extraTranslatable.map((item) => item.toLowerCase()),
    ]);
    this.nonTranslatableAttributes = new Set([
      ...DEFAULT_NON_TRANSLATABLE_ATTRIBUTES,
      ...extraNonTranslatable.map((item) => item.toLowerCase()),
    ]);
    this.attributeSuffixes = (suffixes && suffixes.length)
      ? suffixes.map((item) => item.toLowerCase())
      : ['label', 'text', 'title', 'message', 'description', 'hint', 'placeholder'];
  }

  checkDependencies(): Array<{ name: string; available: boolean; installHint: string }> {
    // Check if vue-eslint-parser is available (resolve from workspace root first)
    const available = isPackageResolvable('vue-eslint-parser', this.workspaceRoot);

    const deps: Array<{ name: string; available: boolean; installHint: string }> = [{
      name: 'vue-eslint-parser',
      available,
      installHint: 'npm install --save-dev vue-eslint-parser'
    }];

    // Check if vue-i18n is configured (optional but recommended check)
    // This verifies the project has i18n integration so $t() calls will work at runtime
    const i18nModuleName = this.config.translationAdapter?.module ?? 'vue-i18n';
    const hasI18n = isPackageResolvable(i18nModuleName, this.workspaceRoot);
    
    if (!hasI18n) {
      deps.push({
        name: i18nModuleName,
        available: false,
        installHint: `npm install ${i18nModuleName}`
      });
    }

    return deps;
  }



  scan(filePath: string, content: string, options?: AdapterScanOptions): ScanCandidate[] {
    const candidates: ScanCandidate[] = [];
    this.activeSkipLog = [];
    this.seenCandidateIds.clear();

    const scanCalls = options?.scanCalls ?? false;

    try {
      const vueEslintParser = this.getVueEslintParser();
      if (!vueEslintParser) {
        // Fallback: no parser available - use a minimal text-based extraction
        this.extractFromContent(content, filePath, candidates, scanCalls);
        this.lastSkipped = this.activeSkipLog ?? [];
        this.activeSkipLog = undefined;
        return candidates;
      }

      let ast: any;
      let parseError: unknown;
      try {
        ast = vueEslintParser.parse(content, {
          sourceType: 'module',
          ecmaVersion: 2020,
          sourceFile: filePath,
        });
      } catch (error) {
        parseError = error;
        // Full parse failed — likely because <script lang="ts"> uses TypeScript
        // syntax that espree can't handle. Retry with `parser: false` which
        // tells vue-eslint-parser to parse only the <template> and skip <script>.
        // This still gives us a correct template AST for text extraction.
        try {
          ast = vueEslintParser.parse(content, {
            sourceType: 'module',
            ecmaVersion: 2020,
            sourceFile: filePath,
            parser: false,
          });
        } catch (errorWithTemplateOnly) {
          parseError = errorWithTemplateOnly;
          // Even template-only parsing failed — fall back to regex extraction
          ast = null;
        }
      }

      if (!ast) {
        this.reportTemplateParseFailure(filePath, content, parseError);
        this.extractFromContent(content, filePath, candidates, scanCalls);
        this.lastSkipped = this.activeSkipLog ?? [];
        this.activeSkipLog = undefined;
        return candidates;
      }

      // If both templateBody and body are null/missing, fall back to regex extraction
      if (!ast.templateBody && !ast.body) {
        this.extractFromContent(content, filePath, candidates, scanCalls);
        this.lastSkipped = this.activeSkipLog ?? [];
        this.activeSkipLog = undefined;
        return candidates;
      }

      // Extract candidates from template
      if (ast.templateBody) {
        this.extractFromTemplate(ast.templateBody, content, filePath, candidates, scanCalls);
      }

      // Extract candidates from script body (only available when full parse succeeded)
      if (ast.body) {
        this.extractFromScript(ast.body, content, filePath, candidates, scanCalls);
      }

      this.lastSkipped = this.activeSkipLog ?? [];
      this.activeSkipLog = undefined;
      return candidates;
    } catch (error) {
      // Unexpected error — fall back to content-based extraction
      this.extractFromContent(content, filePath, candidates, scanCalls);
      this.lastSkipped = this.activeSkipLog ?? [];
      this.activeSkipLog = undefined;
      return candidates;
    }
  }

  mutate(
    filePath: string,
    content: string,
    candidates: TransformCandidate[],
    options: AdapterMutateOptions
  ): MutationResult {
    const magicString = new MagicString(content);
    let didMutate = false;

    // Sort candidates by position in reverse order to avoid offset issues
    const sortedCandidates = [...candidates].sort((a, b) => {
      if (a.position.line !== b.position.line) {
        return b.position.line - a.position.line;
      }
      return b.position.column - a.position.column;
    });

    // Process each candidate using position information
    for (const candidate of sortedCandidates) {
      if (candidate.status !== 'pending' && candidate.status !== 'existing') {
        continue;
      }

      const success = this.applyCandidate(candidate, content, magicString);
      if (success) {
        candidate.status = 'applied';
        didMutate = true;
      }
    }

    return {
      didMutate,
      content: didMutate ? magicString.toString() : content,
      edits: didMutate ? this.generateEdits(candidates, content, magicString.toString()) : []
    };
  }

  private getVueEslintParser(): any | null {
    try {
      return requireFromWorkspace('vue-eslint-parser', this.workspaceRoot);
    } catch {
      // Fallback to the package bundled with this library (useful for tests
      // and environments where workspaceRoot doesn't point to project root).
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        // eslint-disable-next-line global-require
        return require('vue-eslint-parser');
      } catch (err) {
        return null;
      }
    }
  }

  private compilePatterns(patterns?: string[]): RegExp[] {
    if (!patterns || patterns.length === 0) return [];
    return patterns.map(pattern => new RegExp(pattern, 'i'));
  }

  private extractFromContent(content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean = false): void {
    // Simple fallback extraction - look for text content in template HTML.
    // This is used when vue-eslint-parser is not available at all.
    const lines = content.split('\n');

    // Determine template boundaries so we don't extract from <script>/<style>
    let inTemplate = false;
    let inScriptOrStyle = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/<template[\s>]/i.test(line)) inTemplate = true;
      if (/<\/template>/i.test(line)) inTemplate = false;
      if (/<script[\s>]/i.test(line) || /<style[\s>]/i.test(line)) inScriptOrStyle = true;
      if (/<\/script>/i.test(line) || /<\/style>/i.test(line)) inScriptOrStyle = false;

      if (!inTemplate || inScriptOrStyle) continue;

  this.extractAttributeCandidatesFromLine(line, filePath, i + 1, candidates);

      // Collect text fragments on this template line. We want to capture:
      // - text between tags on the same line (e.g. <h1>Title</h1>)
      // - text after a closing tag on the same line (</b> trailing text)
      // - standalone lines that contain only text (indented text on its own
      //   line inside the template)
      const fragments = new Set<string>();

      // (a) between tags
      const betweenTagRe = />[^<]+</g;
      let m: RegExpExecArray | null;
      while ((m = betweenTagRe.exec(line)) !== null) {
        fragments.add(m[0].slice(1, -1));
      }

      // (b) after a '>' until next '<' or end-of-line (handles trailing text)
      const afterTagRe = />\s*([^<\n\r]+)/g;
      while ((m = afterTagRe.exec(line)) !== null) {
        fragments.add(m[1]);
      }

      // (c) whole-line text (no tags on this line)
      if (!line.includes('<') && line.trim().length > 0) {
        fragments.add(line.trim());
      }

      for (const raw of fragments) {
        const text = raw.trim();
        if (!text) continue;

        // When scanCalls is true (rename mode), capture literal key-like strings
        if (scanCalls && /^[\w-]+(\.[\w-]+)+$/.test(text)) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${i + 1}:rename`,
            kind: 'jsx-text' as CandidateKind, // Use jsx-text for template context
            filePath,
            text,
            position: {
              line: i + 1,
              column: line.indexOf(text),
            },
            suggestedKey: text,
            hash: this.hashText(text),
          };
          candidates.push(candidate);
          continue;
        }

        // Skip text that contains Vue template interpolations ({{ ... }}).
        if (/\{\{/.test(text)) {
          this.extractQuotedLiterals(text, filePath, i + 1, candidates, { allowSingleCharacter: false });
          continue;
        }

        // Skip existing translation calls ($t, t)
        if (/\$?t\s*\(/.test(text)) {
          continue;
        }

        if (this.shouldExtractText(text)) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${i + 1}`,
            kind: 'jsx-text' as CandidateKind,
            filePath,
            text,
            position: {
              line: i + 1,
              column: line.indexOf(text),
            },
            suggestedKey: this.generateKey(text),
            hash: this.hashText(text),
          };

          candidates.push(candidate);
        }
      }
    }
  }

  private extractAttributeCandidatesFromLine(line: string, filePath: string, lineNumber: number, candidates: ScanCandidate[]): void {
    const attributeRegex = /(:?[\w-]+)\s*=\s*("[^"]*"|'[^']*')/g;
    let match: RegExpExecArray | null;

    while ((match = attributeRegex.exec(line)) !== null) {
  const rawName = match[1];
      const quotedValue = match[2];
  const isBound = rawName.startsWith(':') || rawName.startsWith('v-bind:');
  const attrName = rawName.replace(/^(?:v-bind:|:)/, '');
      if (!this.isTranslatableAttribute(attrName)) {
        continue;
      }

      const value = quotedValue.slice(1, -1);
      if (!value || /\$?t\s*\(/.test(value)) {
        continue;
      }

      if (isBound) {
        // Try to analyze the bound expression to see if it can be extracted
        try {
          const analysis = analyzeVueExpression(value);
          if (analysis.canExtract && analysis.mergedText) {
            const interp = analysis.interpolationParams
              ? Object.entries(analysis.interpolationParams).map(([name, expression]) => ({ name, expression }))
              : undefined;

            const extracted = analysis.mergedText;
            if (this.shouldExtractText(extracted, { attribute: attrName })) {
              // Use static-only text parts (when available) to generate suggestion
              const keyText = (analysis.textParts && analysis.textParts.length > 0)
                ? analysis.textParts.join(' ').replace(/\s{2,}/g, ' ').trim()
                : extracted;

              candidates.push({
                id: `${filePath}:${lineNumber}:${attrName}:${extracted}`,
                kind: 'jsx-attribute' as CandidateKind,
                filePath,
                text: extracted,
                position: {
                  line: lineNumber,
                  column: Math.max(line.indexOf(quotedValue), 0),
                },
                suggestedKey: this.generateKey(keyText),
                hash: this.hashText(extracted),
                context: attrName,
                interpolation: interp && interp.length > 0 ? { template: analysis.mergedText, variables: interp, localeValue: analysis.mergedText } : undefined,
              });
            }
            continue;
          }
        } catch (err) {
          // Fall back to simple extraction if analysis fails
        }

        // Fall back: extract quoted literals from the expression string
        const extractedStrings = this.extractStringsFromExpression(value);
        for (const extracted of extractedStrings) {
          if (!this.shouldExtractText(extracted, { attribute: attrName })) continue;
          candidates.push({
            id: `${filePath}:${lineNumber}:${attrName}:${extracted}`,
            kind: 'jsx-attribute' as CandidateKind,
            filePath,
            text: extracted,
            position: {
              line: lineNumber,
              column: Math.max(line.indexOf(quotedValue), 0),
            },
            suggestedKey: this.generateKey(extracted),
            hash: this.hashText(extracted),
            context: attrName,
          });
        }
      } else {
        const extractedStrings = [value.trim()];
        for (const extracted of extractedStrings) {
          if (!this.shouldExtractText(extracted, { attribute: attrName })) {
            continue;
          }

          candidates.push({
            id: `${filePath}:${lineNumber}:${attrName}:${extracted}`,
            kind: 'jsx-attribute' as CandidateKind,
            filePath,
            text: extracted,
            position: {
              line: lineNumber,
              column: Math.max(line.indexOf(quotedValue), 0),
            },
            suggestedKey: this.generateKey(extracted),
            hash: this.hashText(extracted),
            context: attrName,
          });
        }
      }
    }
  }

  private extractStringsFromExpression(value: string): string[] {
    const results: string[] = [];
    const hasTemplateLiteral = value.includes('`');

    if (hasTemplateLiteral) {
      const withoutBackticks = value.replace(/`/g, '');
      const withoutExpressions = withoutBackticks.replace(/\$\{[^}]*\}/g, '');
      const cleaned = withoutExpressions.trim();
      if (cleaned) {
        results.push(cleaned);
      }
      return results;
    }

  const literalRegex = /(['"])([^"']*?)\1/g;
    let match: RegExpExecArray | null;
    while ((match = literalRegex.exec(value)) !== null) {
      const literal = match[2].trim();
      if (literal) {
        results.push(literal);
      }
    }

    return results.filter(Boolean);
  }

  private extractQuotedLiterals(text: string, filePath: string, lineNumber: number, candidates: ScanCandidate[], options?: { allowSingleCharacter?: boolean }): void {
  const literalRegex = /(['"])([^"']*?)\1/g;
    let match: RegExpExecArray | null;

    while ((match = literalRegex.exec(text)) !== null) {
      const literal = match[2].trim();
      if (!literal) continue;
      if (!options?.allowSingleCharacter && literal.length === 1) continue;
      if (!this.shouldExtractText(literal)) continue;

      candidates.push({
        id: `${filePath}:${lineNumber}:${literal}`,
        kind: 'jsx-text' as CandidateKind,
        filePath,
        text: literal,
        position: {
          line: lineNumber,
          column: Math.max(text.indexOf(match[0]), 0),
        },
        suggestedKey: this.generateKey(literal),
        hash: this.hashText(literal),
      });
    }
  }

  private reportTemplateParseFailure(filePath: string, content: string, error?: unknown): void {
    const issues = this.findTemplateSyntaxIssues(content);
    const detail = issues.length ? ` Possible issues: ${issues.join(' | ')}` : '';
    const errorMessage = error instanceof Error ? ` (${error.message})` : '';
    console.warn(`[i18nsmith] Failed to parse Vue template for ${filePath}. Falling back to regex extraction${errorMessage}.${detail}`);
  }

  private findTemplateSyntaxIssues(content: string): string[] {
    const issues: string[] = [];
    const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/i);
    const templateBody = templateMatch?.[1] ?? content;
    const beforeTemplate = templateMatch?.index ? content.slice(0, templateMatch.index) : '';
    const baseLine = beforeTemplate ? beforeTemplate.split('\n').length : 0;

    const openCount = (templateBody.match(/\{\{/g) ?? []).length;
    const closeCount = (templateBody.match(/\}\}/g) ?? []).length;
    if (openCount !== closeCount) {
      issues.push(`mismatched interpolation braces ({{:${openCount}, }}:${closeCount})`);
    }

    const lines = templateBody.split('\n');
    let balance = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const opens = (line.match(/\{\{/g) ?? []).length;
      const closes = (line.match(/\}\}/g) ?? []).length;
      balance += opens - closes;
      if (balance < 0) {
        issues.push(`unexpected '}}' near line ${baseLine + i + 1}`);
        balance = 0;
      }
    }

    if (balance > 0) {
      issues.push('unclosed "{{" interpolation');
    }

    return issues;
  }

  private extractFromTemplate(templateBody: any, content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean): void {
    if (!templateBody) return;

    // Walk the template AST to find text and attributes
    this.walkTemplate(templateBody, content, filePath, candidates, scanCalls);
  }

  private extractFromScript(scriptBody: any[], content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean): void {
    // Extract string literals from variable declarations and assignments in script
    for (const node of scriptBody) {
      this.walkScript(node, content, filePath, candidates, scanCalls);
    }
  }

  private walkScript(node: any, content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean): void {
    if (!node) return;

    switch (node.type) {
      case 'VariableDeclaration':
        for (const declaration of node.declarations) {
          if (declaration.init && declaration.init.type === 'Literal' && typeof declaration.init.value === 'string') {
            this.extractScriptStringLiteral(declaration.init, content, filePath, candidates, scanCalls);
          }
        }
        break;
      case 'AssignmentExpression':
        if (node.right && node.right.type === 'Literal' && typeof node.right.value === 'string') {
          this.extractScriptStringLiteral(node.right, content, filePath, candidates, scanCalls);
        }
        break;
      // Walk child nodes
      default:
        if (node.body && Array.isArray(node.body)) {
          for (const child of node.body) {
            this.walkScript(child, content, filePath, candidates, scanCalls);
          }
        } else if (node.consequent) {
          this.walkScript(node.consequent, content, filePath, candidates, scanCalls);
        } else if (node.alternate) {
          this.walkScript(node.alternate, content, filePath, candidates, scanCalls);
        }
        break;
    }
  }

  private extractScriptStringLiteral(node: any, content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean): void {
    const text = node.value;
    if (!text || typeof text !== 'string') {
      return;
    }

    // When scanCalls is true (rename mode), we want to capture literal key-like
    // strings that may represent translation keys, even if they don't match
    // extraction heuristics. This ensures KeyRenamer can find and rename
    // literal occurrences like `message: 'old.key'` in script sections.
    if (scanCalls) {
      // Emit a candidate for any dotted string literal that looks like a key
      if (/^[\w-]+(\.[\w-]+)+$/.test(text)) {
        const lines = content.slice(0, node.range[0]).split('\n');
        const line = lines.length;
        const column = lines[lines.length - 1].length;

        const candidate: ScanCandidate = {
          id: `${filePath}:${line}:rename`,
          kind: 'jsx-expression' as CandidateKind, // Use jsx-expression for script context
          filePath,
          text,
          position: { line, column },
          suggestedKey: text, // Keep the same key for rename operations
          hash: this.hashText(text),
        };

        candidates.push(candidate);
        return;
      }
    }

    // Standard extraction logic (for transform/scan operations)
    if (!this.shouldExtractText(text)) {
      return;
    }

    if (this.isTranslationFallback(node)) {
      return;
    }

    // Skip strings that contain HTML markup — these are typically innerHTML
    // assignments or template strings that need manual i18n handling.
    // Embedding $t() / {{ }} in an innerHTML string is a runtime error;
    // the user must refactor to use a computed property or v-html binding.
    if (this.isHtmlString(text)) {
      return;
    }

    // Calculate line and column from offset (node.range covers the full quoted literal)
    const lines = content.slice(0, node.range[0]).split('\n');
    const line = lines.length;
    const column = lines[lines.length - 1].length;

    const candidate: ScanCandidate = {
      id: `${filePath}:${line}`,
      kind: 'jsx-expression' as CandidateKind,
      filePath,
      text,
      position: {
        line,
        column,
      },
      suggestedKey: this.generateKey(text),
      hash: this.hashText(text),
    };

    candidates.push(candidate);
  }

  private isTranslationFallback(node: any): boolean {
    const parent = node?.parent;
    if (!parent || parent.type !== 'LogicalExpression') {
      return false;
    }

    if (parent.right !== node || (parent.operator !== '||' && parent.operator !== '??')) {
      return false;
    }

    const left = parent.left;
    return this.isTranslationCallNode(left);
  }

  private isTranslationCallNode(node: any): boolean {
    if (!node || node.type !== 'CallExpression') {
      return false;
    }

    const callee = node.callee;
    if (!callee) return false;

    if (callee.type === 'Identifier') {
      return callee.name === 't' || callee.name === '$t';
    }

    if (callee.type === 'MemberExpression' && callee.property?.type === 'Identifier') {
      return callee.property.name === 't' || callee.property.name === '$t';
    }

    return false;
  }

  private walkTemplate(node: any, content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean): void {
    if (!node) return;

    switch (node.type) {
      case 'VText':
        // VText is handled by the parent VElement (see below) with sibling context
        break;
      case 'VElement':
        this.extractElementAttributes(node, content, filePath, candidates, scanCalls);
        // Process children with sibling awareness. If an element contains a mix
        // of VText and VExpressionContainer nodes we try to extract the whole
        // fragment as a single interpolated candidate (e.g. "User name: {{ id }}").
        if (node.children) {
          const hasExpressionChild = node.children.some((c: any) => c.type === 'VExpressionContainer');

          if (hasExpressionChild) {
            // Map children to the lightweight shape expected by
            // analyzeVueAdjacentContent()
            const adjacentChildren = node.children.map((c: any) => {
              if (c.type === 'VText') {
                return { type: 'VText', text: content.slice(c.range[0], c.range[1]), range: c.range };
              }
              if (c.type === 'VExpressionContainer') {
                const expr = c.expression;
                const exprText = expr && expr.range ? content.slice(expr.range[0], expr.range[1]) : (expr && expr.name) || '';
                return { type: 'VExpressionContainer', expression: exprText, range: c.range };
              }
              return { type: 'VElement', range: c.range };
            });

            try {
              const adj = analyzeVueAdjacentContent(adjacentChildren);
              // (debug logs removed)
              if (adj && adj.canInterpolate && adj.mergedText) {
                // Accept merged adjacent content when either the full merged
                // text passes the text-filter, or when there is at least one
                // meaningful static child part (defensive fallback to handle
                // cases like template-literals inside mustache).
                const mergedPasses = this.shouldExtractText(adj.mergedText);
                const hasMeaningfulStaticPart = Array.isArray(adj.textParts) && adj.textParts.some(p => /[A-Za-z]{2,}/.test(p));

                if (mergedPasses || hasMeaningfulStaticPart) {
                  const candidate: ScanCandidate = {
                    id: `${filePath}:${node.loc.start.line}:${node.loc.start.column}`,
                    kind: 'jsx-expression' as CandidateKind,
                    filePath,
                    text: adj.mergedText,
                    position: {
                      line: node.loc.start.line,
                      column: node.loc.start.column,
                    },
                    suggestedKey: this.generateKey(adj.keyText || adj.mergedText),
                    hash: this.hashText(adj.mergedText),
                    fullRange: [node.range[0], node.range[1]],
                    interpolation: adj.interpolationParams && Object.keys(adj.interpolationParams).length > 0
                      ? { template: adj.mergedText, variables: Object.entries(adj.interpolationParams).map(([name, expression]) => ({ name, expression })), localeValue: adj.mergedText }
                      : undefined,
                  } as ScanCandidate & { fullRange?: [number, number] };

                  candidates.push(candidate);
                  // We've handled the whole children block — skip individual child processing
                  return;
                }
              }
            } catch (err) {
              // If adjacent analysis fails fall back to per-child processing below
            }
          }

          // Fallback: process children individually
          for (const child of node.children) {
            if (child.type === 'VText') {
              this.extractTextNode(child, content, filePath, candidates, hasExpressionChild, scanCalls);
            } else {
              this.walkTemplate(child, content, filePath, candidates, scanCalls);
            }
          }
        }
        break;
      case 'VExpressionContainer':
        // Extract string literals from template expressions like {{ 'text' }}
        if (node.expression) {
          this.extractFromExpression(node.expression, content, filePath, candidates, scanCalls);
        }
        break;
    }
  }

  private extractFromExpression(expr: any, content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean): void {
    if (!expr) return;

    // Handle string literals in template expressions: {{ 'text' }} or {{ "text" }}
    if (expr.type === 'Literal' && typeof expr.value === 'string') {
      const text = expr.value;
      
      // When scanCalls is true (rename mode), capture literal key-like strings
      if (scanCalls && /^[\w-]+(\.[\w-]+)+$/.test(text)) {
        const candidate: ScanCandidate = {
          id: `${filePath}:${expr.loc.start.line}:${expr.loc.start.column}:rename`,
          kind: 'jsx-expression' as CandidateKind, // Use jsx-expression for template expressions
          filePath,
          text,
          position: {
            line: expr.loc.start.line,
            column: expr.loc.start.column,
          },
          suggestedKey: text, // Keep the same key for rename
          hash: this.hashText(text),
          fullRange: [expr.range[0], expr.range[1]],
        } as ScanCandidate & { fullRange?: [number, number] };

        candidates.push(candidate);
        return;
      }

      if (!this.shouldExtractText(text)) return;

      // Skip if it's already a translation call
      if (this.isHtmlString(text)) return;

      const candidate: ScanCandidate = {
        id: `${filePath}:${expr.loc.start.line}:${expr.loc.start.column}`,
        kind: 'jsx-expression' as CandidateKind,
        filePath,
        text,
        position: {
          line: expr.loc.start.line,
          column: expr.loc.start.column,
        },
        suggestedKey: this.generateKey(text),
        hash: this.hashText(text),
        // Store the full literal range including quotes for replacement
        fullRange: [expr.range[0], expr.range[1]],
      } as ScanCandidate & { fullRange?: [number, number] };

      candidates.push(candidate);
      return;
    }

    // Handle template literals, concatenations and mixed expressions by delegating
    // to the Vue expression analyzer which mirrors React adapter capabilities.
    try {
      const expressionText = content.slice(expr.range[0], expr.range[1]);
  const analysis = analyzeVueExpression(expressionText);

      if (analysis.canExtract && analysis.mergedText) {
        const interp = analysis.interpolationParams ? Object.entries(analysis.interpolationParams).map(([name, expression]) => ({ name, expression })) : undefined;

          const keyText = (analysis.textParts && analysis.textParts.length > 0)
            ? analysis.textParts.join(' ').replace(/\s{2,}/g, ' ').trim()
            : analysis.mergedText;

          const candidate: ScanCandidate = {
          id: `${filePath}:${expr.loc.start.line}:${expr.loc.start.column}`,
          kind: 'jsx-expression' as CandidateKind,
          filePath,
          text: analysis.mergedText,
          position: {
            line: expr.loc.start.line,
            column: expr.loc.start.column,
          },
          suggestedKey: this.generateKey(keyText),
          hash: this.hashText(analysis.mergedText),
          fullRange: [expr.range[0], expr.range[1]],
          interpolation: interp && interp.length > 0 ? { template: analysis.mergedText, variables: interp, localeValue: analysis.mergedText } : undefined,
        } as ScanCandidate & { fullRange?: [number, number] };

        candidates.push(candidate);
        return;
      }
    } catch (err) {
      // Fall through and ignore analysis errors — conservative behavior
    }
  }

  private extractTextNode(node: any, content: string, filePath: string, candidates: ScanCandidate[], hasAdjacentExpression: boolean, scanCalls: boolean): void {
  const rawText = content.slice(node.range[0], node.range[1]);
  let trimmedText = rawText.trim();

  // If the text contains an embedded SQL-like fragment, only keep the
  // human-facing prefix for extraction (don't extract SQL snippets).
  trimmedText = extractTranslatablePrefix(trimmedText);

    // When scanCalls is true (rename mode), capture literal key-like text
    if (scanCalls && /^[\w-]+(\.[\w-]+)+$/.test(trimmedText)) {
      const candidate: ScanCandidate = {
        id: `${filePath}:${node.loc.start.line}:${node.loc.start.column}:rename`,
        kind: 'jsx-text' as CandidateKind, // Use jsx-text so transformText will be called
        filePath,
        text: trimmedText,
        position: {
          line: node.loc.start.line,
          column: node.loc.start.column,
        },
        suggestedKey: trimmedText, // Keep the same key for rename
        hash: this.hashText(trimmedText),
        fullRange: [node.range[0], node.range[1]],
      } as ScanCandidate & { fullRange?: [number, number] };

      candidates.push(candidate);
      return;
    }

    // DEBUG: log why a text node might be skipped
    // eslint-disable-next-line no-console
    // console.log('DEBUG extractTextNode:', { rawText, trimmedText, canExtract: this.shouldExtractText(trimmedText) });

    if (!this.shouldExtractText(trimmedText)) return;

    // If this text node is a sibling of a {{ }} expression container,
    // it's a fragment of a compound expression like "ID: {{ id }}".
    // These fragments (e.g. "ID:", "| Images:") are not standalone
    // translatable strings — they need i18n with named interpolation
    // parameters which is a different, more complex transformation.
    if (hasAdjacentExpression) {
      return;
    }

    const candidate: ScanCandidate = {
      id: `${filePath}:${node.loc.start.line}:${node.loc.start.column}`,
      kind: 'jsx-text' as CandidateKind,
      filePath,
      text: trimmedText,
      position: {
        line: node.loc.start.line,
        column: node.loc.start.column,
      },
      suggestedKey: this.generateKey(trimmedText),
      hash: this.hashText(trimmedText),
      // Store the full text node range for accurate replacement during mutation
      fullRange: [node.range[0], node.range[1]],
    } as ScanCandidate & { fullRange?: [number, number] };

    candidates.push(candidate);
  }

  private extractElementAttributes(node: any, content: string, filePath: string, candidates: ScanCandidate[], scanCalls: boolean): void {
    if (!node.startTag || !node.startTag.attributes) return;
    for (const attr of node.startTag.attributes) {
      // Handle bound attributes (v-bind / :attr) which appear as VDirective
        if (attr.type === 'VDirective' && attr.key && attr.key.name && attr.key.name.name === 'bind') {
          const arg = attr.key.argument;
          const argName = arg && (arg.name?.name || arg.name);
          if (argName && typeof argName === 'string' && this.isTranslatableAttribute(argName)) {
            if (attr.value && attr.value.type === 'VExpressionContainer' && attr.value.expression && attr.value.expression.range) {
            const exprNode = attr.value.expression;
            const expressionText = content.slice(exprNode.range[0], exprNode.range[1]);
            try {
              const analysis = analyzeVueExpression(expressionText);
              if (analysis.canExtract && analysis.mergedText && this.shouldExtractText(analysis.mergedText, { attribute: argName })) {
                const interp = analysis.interpolationParams ? Object.entries(analysis.interpolationParams).map(([name, expression]) => ({ name, expression })) : undefined;
                const keyText = (analysis.textParts && analysis.textParts.length > 0)
                  ? analysis.textParts.join(' ').replace(/\s{2,}/g, ' ').trim()
                  : analysis.mergedText;

                const candidate: ScanCandidate = {
                  id: `${filePath}:${attr.loc.start.line}:${attr.loc.start.column}`,
                  kind: 'jsx-attribute' as CandidateKind,
                  filePath,
                  text: analysis.mergedText,
                  position: {
                    line: attr.loc.start.line,
                    column: attr.loc.start.column,
                  },
                  suggestedKey: this.generateKey(keyText),
                  hash: this.hashText(analysis.mergedText),
                  context: argName,
                  interpolation: interp && interp.length > 0 ? { template: analysis.mergedText, variables: interp, localeValue: analysis.mergedText } : undefined,
                } as ScanCandidate & { fullRange?: [number, number] };

                candidates.push(candidate);
                continue;
              }
            } catch (err) {
              // ignore analysis errors and fall through
            }
          }
        }
        continue;
      }

      if (attr.type !== 'VAttribute' || !attr.key || !attr.value) continue;

      // Support bound attributes using shorthand (:alt) or v-bind:alt. In
      // the parsed AST these appear as VAttribute with key.name === 'bind'
      // and the actual argument stored in key.argument.
      let isBound = false;
      let attrName: string | undefined = undefined;

      if (attr.key && attr.key.name && (attr.key.name.name === 'bind' || attr.key.name === 'v-bind')) {
        isBound = true;
        attrName = attr.key.argument && (attr.key.argument.name?.name || attr.key.argument.name);
      } else {
        attrName = attr.key.name?.name || attr.key.name;
      }

      if (!attrName || typeof attrName !== 'string') continue;

      // Check if this attribute should be translated
      if (!this.isTranslatableAttribute(attrName)) continue;

      // Handle bound attribute expression: :attr="..."
      if (isBound && attr.value.type === 'VExpressionContainer' && attr.value.expression && attr.value.expression.range) {
        const exprNode = attr.value.expression;
        const expressionText = content.slice(exprNode.range[0], exprNode.range[1]);
        try {
          const analysis = analyzeVueExpression(expressionText);
          if (analysis.canExtract && analysis.mergedText && this.shouldExtractText(analysis.mergedText, { attribute: attrName })) {
            const interp = analysis.interpolationParams ? Object.entries(analysis.interpolationParams).map(([name, expression]) => ({ name, expression })) : undefined;
              const keyText = (analysis.textParts && analysis.textParts.length > 0)
                ? analysis.textParts.join(' ').replace(/\s{2,}/g, ' ').trim()
                : analysis.mergedText;

              const candidate: ScanCandidate = {
              id: `${filePath}:${attr.loc.start.line}:${attr.loc.start.column}`,
              kind: 'jsx-attribute' as CandidateKind,
              filePath,
              text: analysis.mergedText,
              position: {
                line: attr.loc.start.line,
                column: attr.loc.start.column,
              },
              suggestedKey: this.generateKey(keyText),
              hash: this.hashText(analysis.mergedText),
              context: attrName,
              interpolation: interp && interp.length > 0 ? { template: analysis.mergedText, variables: interp, localeValue: analysis.mergedText } : undefined,
            } as ScanCandidate & { fullRange?: [number, number] };

            candidates.push(candidate);
            continue;
          }
        } catch (err) {
          // ignore and fall through to other handlers
        }
      }

      if (attr.value.type === 'VLiteral' && typeof attr.value.value === 'string') {
        const text = attr.value.value;
        
        // When scanCalls is true (rename mode), capture literal key-like strings
        if (scanCalls && /^[\w-]+(\.[\w-]+)+$/.test(text)) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${attr.loc.start.line}:${attr.loc.start.column}:rename`,
            kind: 'jsx-attribute' as CandidateKind,
            filePath,
            text,
            position: {
              line: attr.loc.start.line,
              column: attr.loc.start.column,
            },
            suggestedKey: text, // Keep the same key for rename
            hash: this.hashText(text),
            context: attrName,
          };
          candidates.push(candidate);
          continue;
        }
        
        if (this.shouldExtractText(text, { attribute: attrName })) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${attr.loc.start.line}:${attr.loc.start.column}`,
            kind: 'jsx-attribute' as CandidateKind,
            filePath,
            text,
            position: {
              line: attr.loc.start.line,
              column: attr.loc.start.column,
            },
            suggestedKey: this.generateKey(text),
            hash: this.hashText(text),
            context: attrName,
          };
          candidates.push(candidate);
        }
      }
    }
  }

  private isTranslatableAttribute(attrName: string): boolean {
    const lowerAttr = attrName.toLowerCase();

    if (this.nonTranslatableAttributes.has(lowerAttr)) {
      return false;
    }

    // Check if explicitly translatable
    if (this.translatableAttributes.has(lowerAttr)) return true;

    // Check if matches any suffix pattern
    for (const suffix of this.attributeSuffixes) {
      if (lowerAttr.endsWith(suffix) || lowerAttr.endsWith(`-${suffix}`)) {
        return true;
      }
    }

    return false;
  }

  private shouldExtractText(text: string, context?: { attribute?: string }): boolean {
    const config: TextFilterConfig = {
      allowPatterns: this.allowPatterns,
      denyPatterns: this.denyPatterns,
      skipHexColors: false, // Vue doesn't typically have hex colors in templates
      context,
    };
    const result = shouldExtractText(text, config);
    // (debug logging removed)
    return result.shouldExtract;
  }

  private generateKey(text: string): string {
    return generateKey(text, 'snake', 50);
  }

  private hashText(text: string): string {
    return hashText(text);
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Detect if a string literal contains HTML markup, making it unsuitable
   * for simple $t() replacement. Strings like:
   *   `'<span class="foo">text</span>'` (innerHTML assignments)
   *   `'<i class="icon"></i><br>...'`
   * need manual refactoring (e.g. v-html with computed, or component-based).
   *
   * Also catches strings that already contain Vue template syntax ({{ }})
   * or $t() calls — these are already "internationalized" strings that
   * just happen to be inside JS (e.g. innerHTML = '{{ $t("key") }}'),
   * which is broken at runtime and should be flagged rather than extracted.
   */
  private isHtmlString(text: string): boolean {
    // Contains HTML tags
    if (/<[a-z][a-z0-9-]*[\s>]/i.test(text)) {
      return true;
    }
    // Contains Vue template interpolation {{ }}
    if (/\{\{.*\}\}/.test(text)) {
      return true;
    }
    // Contains existing $t() or t() calls
    if (/\$?t\s*\(/.test(text)) {
      return true;
    }
    return false;
  }

  private applyCandidate(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    let startPos: number;
    let endPos: number;

    // Check if we have stored the full range for accurate replacement
    const extendedCandidate = candidate as TransformCandidate & { fullRange?: [number, number] };
    if (extendedCandidate.fullRange) {
      [startPos, endPos] = extendedCandidate.fullRange;
    } else {
      // Fallback to position-based calculation
      startPos = this.lineColumnToBytePosition(content, candidate.position.line, candidate.position.column);
      if (startPos === -1) return false;

      if (candidate.kind === 'jsx-expression') {
        // For script string literals the position points to the opening quote.
        // The raw range includes the quotes, so we need to account for them.
        // Detect the quote character and find the matching close.
        const quoteChar = content[startPos];
        if (quoteChar === '\'' || quoteChar === '"' || quoteChar === '`') {
          endPos = startPos + candidate.text.length + 2; // +2 for opening and closing quotes
        } else {
          endPos = startPos + candidate.text.length;
        }
      } else {
        endPos = startPos + candidate.text.length;
      }
    }

    // For Vue files, we need to handle different types of content based on the candidate kind
    switch (candidate.kind) {
      case 'jsx-text':
        return this.transformText(candidate, startPos, endPos, magicString);

      case 'jsx-attribute':
        return this.transformAttribute(candidate, startPos, endPos, magicString);

      case 'jsx-expression':
        return this.transformExpression(candidate, startPos, endPos, magicString);

      default:
        return false;
    }
  }

  private lineColumnToBytePosition(content: string, line: number, column: number): number {
    const lines = content.split('\n');
    if (line < 1 || line > lines.length) return -1;

    let position = 0;
    for (let i = 0; i < line - 1; i++) {
      position += lines[i].length + 1; // +1 for newline
    }

    position += column;
    return position;
  }

  private transformText(candidate: TransformCandidate, startPos: number, endPos: number, magicString: MagicString): boolean {
    // Replace text content with {{ $t('key') }} or with params when interpolation present
    let translationCall: string;
    if (candidate.interpolation && candidate.interpolation.variables && candidate.interpolation.variables.length > 0) {
      const params: Record<string, string> = {};
      for (const v of candidate.interpolation.variables) params[v.name] = v.expression;
      translationCall = generateVueReplacement(candidate.suggestedKey || '', params, { useDoubleQuotes: false });
    } else {
      translationCall = `{{ $t('${candidate.suggestedKey}') }}`;
    }
    magicString.overwrite(startPos, endPos, translationCall);
    return true;
  }

  private transformAttribute(candidate: TransformCandidate, startPos: number, endPos: number, magicString: MagicString): boolean {
    // For Vue attributes, we need to replace the entire attribute with dynamic binding
    // e.g., placeholder="value" becomes :placeholder="$t('key')"
    const attrName = candidate.context || 'value';
    // Build attribute translation call, including params if present
    const inner = candidate.interpolation && candidate.interpolation.variables && candidate.interpolation.variables.length > 0
      ? generateVueAttributeReplacement(candidate.suggestedKey || '', Object.fromEntries(candidate.interpolation.variables.map(v => [v.name, v.expression])), { useDoubleQuotes: false })
      : `$t('${candidate.suggestedKey}')`;
    const translationCall = `:${attrName}="${inner}"`;

    // We need to find the full attribute range, not just the value
    // This is a simplified approach - in a real implementation, we'd need AST positions
    const content = magicString.original;
    // Match either bound or static attribute form and choose the one that contains the candidate text
  const attrPattern = new RegExp(`(?:(:|v-bind:)${attrName}|${attrName})\\s*=\\s*(['"])([\\s\\S]*?)\\2`, 'g');
    let m: RegExpExecArray | null;
    while ((m = attrPattern.exec(content)) !== null) {
      const value = m[3] ?? '';

      // Determine whether this attribute match corresponds to our candidate.
      // Candidate text for interpolations uses placeholders (e.g. "Hello {name}")
      // while the attribute expression may be a concatenation ('Hello ' + name).
      // Match if any of the following hold:
      // - attribute value contains the exact candidate.text
      // - attribute value contains at least one interpolation variable expression/name
      // - attribute value contains a static fragment from the candidate text
      let matchesCandidate = false;
      if (candidate.text && value.includes(candidate.text)) matchesCandidate = true;
      if (!matchesCandidate && candidate.interpolation && candidate.interpolation.variables) {
        for (const v of candidate.interpolation.variables) {
          if (!v) continue;
          if ((v.expression && value.includes(v.expression)) || (v.name && value.includes(v.name))) {
            matchesCandidate = true;
            break;
          }
        }
      }
      if (!matchesCandidate && candidate.text) {
        const staticFragment = candidate.text.replace(/\{[^}]+\}/g, '').trim();
        if (staticFragment && value.includes(staticFragment)) matchesCandidate = true;
      }

      if (matchesCandidate) {
        const attrStart = m.index;
        const attrEnd = attrStart + m[0].length;
        magicString.overwrite(attrStart, attrEnd, translationCall);
        return true;
      }
    }

    return false;
  }

  private transformExpression(candidate: TransformCandidate, startPos: number, endPos: number, magicString: MagicString): boolean {
    // For template expressions like {{ 'text' }}, we replace just the string literal
    // with $t('key'), keeping the {{ }} wrapper intact.
    // The fullRange should point to the literal including quotes.
    const original = magicString.original.slice(startPos, endPos);
    const hasMustache = original.includes('{{') || original.includes('}}') || original.trim().startsWith('{{');

    // Build replacement (use full {{ $t(...) }} when the original content
    // was a template interpolation; otherwise use attribute-style $t(...).
    if (candidate.interpolation && candidate.interpolation.variables && candidate.interpolation.variables.length > 0) {
      const params = Object.fromEntries(candidate.interpolation.variables.map(v => [v.name, v.expression]));
      const attrReplacement = generateVueAttributeReplacement(candidate.suggestedKey || '', params, { useDoubleQuotes: false });
      const tmplReplacement = generateVueReplacement(candidate.suggestedKey || '', params, { useDoubleQuotes: false });
      magicString.overwrite(startPos, endPos, hasMustache ? tmplReplacement : attrReplacement);
    } else {
      const simpleAttr = `$t('${candidate.suggestedKey}')`;
      const simpleTmpl = `{{ $t('${candidate.suggestedKey}') }}`;
      magicString.overwrite(startPos, endPos, hasMustache ? simpleTmpl : simpleAttr);
    }
    return true;
  }

  private generateEdits(candidates: TransformCandidate[], originalContent: string, _newContent: string): Array<{ start: number; end: number; replacement: string }> {
    // Simple diff-based edit generation
    const edits: Array<{ start: number; end: number; replacement: string }> = [];

    // For now, return applied candidates as edits
    for (const candidate of candidates) {
      if (candidate.status === 'applied') {
        const startPos = this.lineColumnToBytePosition(originalContent, candidate.position.line, candidate.position.column);
        if (startPos !== -1) {
          const endPos = startPos + candidate.text.length;
          edits.push({
            start: startPos,
            end: endPos,
        replacement: candidate.kind === 'jsx-text'
          ? (candidate.interpolation && candidate.interpolation.variables && candidate.interpolation.variables.length > 0
            ? generateVueReplacement(candidate.suggestedKey || '', Object.fromEntries(candidate.interpolation.variables.map(v => [v.name, v.expression])), { useDoubleQuotes: false })
            : `{{ $t('${candidate.suggestedKey}') }}`)
          : (`:${candidate.context || 'value'}="${candidate.interpolation && candidate.interpolation.variables && candidate.interpolation.variables.length > 0
            ? generateVueAttributeReplacement(candidate.suggestedKey || '', Object.fromEntries(candidate.interpolation.variables.map(v => [v.name, v.expression])), { useDoubleQuotes: true })
            : `$t('${candidate.suggestedKey}')`}"`)
          });
        }
      }
    }

    return edits;
  }
}