import path from 'path';
import {
  Node,
  Project,
  JsxAttribute,
  JsxExpression,
  JsxText,
  SourceFile,
  SyntaxKind,
} from 'ts-morph';
import fg from 'fast-glob';
import { I18nConfig } from './config.js';

export type CandidateKind = 'jsx-text' | 'jsx-attribute' | 'jsx-expression' | 'call-expression';

export interface ScanCandidate {
  id: string;
  filePath: string;
  kind: CandidateKind;
  text: string;
  context?: string;
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
  candidates: ScanCandidate[];
}

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

type CandidateRecorder = (candidate: ScanCandidate, node: Node, file: SourceFile) => void;

const TRANSLATABLE_ATTRIBUTES = new Set([
  'alt',
  'aria-label',
  'aria-placeholder',
  'helperText',
  'label',
  'placeholder',
  'title',
  'tooltip',
  'value',
]);

export class Scanner {
  private project: Project;
  private config: I18nConfig;
  private workspaceRoot: string;

  constructor(config: I18nConfig, options: ScannerOptions = {}) {
    this.config = config;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.project = options.project ?? new Project({
      skipAddingFilesFromTsConfig: true,
    });
  }

  public scan(): ScanSummary;
  public scan(options: ScanExecutionOptions & { collectNodes: true }): DetailedScanSummary;
  public scan(options?: ScanExecutionOptions): ScanSummary | DetailedScanSummary {
    const collectNodes = options?.collectNodes ?? false;
    const scanCalls = options?.scanCalls ?? false;
    const patterns = this.getGlobPatterns();
    const targetFiles = options?.targets?.length ? this.resolveTargetFiles(options.targets) : undefined;
    let files: SourceFile[];

    if (targetFiles?.length) {
      files = targetFiles.map((absolutePath) => {
        const existing = this.project.getSourceFile(absolutePath);
        return existing ?? this.project.addSourceFileAtPath(absolutePath);
      });
    } else {
      files = this.project.getSourceFiles();
      if (files.length === 0) {
        files = this.project.addSourceFilesAtPaths(patterns);
      }
    }

    const candidates: ScanCandidate[] = [];
    const detailedCandidates: ScannerNodeCandidate[] = [];

    const record: CandidateRecorder = (candidate, node, file) => {
      candidates.push(candidate);
      if (collectNodes) {
        detailedCandidates.push({
          ...candidate,
          node,
          sourceFile: file,
        });
      }
    };

    for (const file of files) {
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

    const summary: ScanSummary = {
      filesScanned: files.length,
      candidates,
    };

    if (files.length === 0) {
      console.warn('⚠️  Scanner found 0 files. Check your "include" patterns in i18n.config.json.');
      console.warn(`   Current patterns: ${patterns.join(', ')}`);
    }

    if (collectNodes) {
      return {
        ...summary,
        detailedCandidates,
      };
    }

    return summary;
  }

  private captureJsxText(node: JsxText, file: SourceFile, record: CandidateRecorder) {
    const text = this.normalizeText(node.getText());
    if (!text) {
      return;
    }

    record(this.createCandidate({
      node,
      file,
      kind: 'jsx-text',
      text,
      context: this.getJsxContext(node),
    }), node, file);
  }

  private captureJsxAttribute(node: JsxAttribute, file: SourceFile, record: CandidateRecorder) {
    const attributeName = node.getNameNode().getText();
    if (!TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
      return;
    }

    const initializer = node.getInitializer();
    if (!initializer) {
      return;
    }

    let value: string | undefined;

    if (Node.isStringLiteral(initializer)) {
      value = initializer.getLiteralText();
    } else if (Node.isJsxExpression(initializer)) {
      const expression = initializer.getExpression();
      if (expression && Node.isStringLiteral(expression)) {
        value = expression.getLiteralText();
      }
    }

    const text = this.normalizeText(value);
    if (!text) {
      return;
    }

    record(this.createCandidate({
      node,
      file,
      kind: 'jsx-attribute',
      text,
      context: `${attributeName} attribute`,
    }), node, file);
  }

  private captureJsxExpression(node: JsxExpression, file: SourceFile, record: CandidateRecorder) {
    const parent = node.getParent();
    if (Node.isJsxAttribute(parent)) {
      const attributeName = parent.getNameNode().getText();
      if (!TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
        return;
      }
    }

    const expression = node.getExpression();
    if (!expression || !Node.isStringLiteral(expression)) {
      return;
    }

    const text = this.normalizeText(expression.getLiteralText());
    if (!text) {
      return;
    }

    record(this.createCandidate({
      node,
      file,
      kind: 'jsx-expression',
      text,
      context: this.getJsxContext(node),
    }), node, file);
  }

  private captureCallExpression(node: Node, file: SourceFile, record: CandidateRecorder) {
    if (!Node.isCallExpression(node)) return;

    const identifier = this.config.sync?.translationIdentifier ?? 't';
    const expression = node.getExpression();
    if (!Node.isIdentifier(expression) || expression.getText() !== identifier) {
      return;
    }

    const [arg] = node.getArguments();
    if (!arg || !Node.isStringLiteral(arg)) {
      return;
    }

    const text = this.normalizeText(arg.getLiteralText());
    if (!text) {
      return;
    }

    // Only capture if it looks like a sentence (contains spaces)
    // This avoids capturing existing structured keys like 'common.title'
    if (!text.includes(' ')) {
      return;
    }

    record(this.createCandidate({
      node,
      file,
      kind: 'call-expression',
      text,
      context: 't() call',
    }), node, file);
  }

  private createCandidate(params: {
    node: Node;
    file: SourceFile;
    kind: CandidateKind;
    text: string;
    context?: string;
  }): ScanCandidate {
    const position = this.getNodePosition(params.node);
    const filePath = this.getRelativePath(params.file.getFilePath());

    return {
      id: `${filePath}:${position.line}:${position.column}`,
      filePath,
      kind: params.kind,
      text: params.text,
      context: params.context,
      position,
    };
  }

  private normalizeText(raw?: string): string | undefined {
    if (!raw) {
      return undefined;
    }

    const normalized = raw.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) {
      return undefined;
    }

    const minLength = this.config.minTextLength ?? 1;
    if (normalized.length < minLength) {
      return undefined;
    }

    return normalized;
  }

  private getJsxContext(node: Node): string | undefined {
    const openingElement = node.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement);
    if (!openingElement) {
      return undefined;
    }

    const tagNameNode = openingElement.getTagNameNode();
    return tagNameNode ? `<${tagNameNode.getText()}>` : undefined;
  }

  private getGlobPatterns(): string[] {
    const includes = Array.isArray(this.config.include) && this.config.include.length
      ? this.config.include
      : ['src/**/*.{ts,tsx,js,jsx}'];
    const excludes = this.config.exclude?.map((pattern) => `!${pattern}`) ?? [];
    return [...includes, ...excludes];
  }

  private resolveTargetFiles(targets: string[]): string[] {
    const normalizedPatterns = targets
      .flatMap((entry) => entry.split(',').map((token) => token.trim()))
      .filter(Boolean)
      .map((pattern) => (path.isAbsolute(pattern) ? pattern : path.join(this.workspaceRoot, pattern)));

    const matches = fg.sync(normalizedPatterns, {
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: true,
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
