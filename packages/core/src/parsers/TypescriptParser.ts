import path from "path";
import {
  Node,
  JsxAttribute,
  JsxExpression,
  JsxText,
  SourceFile,
  SyntaxKind,
  Project,
} from "ts-morph";
import { I18nConfig } from "../config.js";
import { createScannerProject } from "../project-factory.js";
import type { ScanCandidate, CandidateKind, SkipReason, SkippedCandidate } from "../scanner.js";
import type { FileParser } from "./FileParser.js";
import { DEFAULT_TRANSLATABLE_ATTRIBUTES } from "../scanner.js";

const LETTER_REGEX_GLOBAL = /\p{L}/gu;
const MAX_DIRECTIVE_COMMENT_DEPTH = 4;
const HTML_ENTITY_PATTERN = /^&[a-z][a-z0-9-]*;$/i;
const REPEATED_SYMBOL_PATTERN = /^([^\p{L}\d\s])\1{1,}$/u;
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export class TypescriptParser implements FileParser {
  private config: I18nConfig;
  private workspaceRoot: string;
  private allowPatterns: RegExp[];
  private denyPatterns: RegExp[];
  private preserveNewlines: boolean;
  private decodeHtmlEntities: boolean;
  private activeSkipLog?: SkippedCandidate[];
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
  }

  canHandle(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
  }

  parse(
    filePath: string,
    content: string,
    project?: Project,
    options: { scanCalls?: boolean; recordDetailed?: import('./FileParser.js').ParserNodeRecorder } = {}
  ): ScanCandidate[] {
    const scannerProject = project ?? createScannerProject();

    let sourceFile: SourceFile;
    let shouldForget = false;
    if (project) {
      // For tests with in-memory files, get from project or create from content
      const foundFile = project.getSourceFile(filePath) ?? project.getSourceFile(path.basename(filePath));
      if (foundFile) {
        sourceFile = foundFile;
      } else {
        sourceFile = project.createSourceFile(filePath, content, { overwrite: true });
        shouldForget = true;
      }
    } else {
      // For real files, add from path
      sourceFile = scannerProject.addSourceFileAtPath(filePath);
      shouldForget = true;
    }

  const candidates: ScanCandidate[] = [];
  const skipped: SkippedCandidate[] = [];
  this.activeSkipLog = skipped;

    const record = (candidate: ScanCandidate, node: Node, file: SourceFile) => {
      candidates.push(candidate);
      options.recordDetailed?.(candidate, node, file);
    };

    this.scanSourceFile(sourceFile, options.scanCalls ?? false, record);

    if (shouldForget) {
      sourceFile.forget();
    }
    this.activeSkipLog = undefined;
    this.lastSkipped = skipped;

    return candidates;
  }

  getSkippedCandidates(): SkippedCandidate[] {
    const skipped = this.lastSkipped;
    this.lastSkipped = [];
    return skipped;
  }

  private scanSourceFile(
    file: SourceFile,
    scanCalls: boolean,
    record: (candidate: ScanCandidate, node: Node, file: SourceFile) => void
  ) {
    file.forEachDescendant((node) => {
      if (Node.isJsxText(node)) {
        this.captureJsxText(node, file, record);
        return;
      }

      if (Node.isJsxAttribute(node)) {
        this.captureJsxAttribute(node, file, record);
        return;
      }

      if (Node.isJsxExpression(node)) {
        this.captureJsxExpression(node, file, record);
        return;
      }

      if (scanCalls && Node.isCallExpression(node)) {
        this.captureCallExpression(node, file, record);
      }
    });
  }

  private captureJsxText(
    node: JsxText,
    file: SourceFile,
    record: (candidate: ScanCandidate, node: Node, file: SourceFile) => void
  ) {
    const directive = this.getExtractionDirective(node);
    if (directive === "skip") {
      this.recordSkip("directive_skip", node, node.getText());
      return;
    }

    const forced = directive === "force";
    const text = this.normalizeText(node.getText(), { force: forced, node });
    if (!text) {
      return;
    }

    const candidate = this.createCandidate({
        node,
        file,
        kind: "jsx-text",
        text,
        context: this.getJsxContext(node),
        forced,
      });
    record(candidate, node, file);
  }

  private captureJsxAttribute(
    node: JsxAttribute,
    file: SourceFile,
    record: (candidate: ScanCandidate, node: Node, file: SourceFile) => void
  ) {
    const attributeName = node.getNameNode().getText();
    if (!DEFAULT_TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
      return;
    }

    const initializer = node.getInitializer();
    if (!initializer) {
      return;
    }

    let value: string | undefined;

    if (
      Node.isStringLiteral(initializer) ||
      Node.isNoSubstitutionTemplateLiteral(initializer)
    ) {
      value = initializer.getLiteralText();
    } else if (Node.isJsxExpression(initializer)) {
      const expression = initializer.getExpression();
      if (expression) {
        value = this.extractLiteralText(expression);
      }
    }

    const directive = this.getExtractionDirective(node);
    if (directive === "skip") {
      this.recordSkip("directive_skip", node, value);
      return;
    }

    const forced = directive === "force";
    const text = this.normalizeText(value, { force: forced, node });
    if (!text) {
      return;
    }

    const candidate = this.createCandidate({
        node,
        file,
        kind: "jsx-attribute",
        text,
        context: `${attributeName} attribute`,
        forced,
      });
    record(candidate, node, file);
  }

  private captureJsxExpression(
    node: JsxExpression,
    file: SourceFile,
    record: (candidate: ScanCandidate, node: Node, file: SourceFile) => void
  ) {
    if (this.isStyleJsxExpression(node)) {
      return;
    }

    const parent = node.getParent();
    if (Node.isJsxAttribute(parent)) {
      const attributeName = parent.getNameNode().getText();
      if (!DEFAULT_TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
        return;
      }
    }

    const expression = node.getExpression();
    if (!expression) {
      return;
    }

    const raw = this.extractLiteralText(expression);
    const directive = this.getExtractionDirective(node);
    if (directive === "skip") {
      this.recordSkip("directive_skip", node, raw);
      return;
    }

    const forced = directive === "force";
    const text = this.normalizeText(raw, { force: forced, node });
    if (!text) {
      return;
    }

    const candidate = this.createCandidate({
        node,
        file,
        kind: "jsx-expression",
        text,
        context: this.getJsxContext(node),
        forced,
      });
    record(candidate, node, file);
  }

  private captureCallExpression(
    node: Node,
    file: SourceFile,
    record: (candidate: ScanCandidate, node: Node, file: SourceFile) => void
  ) {
    if (!Node.isCallExpression(node)) return;

    const identifier = this.config.sync?.translationIdentifier ?? "t";
    const expression = node.getExpression();
    if (!this.isTranslationCallTarget(expression, identifier)) {
      return;
    }

    const [arg] = node.getArguments();
    if (!arg) {
      return;
    }

    const directive =
      this.getExtractionDirective(arg) ?? this.getExtractionDirective(node);
    const raw = this.extractLiteralText(arg);
    if (directive === "skip") {
      this.recordSkip("directive_skip", node, raw);
      return;
    }

    const forced = directive === "force";
    const text = this.normalizeText(raw, { force: forced, node });
    if (!text) {
      return;
    }

    // Only capture if it looks like a sentence (contains spaces)
    // This avoids capturing existing structured keys like 'common.title'
    if (!forced && !/\s/.test(text)) {
      this.recordSkip("non_sentence", node, text);
      return;
    }

    const candidate = this.createCandidate({
        node,
        file,
        kind: "call-expression",
        text,
        context: "t() call",
        forced,
      });
    record(candidate, node, file);
  }

  private extractLiteralText(node: Node | undefined): string | undefined {
    if (!node) {
      return undefined;
    }

    if (Node.isStringLiteral(node)) {
      return node.getLiteralText();
    }

    if (Node.isNoSubstitutionTemplateLiteral(node)) {
      return node.getLiteralText();
    }

    if (Node.isTemplateExpression(node)) {
      // Template expressions with placeholders represent dynamic text/keys.
      // We skip these because they cannot be safely treated as literals.
      return undefined;
    }

    if (Node.isBinaryExpression(node)) {
      const operator = node.getOperatorToken().getKind();
      if (operator === SyntaxKind.PlusToken) {
        const left = this.extractLiteralText(node.getLeft());
        const right = this.extractLiteralText(node.getRight());
        if (typeof left === "string" && typeof right === "string") {
          return left + right;
        }
      }
      return undefined;
    }

    if (
      Node.isParenthesizedExpression(node) ||
      Node.isAsExpression(node) ||
      Node.isNonNullExpression(node)
    ) {
      return this.extractLiteralText(node.getExpression());
    }

    return undefined;
  }

  private isTranslationCallTarget(node: Node, identifier: string): boolean {
    if (Node.isIdentifier(node)) {
      return node.getText() === identifier;
    }

    if (Node.isPropertyAccessExpression(node)) {
      if (node.getName() === identifier) {
        return true;
      }
      return this.isTranslationCallTarget(node.getExpression(), identifier);
    }

    if (Node.isElementAccessExpression(node)) {
      const argument = node.getArgumentExpression();
      if (
        argument &&
        Node.isStringLiteral(argument) &&
        argument.getLiteralText() === identifier
      ) {
        return true;
      }
      return this.isTranslationCallTarget(node.getExpression(), identifier);
    }

    if (
      Node.isNonNullExpression(node) ||
      Node.isParenthesizedExpression(node) ||
      Node.isAsExpression(node)
    ) {
      const inner = node.getExpression();
      return inner ? this.isTranslationCallTarget(inner, identifier) : false;
    }

    return false;
  }

  private createCandidate(params: {
    node: Node;
    file: SourceFile;
    kind: CandidateKind;
    text: string;
    context?: string;
    forced?: boolean;
  }): ScanCandidate {
    const position = this.getNodePosition(params.node);
    const filePath = this.getRelativePath(params.file.getFilePath());

    return {
      id: `${filePath}:${position.line}:${position.column}`,
      filePath,
      kind: params.kind,
      text: params.text,
      context: params.context,
      forced: params.forced,
      position,
    };
  }

  private recordSkip(reason: SkipReason, node?: Node, text?: string) {
    if (!this.activeSkipLog) {
      return;
    }

    const location = node
      ? {
          filePath: this.getRelativePath(node.getSourceFile().getFilePath()),
          ...this.getNodePosition(node),
        }
      : undefined;

    this.activeSkipLog.push({
      text,
      reason,
      location,
    });
  }

  private normalizeText(
    raw?: string,
    options: { force?: boolean; node?: Node } = {}
  ): string | undefined {
    if (typeof raw === "undefined") {
      this.recordSkip("non_literal", options.node);
      return undefined;
    }

    let text = raw;

    if (this.decodeHtmlEntities) {
      text = this.decodeEntities(text);
    }

    if (this.preserveNewlines) {
      text = text.replace(/\r\n?/g, "\n");
      text = text.replace(/[ \t\f\v]+/g, " ");
      text = text.replace(/ *\n */g, "\n");
    } else {
      text = text.replace(/\s+/g, " ");
    }

    text = text.trim();
    if (!text.length) {
      this.recordSkip("empty", options.node, text);
      return undefined;
    }

    const minLength = this.config.minTextLength ?? 1;
    if (!options.force && text.length < minLength) {
      this.recordSkip("below_min_length", options.node, text);
      return undefined;
    }

    const inclusion = this.shouldIncludeText(text, { forced: options.force });
    if (!inclusion.include) {
      this.recordSkip(
        inclusion.reason ?? "insufficient_letters",
        options.node,
        text
      );
      return undefined;
    }

    return text;
  }

  private shouldIncludeText(
    text: string,
    options: { forced?: boolean } = {}
  ): { include: boolean; reason?: SkipReason } {
    if (options.forced) {
      return { include: true };
    }

    if (this.matchesPattern(text, this.denyPatterns)) {
      return { include: false, reason: "denied_pattern" };
    }

    if (this.matchesPattern(text, this.allowPatterns)) {
      return { include: true };
    }

    if (HEX_COLOR_PATTERN.test(text)) {
      return { include: false, reason: "non_sentence" };
    }

    const letters = text.match(LETTER_REGEX_GLOBAL) || [];
    const letterCount = letters.length;
    const totalLength = text.length || 1;

    if (letterCount === 0) {
      return { include: false, reason: "no_letters" };
    }

    const minLetterCount = this.config.extraction?.minLetterCount ?? 2;
    const minLetterRatio = this.config.extraction?.minLetterRatio ?? 0.25;
    const letterRatio = letterCount / totalLength;

    if (letterCount <= 1 && totalLength <= 2) {
      return { include: false, reason: "insufficient_letters" };
    }

    if (letterCount < minLetterCount && letterRatio < minLetterRatio) {
      return { include: false, reason: "insufficient_letters" };
    }

    if (!this.hasMeaningfulTextShape(text)) {
      return { include: false, reason: "non_sentence" };
    }

    return { include: true };
  }

  private matchesPattern(text: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(text));
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
      .map((token) =>
        token
          .replace(/^[^\p{L}]+/u, "")
          .replace(/[^\p{L}]+$/u, "")
      )
      .filter(Boolean);

    if (!sanitizedTokens.length) {
      return false;
    }

    const longestToken = sanitizedTokens.reduce(
      (max, token) => Math.max(max, token.length),
      0
    );
    const letterTotal = sanitizedTokens.reduce(
      (sum, token) => sum + token.length,
      0
    );

    const hasMeaningfulWord =
      longestToken >= 4 || (rawTokens.length >= 2 && longestToken >= 3);

    const symbolCount = (trimmed.match(/[\p{S}\p{P}]/gu) ?? []).length;
    if (symbolCount && symbolCount / Math.max(trimmed.length, 1) >= 0.6) {
      if (longestToken < 4) {
        return false;
      }
    }

    if (rawTokens.length === 1) {
      const cleaned = sanitizedTokens[0];
      if (cleaned.length <= 2) {
        return false;
      }
      if (/^[\p{Lu}\d]+$/u.test(cleaned) && cleaned.length <= 4) {
        return false;
      }
    }

    if (!hasMeaningfulWord && letterTotal < 6) {
      return false;
    }

    return true;
  }

  private compilePatterns(patterns?: string[]): RegExp[] {
    if (!patterns?.length) {
      return [];
    }

    const result: RegExp[] = [];
    for (const pattern of patterns) {
      try {
        result.push(new RegExp(pattern));
      } catch (error) {
        console.warn(
          `⚠️  Invalid extraction pattern "${pattern}": ${(error as Error).message}`
        );
      }
    }
    return result;
  }

  private decodeEntities(text: string): string {
    const namedEntities: Record<string, string> = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
      nbsp: ' ',
      ldquo: '“',
      rdquo: '”',
      lsquo: '‘',
      rsquo: '’',
      mdash: '—',
      ndash: '–',
      hellip: '…',
      middot: '·',
      copy: '©',
      reg: '®',
      trade: '™',
      bull: '•',
    };

    return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const isHex = entity[1]?.toLowerCase() === "x";
        const codePoint = isHex
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      const normalized = entity.toLowerCase();
      return normalized in namedEntities ? namedEntities[normalized] : match;
    });
  }

  private getExtractionDirective(node?: Node): "skip" | "force" | undefined {
    if (!node) {
      return undefined;
    }

    let current: Node | undefined = node;
    let depth = 0;
    while (current && depth <= MAX_DIRECTIVE_COMMENT_DEPTH) {
      const commentDirective = this.getCommentDirective(current);
      if (commentDirective) {
        return commentDirective;
      }
      if (Node.isSourceFile(current)) {
        break;
      }
      current = current.getParent();
      depth += 1;
    }

    return this.getJsxDirective(node);
  }

  private getCommentDirective(node: Node): "skip" | "force" | undefined {
    const ranges = [
      ...node.getLeadingCommentRanges(),
      ...node.getTrailingCommentRanges(),
    ];

    for (const range of ranges) {
      const text = range.getText();
      if (/i18n:skip/i.test(text)) {
        return "skip";
      }
      if (/i18n:force-extract/i.test(text)) {
        return "force";
      }
    }

    return undefined;
  }

  private getJsxDirective(node: Node): "skip" | "force" | undefined {
    const jsxAncestor = node.getFirstAncestor(
      (ancestor) =>
        Node.isJsxElement(ancestor) || Node.isJsxSelfClosingElement(ancestor)
    );
    if (!jsxAncestor) {
      return undefined;
    }

    if (Node.isJsxElement(jsxAncestor)) {
      const attributes = jsxAncestor.getOpeningElement().getAttributes();
      return this.getDirectiveFromAttributes(attributes);
    }

    if (Node.isJsxSelfClosingElement(jsxAncestor)) {
      return this.getDirectiveFromAttributes(jsxAncestor.getAttributes());
    }

    return undefined;
  }

  private getDirectiveFromAttributes(
    attributes: readonly Node[]
  ): "skip" | "force" | undefined {
    for (const attribute of attributes) {
      if (!Node.isJsxAttribute(attribute)) {
        continue;
      }
      const name = attribute.getNameNode().getText();
      if (name === "data-i18n-skip") {
        return "skip";
      }
      if (name === "data-i18n-force-extract") {
        return "force";
      }
    }
    return undefined;
  }

  private getJsxContext(node: Node): string | undefined {
    const openingElement = node.getFirstAncestorByKind(
      SyntaxKind.JsxOpeningElement
    );
    if (!openingElement) {
      return undefined;
    }

    const tagNameNode = openingElement.getTagNameNode();
    return tagNameNode ? `<${tagNameNode.getText()}>` : undefined;
  }

  private isStyleJsxExpression(node: JsxExpression): boolean {
    const jsxAncestor = node.getFirstAncestor((ancestor) =>
      Node.isJsxElement(ancestor) || Node.isJsxSelfClosingElement(ancestor)
    );

    if (!jsxAncestor) {
      return false;
    }

    const openingElement = Node.isJsxElement(jsxAncestor)
      ? jsxAncestor.getOpeningElement()
      : jsxAncestor;

    const tagName = openingElement.getTagNameNode().getText().toLowerCase();
    if (tagName !== 'style') {
      return false;
    }

    return openingElement.getAttributes().some((attribute: Node) => {
      return Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === 'jsx';
    });
  }

  private getRelativePath(filePath: string): string {
    const relative = path.relative(this.workspaceRoot, filePath);
    return relative || filePath;
  }

  private getNodePosition(node: Node) {
    const sourceFile = node.getSourceFile();
    const { line, column } = sourceFile.getLineAndColumnAtPos(node.getStart());
    return { line, column };
  }
}