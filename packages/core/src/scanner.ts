import path from "path";
import {
  Node,
  Project,
  JsxAttribute,
  JsxExpression,
  JsxText,
  SourceFile,
  SyntaxKind,
} from "ts-morph";
import fg from "fast-glob";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, I18nConfig } from "./config.js";
import { createScannerProject } from "./project-factory.js";

export type CandidateKind =
  | "jsx-text"
  | "jsx-attribute"
  | "jsx-expression"
  | "call-expression";

export type SkipReason =
  | "non_literal"
  | "empty"
  | "below_min_length"
  | "denied_pattern"
  | "no_letters"
  | "insufficient_letters"
  | "non_sentence"
  | "directive_skip";

export interface SkippedCandidate {
  text?: string;
  reason: SkipReason;
  location?: {
    filePath: string;
    line: number;
    column: number;
  };
}

export interface ScanBuckets {
  highConfidence: ScanCandidate[];
  needsReview: ScanCandidate[];
  skipped: SkippedCandidate[];
}

export interface ScanCandidate {
  id: string;
  filePath: string;
  kind: CandidateKind;
  text: string;
  context?: string;
  forced?: boolean;
  /**
   * Optional fields populated by downstream tooling (e.g., transformer)
   * to keep key suggestions close to the source candidate.
   */
  suggestedKey?: string;
  hash?: string;
  position: {
    line: number;
    column: number;
  };
}

export interface ScanSummary {
  filesScanned: number;
  filesExamined: string[];
  candidates: ScanCandidate[];
  buckets: ScanBuckets;
}

type GlobPatterns = {
  include: string[];
  exclude: string[];
};

export interface ScannerNodeCandidate extends ScanCandidate {
  node: Node;
  sourceFile: SourceFile;
}

export interface DetailedScanSummary extends ScanSummary {
  detailedCandidates: ScannerNodeCandidate[];
}

export interface ScannerOptions {
  workspaceRoot?: string;
  project?: Project;
}

export interface ScanExecutionOptions {
  collectNodes?: boolean;
  targets?: string[];
  scanCalls?: boolean;
}

type CandidateRecorder = (
  candidate: ScanCandidate,
  node: Node,
  file: SourceFile
) => void;

const TRANSLATABLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "aria-placeholder",
  "helperText",
  "label",
  "placeholder",
  "title",
  "tooltip",
  "value",
]);

const LETTER_REGEX_GLOBAL = /\p{L}/gu;
const MAX_DIRECTIVE_COMMENT_DEPTH = 4;
const HTML_ENTITY_PATTERN = /^&[a-z][a-z0-9-]*;$/i;
const REPEATED_SYMBOL_PATTERN = /^([^\p{L}\d\s])\1{1,}$/u;

export class Scanner {
  private project: Project;
  private config: I18nConfig;
  private workspaceRoot: string;
  private allowPatterns: RegExp[];
  private denyPatterns: RegExp[];
  private preserveNewlines: boolean;
  private decodeHtmlEntities: boolean;
  private activeSkipLog?: SkippedCandidate[];
  private readonly usesExternalProject: boolean;

  constructor(config: I18nConfig, options: ScannerOptions = {}) {
    this.config = config;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.project = options.project ?? this.createProject();
    this.usesExternalProject = Boolean(options.project);
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

  public scan(): ScanSummary;
  public scan(
    options: ScanExecutionOptions & { collectNodes: true }
  ): DetailedScanSummary;
  public scan(options: ScanExecutionOptions): ScanSummary;
  public scan(
    options?: ScanExecutionOptions
  ): ScanSummary | DetailedScanSummary {
    const collectNodes = options?.collectNodes ?? false;
    const scanCalls = options?.scanCalls ?? false;
    if (!this.usesExternalProject) {
      this.project = this.createProject();
    }
    const patterns = this.getGlobPatterns();
    const targetFiles = options?.targets?.length
      ? this.resolveTargetFiles(options.targets)
      : undefined;
    const shouldStream = this.shouldStreamFiles(collectNodes);
    const filesExamined: string[] = [];
    let filesScanned = 0;

    const candidates: ScanCandidate[] = [];
    const detailedCandidates: ScannerNodeCandidate[] = [];
    const buckets: ScanBuckets = {
      highConfidence: [],
      needsReview: [],
      skipped: [],
    };

    this.activeSkipLog = buckets.skipped;

    const record: CandidateRecorder = (candidate, node, file) => {
      candidates.push(candidate);
      const bucket = this.getConfidenceBucket(candidate);
      if (bucket === "high") {
        buckets.highConfidence.push(candidate);
      } else {
        buckets.needsReview.push(candidate);
      }
      if (collectNodes) {
        detailedCandidates.push({
          ...candidate,
          node,
          sourceFile: file,
        });
      }
    };

    if (shouldStream) {
      const streamPaths = targetFiles?.length
        ? targetFiles
        : this.resolveWorkspaceFiles(patterns);
      const examined = this.streamAndScanFiles(streamPaths, scanCalls, record);
      filesExamined.push(...examined);
      filesScanned = examined.length;
    } else {
      const projectFiles: SourceFile[] = this.loadProjectFiles(
        targetFiles,
        patterns
      );
      this.scanSourceFiles(projectFiles, scanCalls, record);
      filesExamined.push(
        ...projectFiles.map((file) => this.getRelativePath(file.getFilePath()))
      );
      filesScanned = projectFiles.length;
    }

    this.activeSkipLog = undefined;

    const summary: ScanSummary = {
      filesScanned,
      filesExamined,
      candidates,
      buckets,
    };

    if (filesScanned === 0) {
      console.warn(
        '⚠️  Scanner found 0 files. Check your "include" patterns in i18n.config.json.'
      );
      const includeList = patterns.include.length
        ? patterns.include.join(", ")
        : "(none)";
      const excludeList = patterns.exclude.length
        ? patterns.exclude.join(", ")
        : "(none)";
      console.warn(`   Include patterns: ${includeList}`);
      console.warn(`   Exclude patterns: ${excludeList}`);
    }

    if (collectNodes) {
      return {
        ...summary,
        detailedCandidates,
      };
    }

    return summary;
  }

  private captureJsxText(
    node: JsxText,
    file: SourceFile,
    record: CandidateRecorder
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

    record(
      this.createCandidate({
        node,
        file,
        kind: "jsx-text",
        text,
        context: this.getJsxContext(node),
        forced,
      }),
      node,
      file
    );
  }

  private captureJsxAttribute(
    node: JsxAttribute,
    file: SourceFile,
    record: CandidateRecorder
  ) {
    const attributeName = node.getNameNode().getText();
    if (!TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
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

    record(
      this.createCandidate({
        node,
        file,
        kind: "jsx-attribute",
        text,
        context: `${attributeName} attribute`,
        forced,
      }),
      node,
      file
    );
  }

  private captureJsxExpression(
    node: JsxExpression,
    file: SourceFile,
    record: CandidateRecorder
  ) {
    const parent = node.getParent();
    if (Node.isJsxAttribute(parent)) {
      const attributeName = parent.getNameNode().getText();
      if (!TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
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

    record(
      this.createCandidate({
        node,
        file,
        kind: "jsx-expression",
        text,
        context: this.getJsxContext(node),
        forced,
      }),
      node,
      file
    );
  }

  private captureCallExpression(
    node: Node,
    file: SourceFile,
    record: CandidateRecorder
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

    record(
      this.createCandidate({
        node,
        file,
        kind: "call-expression",
        text,
        context: "t() call",
        forced,
      }),
      node,
      file
    );
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

  private getConfidenceBucket(candidate: ScanCandidate): "high" | "review" {
    if (candidate.forced) {
      return "review";
    }

    if (this.matchesPattern(candidate.text, this.allowPatterns)) {
      return "high";
    }

    const letters = candidate.text.match(LETTER_REGEX_GLOBAL) || [];
    const letterCount = letters.length;
    const totalLength = candidate.text.length || 1;
    const letterRatio = letterCount / totalLength;

    const minLetterCount = this.config.extraction?.minLetterCount ?? 2;
    const minLetterRatio = this.config.extraction?.minLetterRatio ?? 0.25;

    const elevatedCountThreshold = Math.max(
      minLetterCount * 2,
      minLetterCount + 3
    );
    const elevatedRatioThreshold = Math.min(0.85, minLetterRatio + 0.35);

    if (letterCount >= elevatedCountThreshold) {
      return "high";
    }

    if (
      letterRatio >= elevatedRatioThreshold &&
      letterCount >= minLetterCount
    ) {
      return "high";
    }

    if (letterCount >= minLetterCount + 2 && letterRatio >= minLetterRatio) {
      return "high";
    }

    return "review";
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

  private getGlobPatterns(): GlobPatterns {
    const include =
      Array.isArray(this.config.include) && this.config.include.length
        ? this.config.include
        : DEFAULT_INCLUDE;
    const exclude = Array.isArray(this.config.exclude)
      ? this.config.exclude
      : DEFAULT_EXCLUDE;
    return { include, exclude };
  }

  private shouldStreamFiles(collectNodes: boolean): boolean {
    return !collectNodes && !this.usesExternalProject;
  }

  private streamAndScanFiles(
    filePaths: string[],
    scanCalls: boolean,
    record: CandidateRecorder
  ): string[] {
    const examined: string[] = [];

    for (const absolutePath of filePaths) {
      const sourceFile = this.project.addSourceFileAtPath(absolutePath);
      examined.push(this.getRelativePath(absolutePath));
      this.scanSourceFile(sourceFile, scanCalls, record);
      sourceFile.forget();
    }

    return examined;
  }

  private loadProjectFiles(
    targetFiles: string[] | undefined,
    patterns: GlobPatterns
  ): SourceFile[] {
    if (targetFiles?.length) {
      return targetFiles.map((absolutePath) =>
        this.addOrGetSourceFile(absolutePath)
      );
    }

    if (this.usesExternalProject) {
      let files = this.project.getSourceFiles();
      if (!files.length) {
        const workspacePaths = this.resolveWorkspaceFiles(patterns);
        files = workspacePaths.map((absolutePath) =>
          this.addOrGetSourceFile(absolutePath)
        );
      }
      return files;
    }
    const workspacePaths = this.resolveWorkspaceFiles(patterns);
    return workspacePaths.map((absolutePath) =>
      this.addOrGetSourceFile(absolutePath)
    );
  }

  private createProject(): Project {
    return createScannerProject();
  }

  private addOrGetSourceFile(absolutePath: string): SourceFile {
    const existing = this.project.getSourceFile(absolutePath);
    return existing ?? this.project.addSourceFileAtPath(absolutePath);
  }

  private scanSourceFiles(
    files: SourceFile[],
    scanCalls: boolean,
    record: CandidateRecorder
  ) {
    for (const file of files) {
      this.scanSourceFile(file, scanCalls, record);
    }
  }

  private scanSourceFile(
    file: SourceFile,
    scanCalls: boolean,
    record: CandidateRecorder
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

  private resolveWorkspaceFiles(patterns: GlobPatterns): string[] {
    const includePatterns = patterns.include.length
      ? patterns.include
      : DEFAULT_INCLUDE;
    const excludePatterns = patterns.exclude.length ? patterns.exclude : [];

    const matches = fg.sync(includePatterns, {
      cwd: this.workspaceRoot,
      ignore: excludePatterns,
      onlyFiles: true,
      unique: true,
      absolute: true,
      followSymbolicLinks: true,
    }) as string[];

    return matches.sort((a, b) => a.localeCompare(b));
  }

  private resolveTargetFiles(targets: string[]): string[] {
    const normalizedPatterns = targets
      .flatMap((entry) => entry.split(",").map((token) => token.trim()))
      .filter(Boolean)
      .map((pattern) =>
        path.isAbsolute(pattern)
          ? pattern
          : path.join(this.workspaceRoot, pattern)
      );

    // Important: targets are still subject to config exclude globs.
    // Otherwise, running transforms/syncs on explicit targets could mutate files the
    // user intentionally excluded (e.g., legal pages).
    const patterns = this.getGlobPatterns();
    const matches = fg.sync(normalizedPatterns, {
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: true,
      ignore: patterns.exclude ?? [],
    }) as string[];

    return matches.sort((a, b) => a.localeCompare(b));
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
