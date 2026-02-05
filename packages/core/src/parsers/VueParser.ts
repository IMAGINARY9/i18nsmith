import path from "path";

// Runtime loader for the optional `vue-eslint-parser`.
// We use `eval('require')` to avoid static bundlers hoisting or resolving the
// dependency at build time — we only attempt to require it at runtime when
// actually needed, and we handle the case where it isn't installed.
let _cachedVueParser: any | undefined;
let _vueParserMissingWarned = false;
function getVueEslintParser(): any | null {
  if (_cachedVueParser !== undefined) return _cachedVueParser;
  try {
    // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval
    _cachedVueParser = eval('require')('vue-eslint-parser');
    return _cachedVueParser;
  } catch {
    _cachedVueParser = null;
    return null;
  }
}
import type { Project } from "ts-morph";
import { I18nConfig } from "../config.js";
import type { ScanCandidate, CandidateKind, SkipReason, SkippedCandidate } from "../scanner.js";
import type { FileParser } from "./FileParser.js";

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
  'value',  // value is tricky - often not translatable in forms
  'is',
  'v-if',
  'v-else',
  'v-else-if',
  'v-for',
  'v-show',
  'v-model',
  'v-bind',
  'v-on',
  'v-slot',
  'slot',
  'xmlns',
  'viewBox',
  'd',  // SVG path
  'fill',
  'stroke',
  'transform',
]);

export class VueParser implements FileParser {
  private config: I18nConfig;
  private workspaceRoot: string;
  private allowPatterns: RegExp[];
  private denyPatterns: RegExp[];
  private preserveNewlines: boolean;
  private decodeHtmlEntities: boolean;
  private activeSkipLog?: SkippedCandidate[];
  private readonly translatableAttributes: Set<string>;
  private readonly nonTranslatableAttributes: Set<string>;
  private readonly attributeSuffixes: string[];
  private seenCandidateIds: Set<string> = new Set();
  private lastSkipped: SkippedCandidate[] = [];

  constructor(config: I18nConfig, workspaceRoot: string) {
    this.config = config;
    this.workspaceRoot = workspaceRoot;
    this.allowPatterns = this.compilePatterns(
      this.config.extraction?.allowPatterns
    );
    this.denyPatterns = this.compilePatterns(
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

  canHandle(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.vue';
  }

  parse(
    filePath: string,
    content: string,
    _project?: Project,
    _options: { scanCalls?: boolean; recordDetailed?: import('./FileParser.js').ParserNodeRecorder } = {}
  ): ScanCandidate[] {
    const candidates: ScanCandidate[] = [];
    this.activeSkipLog = [];
    this.seenCandidateIds.clear();

    try {
      const vueEslintParser = getVueEslintParser();
      if (!vueEslintParser || typeof vueEslintParser.parse !== 'function') {
        if (!_vueParserMissingWarned) {
          _vueParserMissingWarned = true;
          console.warn('[i18nsmith] vue-eslint-parser is not installed. Vue SFC parsing will use a fallback extractor. Install it for better accuracy.');
        }
        // Fallback: no parser available - use a minimal text-based extraction
        // so the extension still works when the optional dependency isn't
        // installed in the runtime environment.
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
      this.extractFromTemplate(ast.templateBody, content, filePath, candidates);

      // Extract candidates from script (if it exists)
      if (ast.body) {
        for (const node of ast.body) {
          this.extractFromScript(node, content, filePath, candidates);
        }
      }
    } catch (error) {
      console.warn(`Failed to parse Vue file ${filePath}:`, error);
      // Fallback to basic text extraction
      this.extractFromContent(content, filePath, candidates);
    }

    this.lastSkipped = this.activeSkipLog ?? [];
    this.activeSkipLog = undefined;
    return candidates;
  }

  getSkippedCandidates(): SkippedCandidate[] {
    const skipped = this.lastSkipped;
    this.lastSkipped = [];
    return skipped;
  }

  private extractFromTemplate(templateBody: any, content: string, filePath: string, candidates: ScanCandidate[]) {
    if (!templateBody) return;

    // Walk the template AST
    this.walkTemplateNode(templateBody, content, filePath, candidates);
  }

  private walkTemplateNode(node: any, content: string, filePath: string, candidates: ScanCandidate[]) {
    if (!node) return;

    switch (node.type) {
      case 'VText':
        // Text content in templates
        if (node.value && node.value.trim()) {
          this.addCandidate('jsx-text', node.value, node.loc, filePath, candidates);
        }
        break;

      case 'VAttribute':
        // Attribute values - only extract from translatable attributes
        if (node.value && node.value.type === 'VLiteral' && node.value.value) {
          const attrName = this.getAttributeName(node);
          if (this.isTranslatableAttribute(attrName)) {
            // For attributes, adjust the position to point to the text content, not the quotes
            const adjustedLoc = {
              start: {
                line: node.value.loc.start.line,
                column: node.value.loc.start.column + 1, // Skip opening quote
              },
              end: {
                line: node.value.loc.end.line,
                column: node.value.loc.end.column - 1, // Skip closing quote
              }
            };
            this.addCandidate('jsx-attribute', node.value.value, adjustedLoc, filePath, candidates);
          }
        }
        break;

      case 'VExpressionContainer':
        // Expressions in {{ }}
        if (node.expression && node.expression.type === 'Literal' && node.expression.value) {
          this.addCandidate('jsx-expression', node.expression.value, node.expression.loc, filePath, candidates);
        }
        break;
    }

    // Walk children
    if (node.children) {
      for (const child of node.children) {
        this.walkTemplateNode(child, content, filePath, candidates);
      }
    }

    // Walk attributes
    if (node.startTag && node.startTag.attributes) {
      for (const attr of node.startTag.attributes) {
        this.walkTemplateNode(attr, content, filePath, candidates);
      }
    }
  }

  /**
   * Get the attribute name from a VAttribute node
   */
  private getAttributeName(node: any): string {
    if (node.key) {
      // Regular attribute: key.name
      if (node.key.name) {
        return node.key.name;
      }
      // Directive: v-bind:name or :name
      if (node.key.argument && node.key.argument.name) {
        return node.key.argument.name;
      }
    }
    return '';
  }

  /**
   * Check if an attribute typically contains translatable text
   */
  private isTranslatableAttribute(attrName: string): boolean {
    if (!attrName) return false;
    
    const normalizedName = attrName.toLowerCase();
    
    // Explicitly non-translatable attributes
    if (this.nonTranslatableAttributes.has(normalizedName)) {
      return false;
    }
    
    // Explicitly translatable attributes
    if (this.translatableAttributes.has(normalizedName)) {
      return true;
    }
    
    // Heuristics for unknown attributes:
    // - Attributes ending with common translatable suffixes
    if (this.attributeSuffixes.some((suffix) => normalizedName.endsWith(suffix))) {
      return true;
    }
    
    // Default: don't extract unknown attributes to avoid false positives
    return false;
  }

  private extractFromScript(component: any, content: string, filePath: string, candidates: ScanCandidate[]) {
    // Extract from computed properties, methods, etc.
    // This is a simplified implementation - could be enhanced
    this.walkScriptNode(component, content, filePath, candidates, new WeakSet());
  }

  private walkScriptNode(
    node: any,
    content: string,
    filePath: string,
    candidates: ScanCandidate[],
    visited: WeakSet<object>
  ) {
    if (!node) return;

    if (typeof node === 'object') {
      if (visited.has(node)) {
        return;
      }
      visited.add(node);
    }

    if (node.type === 'Literal' && typeof node.value === 'string' && node.value.trim()) {
      this.addCandidate('call-expression', node.value, node.loc, filePath, candidates);
    }

    // Generic AST traversal for script nodes
    for (const value of Object.values(node)) {
      if (!value || value === node) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && typeof entry === 'object' && 'type' in entry) {
            this.walkScriptNode(entry, content, filePath, candidates, visited);
          }
        }
        continue;
      }

      if (typeof value === 'object' && 'type' in value) {
        this.walkScriptNode(value, content, filePath, candidates, visited);
      }
    }
  }

  private extractFromContent(content: string, filePath: string, candidates: ScanCandidate[]) {
    // Fallback: extract text from template sections
    const templateRegex = /<template[^>]*>([\s\S]*?)<\/template>/g;
    let match;

    while ((match = templateRegex.exec(content)) !== null) {
      const templateContent = match[1];
      const templateStart = match.index + match[0].indexOf(templateContent);
      const textBetweenTags = />[^<]+</g;
      let textMatch;

      while ((textMatch = textBetweenTags.exec(templateContent)) !== null) {
        const rawText = textMatch[0].slice(1, -1);
        if (!rawText.trim()) {
          continue;
        }

        const segmentRegex = /\{\{[\s\S]*?\}\}/g;
        let segmentStart = 0;
        let segmentMatch;

        while ((segmentMatch = segmentRegex.exec(rawText)) !== null) {
          const segment = rawText.slice(segmentStart, segmentMatch.index);
          if (segment.trim()) {
            const absoluteIndex = templateStart + textMatch.index + 1 + segmentStart;
            const position = this.getPositionFromIndex(content, absoluteIndex);
            this.addCandidate('jsx-text', segment, {
              start: position,
              end: { line: position.line, column: position.column + segment.length }
            }, filePath, candidates);
          }
          segmentStart = segmentMatch.index + segmentMatch[0].length;
        }

        const tail = rawText.slice(segmentStart);
        if (tail.trim()) {
          const absoluteIndex = templateStart + textMatch.index + 1 + segmentStart;
          const position = this.getPositionFromIndex(content, absoluteIndex);
          this.addCandidate('jsx-text', tail, {
            start: position,
            end: { line: position.line, column: position.column + tail.length }
          }, filePath, candidates);
        }
      }
    }

    // Fallback: extract string literals from script blocks
    const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
    let scriptMatch;
    while ((scriptMatch = scriptRegex.exec(content)) !== null) {
      const scriptContent = scriptMatch[1];
      const scriptStart = scriptMatch.index + scriptMatch[0].indexOf(scriptContent);
      const stringLiteralRegex = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
      let literalMatch;

      while ((literalMatch = stringLiteralRegex.exec(scriptContent)) !== null) {
        const value = literalMatch[2];
        if (!value.trim()) {
          continue;
        }
        const startIndex = scriptStart + literalMatch.index + 1;
        const position = this.getPositionFromIndex(content, startIndex);
        this.addCandidate('call-expression', value, {
          start: position,
          end: { line: position.line, column: position.column + value.length }
        }, filePath, candidates);
      }
    }

    // Fallback: extract i18n calls using regex (e.g. $t('key'), t('key'))
    // Supports: $t('key'), t('key'), i18n.t('key'), this.$t('key')
    const i18nCallRegex = /(?:(?:\$t|t|i18n\.t|this\.\$t)\s*\(\s*)(['"`])(.*?)\1(?:\s*\))/g;
    let callMatch;
    while ((callMatch = i18nCallRegex.exec(content)) !== null) {
        const fullMatch = callMatch[0];
        const quote = callMatch[1];
        const key = callMatch[2];
        const startIndex = callMatch.index + fullMatch.indexOf(quote) + 1; // Start of the key string
        
        const position = this.getPositionFromIndex(content, startIndex);
        
        // We use a simplified location for fallback
        const loc = {
            start: position,
            end: { line: position.line, column: position.column + key.length }
        };

        this.addCandidate('call-expression', key, loc, filePath, candidates);
    }
  }

  private addCandidate(kind: CandidateKind, text: string, loc: any, filePath: string, candidates: ScanCandidate[]) {
    const cleanText = this.cleanText(text);
    if (!cleanText) return;

    // Check patterns
    if (!this.matchesAllowPatterns(cleanText)) return;
    if (this.matchesDenyPatterns(cleanText)) return;

    // Basic validation
    if (this.shouldSkip(cleanText)) return;

    const id = `${filePath}:${loc.start.line}:${loc.start.column}:${kind}`;
    if (this.seenCandidateIds.has(id)) {
      return;
    }
    this.seenCandidateIds.add(id);
    const position = {
      line: loc.start.line,
      column: loc.start.column,
    };

    candidates.push({
      id,
      filePath,
      kind,
      text: cleanText,
      position,
    });
  }

  private cleanText(text: string): string {
    let cleaned = text.trim();

    if (!this.preserveNewlines) {
      cleaned = cleaned.replace(/\s+/g, ' ');
    }

    if (this.decodeHtmlEntities) {
      // Basic HTML entity decoding
      cleaned = cleaned
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }

    return cleaned;
  }

  private matchesAllowPatterns(text: string): boolean {
    if (this.allowPatterns.length === 0) return true;
    return this.allowPatterns.some(pattern => pattern.test(text));
  }

  private matchesDenyPatterns(text: string): boolean {
    return this.denyPatterns.some(pattern => pattern.test(text));
  }

  private shouldSkip(text: string): boolean {
    // Basic validation logic similar to TypescriptParser
    if (!text || text.length === 0) {
      this.logSkip(text, 'empty');
      return true;
    }

    const minTextLength = (this.config.extraction as { minTextLength?: number } | undefined)?.minTextLength
      ?? this.config.minTextLength
      ?? 1;
    if (text.length < minTextLength) {
      this.logSkip(text, 'below_min_length');
      return true;
    }

    const letters = text.match(LETTER_REGEX_GLOBAL) || [];
    const letterCount = letters.length;
    const totalLength = text.length;

    if (letterCount === 0) {
      this.logSkip(text, 'no_letters');
      return true;
    }

  const minLetterCount = this.config.extraction?.minLetterCount ?? 2;
  const minLetterRatio = this.config.extraction?.minLetterRatio ?? 0.25;

    const letterRatio = letterCount / totalLength;

    if (letterCount <= 1 && totalLength <= 2) {
      this.logSkip(text, 'insufficient_letters');
      return true;
    }

    if (letterCount < minLetterCount && letterRatio < minLetterRatio) {
      this.logSkip(text, 'insufficient_letters');
      return true;
    }

    if (HTML_ENTITY_PATTERN.test(text)) {
      this.logSkip(text, 'non_literal');
      return true;
    }

    if (REPEATED_SYMBOL_PATTERN.test(text)) {
      this.logSkip(text, 'non_literal');
      return true;
    }

    if (!this.hasMeaningfulTextShape(text)) {
      this.logSkip(text, 'non_sentence');
      return true;
    }

    return false;
  }

  private logSkip(text: string, reason: SkipReason) {
    if (this.activeSkipLog) {
      this.activeSkipLog.push({
        text,
        reason,
      });
    }
  }

  private hasMeaningfulTextShape(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    if (HTML_ENTITY_PATTERN.test(trimmed)) {
      return false;
    }

    if (REPEATED_SYMBOL_PATTERN.test(trimmed)) {
      return false;
    }

    const rawTokens = trimmed.split(/\s+/).filter(Boolean);
    if (!rawTokens.length) {
      return false;
    }

    const sanitizedTokens = rawTokens
      .map((token) => token.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''))
      .filter(Boolean);

    if (!sanitizedTokens.length) {
      return false;
    }

    // Allow single tokens that are at least 3 characters (covers "Alpha", "Beta", etc.)
    // or multiple tokens where at least one is word-like
    if (sanitizedTokens.length === 1) {
      return sanitizedTokens[0].length >= 3;
    }

    const wordLikeTokens = sanitizedTokens.filter((token) => /[\p{L}\d]{2,}/u.test(token));
    return wordLikeTokens.length > 0;
  }

  private compilePatterns(patterns?: string[]): RegExp[] {
    if (!patterns) return [];
    return patterns.map(pattern => new RegExp(pattern, 'u'));
  }

  private getPositionFromIndex(content: string, index: number): { line: number; column: number } {
    const lines = content.substring(0, index).split('\n');
    return {
      line: lines.length,  // 1-based line (ESTree standard)
      column: lines[lines.length - 1].length,  // 0-based column (ESTree standard, matching vue-eslint-parser)
    };
  }
}