import path from 'path';
import MagicString from 'magic-string';
import type { I18nConfig } from '../../config.js';
import type { ScanCandidate, CandidateKind, SkipReason, SkippedCandidate } from '../../scanner.js';
import type { FrameworkAdapter, TransformCandidate, MutationResult, AdapterScanOptions, AdapterMutateOptions } from '../types.js';
import { shouldExtractText, generateKey, hashText, compilePatterns, escapeRegExp, type TextFilterConfig } from '../utils/text-filters.js';

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
    // Check if vue-eslint-parser is available
    let available = false;
    try {
      // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval
      eval('require')('vue-eslint-parser');
      available = true;
    } catch {
      available = false;
    }

    return [{
      name: 'vue-eslint-parser',
      available,
      installHint: 'npm install --save-dev vue-eslint-parser'
    }];
  }

  scan(filePath: string, content: string, options?: AdapterScanOptions): ScanCandidate[] {
    const candidates: ScanCandidate[] = [];
    this.activeSkipLog = [];
    this.seenCandidateIds.clear();

    try {
      const vueEslintParser = this.getVueEslintParser();
      if (!vueEslintParser) {
        // Fallback: no parser available - use a minimal text-based extraction
        this.extractFromContent(content, filePath, candidates);
        this.lastSkipped = this.activeSkipLog ?? [];
        this.activeSkipLog = undefined;
        return candidates;
      }

      const ast = vueEslintParser.parse(content, {
        sourceType: 'module',
        ecmaVersion: 2020,
        sourceFile: filePath,
      });

      // Extract candidates from template
      if (ast.templateBody) {
        this.extractFromTemplate(ast.templateBody, content, filePath, candidates);
      }

      // Extract candidates from script (if TypeScript)
      if (ast.body) {
        this.extractFromScript(ast.body, content, filePath, candidates);
      }

      this.lastSkipped = this.activeSkipLog ?? [];
      this.activeSkipLog = undefined;
      return candidates;
    } catch (error) {
      // If parsing fails, fall back to content-based extraction
      this.extractFromContent(content, filePath, candidates);
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
      // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval
      return eval('require')('vue-eslint-parser');
    } catch {
      return null;
    }
  }

  private compilePatterns(patterns?: string[]): RegExp[] {
    if (!patterns || patterns.length === 0) return [];
    return patterns.map(pattern => new RegExp(pattern, 'i'));
  }

  private extractFromContent(content: string, filePath: string, candidates: ScanCandidate[]): void {
    // Simple fallback extraction - look for quoted strings in template-like content
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Look for template content between > and < or in attributes
      const templateMatches = line.match(/>([^<]+)</g);
      if (templateMatches) {
        for (const match of templateMatches) {
          const text = match.slice(1, -1).trim();
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
  }

  private extractFromTemplate(templateBody: any, content: string, filePath: string, candidates: ScanCandidate[]): void {
    if (!templateBody) return;

    // Walk the template AST to find text and attributes
    this.walkTemplate(templateBody, content, filePath, candidates);
  }

  private extractFromScript(scriptBody: any[], content: string, filePath: string, candidates: ScanCandidate[]): void {
    // Extract string literals from variable declarations and assignments in script
    for (const node of scriptBody) {
      this.walkScript(node, content, filePath, candidates);
    }
  }

  private walkScript(node: any, content: string, filePath: string, candidates: ScanCandidate[]): void {
    if (!node) return;

    switch (node.type) {
      case 'VariableDeclaration':
        for (const declaration of node.declarations) {
          if (declaration.init && declaration.init.type === 'Literal' && typeof declaration.init.value === 'string') {
            this.extractScriptStringLiteral(declaration.init, content, filePath, candidates);
          }
        }
        break;
      case 'AssignmentExpression':
        if (node.right && node.right.type === 'Literal' && typeof node.right.value === 'string') {
          this.extractScriptStringLiteral(node.right, content, filePath, candidates);
        }
        break;
      // Walk child nodes
      default:
        if (node.body && Array.isArray(node.body)) {
          for (const child of node.body) {
            this.walkScript(child, content, filePath, candidates);
          }
        } else if (node.consequent) {
          this.walkScript(node.consequent, content, filePath, candidates);
        } else if (node.alternate) {
          this.walkScript(node.alternate, content, filePath, candidates);
        }
        break;
    }
  }

  private extractScriptStringLiteral(node: any, content: string, filePath: string, candidates: ScanCandidate[]): void {
    const text = node.value;
    if (!text || typeof text !== 'string' || !this.shouldExtractText(text)) {
      return;
    }

    // Calculate line and column from offset
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

  private walkTemplate(node: any, content: string, filePath: string, candidates: ScanCandidate[]): void {
    if (!node) return;

    switch (node.type) {
      case 'VText':
        this.extractTextNode(node, content, filePath, candidates);
        break;
      case 'VElement':
        this.extractElementAttributes(node, content, filePath, candidates);
        // Walk children
        if (node.children) {
          for (const child of node.children) {
            this.walkTemplate(child, content, filePath, candidates);
          }
        }
        break;
      case 'VExpressionContainer':
        // Skip expressions for now
        break;
    }
  }

  private extractTextNode(node: any, content: string, filePath: string, candidates: ScanCandidate[]): void {
    const rawText = content.slice(node.range[0], node.range[1]);
    const trimmedText = rawText.trim();

    if (!this.shouldExtractText(trimmedText)) return;

    const candidate: ScanCandidate = {
      id: `${filePath}:${node.loc.start.line}`,
      kind: 'jsx-text' as CandidateKind,
      filePath,
      text: trimmedText,
      position: {
        line: node.loc.start.line,
        column: node.loc.start.column,
      },
      suggestedKey: this.generateKey(trimmedText),
      hash: this.hashText(trimmedText),
    };

    candidates.push(candidate);
  }

  private extractElementAttributes(node: any, content: string, filePath: string, candidates: ScanCandidate[]): void {
    if (!node.startTag || !node.startTag.attributes) return;

    for (const attr of node.startTag.attributes) {
      if (attr.type !== 'VAttribute' || !attr.key || !attr.value) continue;

      const attrName = attr.key.name?.name || attr.key.name;
      if (!attrName || typeof attrName !== 'string') continue;

      // Check if this attribute should be translated
      if (!this.isTranslatableAttribute(attrName)) continue;

      if (attr.value.type === 'VLiteral' && typeof attr.value.value === 'string') {
        const text = attr.value.value;
        if (this.shouldExtractText(text)) {
          const candidate: ScanCandidate = {
            id: `${filePath}:${attr.loc.start.line}`,
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

    // Check if explicitly translatable
    if (this.translatableAttributes.has(lowerAttr)) return true;

    // Check if matches any suffix pattern
    for (const suffix of this.attributeSuffixes) {
      if (lowerAttr.endsWith(suffix) || lowerAttr.endsWith(`-${suffix}`)) {
        return true;
      }
    }

    // Check if not in non-translatable list
    return !this.nonTranslatableAttributes.has(lowerAttr);
  }

  private shouldExtractText(text: string): boolean {
    const config: TextFilterConfig = {
      allowPatterns: this.allowPatterns,
      denyPatterns: this.denyPatterns,
      skipHexColors: false, // Vue doesn't typically have hex colors in templates
    };
    return shouldExtractText(text, config).shouldExtract;
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

  private applyCandidate(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Calculate byte positions from line/column
    const startPos = this.lineColumnToBytePosition(content, candidate.position.line, candidate.position.column);
    if (startPos === -1) return false;

    const endPos = startPos + candidate.text.length;

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
    // Replace text content with {{ $t('key') }}
    const translationCall = `{{ $t('${candidate.suggestedKey}') }}`;
    magicString.overwrite(startPos, endPos, translationCall);
    return true;
  }

  private transformAttribute(candidate: TransformCandidate, startPos: number, endPos: number, magicString: MagicString): boolean {
    // For Vue attributes, we need to replace the entire attribute with dynamic binding
    // e.g., placeholder="value" becomes :placeholder="$t('key')"
    const attrName = candidate.context || 'value';
    const translationCall = `:${attrName}="$t('${candidate.suggestedKey}')"`;

    // We need to find the full attribute range, not just the value
    // This is a simplified approach - in a real implementation, we'd need AST positions
    const content = magicString.original;
    const attrPattern = new RegExp(`${attrName}\\s*=\\s*["']${this.escapeRegExp(candidate.text)}["']`, 'g');
    const match = attrPattern.exec(content);

    if (match) {
      const attrStart = match.index;
      const attrEnd = attrStart + match[0].length;
      magicString.overwrite(attrStart, attrEnd, translationCall);
      return true;
    }

    return false;
  }

  private transformExpression(candidate: TransformCandidate, startPos: number, endPos: number, magicString: MagicString): boolean {
    // For expressions, wrap with $t()
    const translationCall = `$t('${candidate.suggestedKey}')`;
    magicString.overwrite(startPos, endPos, translationCall);
    return true;
  }

  private generateEdits(candidates: TransformCandidate[], originalContent: string, newContent: string): Array<{ start: number; end: number; replacement: string }> {
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
              ? `{{ $t('${candidate.suggestedKey}') }}`
              : `:${candidate.context || 'value'}="$t('${candidate.suggestedKey}')"`
          });
        }
      }
    }

    return edits;
  }
}