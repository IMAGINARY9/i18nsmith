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
import { I18nConfig } from './config';

export type CandidateKind = 'jsx-text' | 'jsx-attribute' | 'jsx-expression';

export interface ScanCandidate {
  id: string;
  filePath: string;
  kind: CandidateKind;
  text: string;
  context?: string;
  position: {
    line: number;
    column: number;
  };
}

export interface ScanSummary {
  filesScanned: number;
  candidates: ScanCandidate[];
}

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

  constructor(config: I18nConfig) {
    this.config = config;
    this.workspaceRoot = process.cwd();
    this.project = new Project({
      skipAddingFilesFromTsConfig: true,
    });
  }

  public scan(): ScanSummary {
    const patterns = this.getGlobPatterns();
    const files = this.project.addSourceFilesAtPaths(patterns);
    const candidates: ScanCandidate[] = [];

    for (const file of files) {
      file.forEachDescendant((node) => {
        if (Node.isJsxText(node)) {
          this.captureJsxText(node, file, candidates);
          return;
        }

        if (Node.isJsxAttribute(node)) {
          this.captureJsxAttribute(node, file, candidates);
          return;
        }

        if (Node.isJsxExpression(node)) {
          this.captureJsxExpression(node, file, candidates);
        }
      });
    }

    return {
      filesScanned: files.length,
      candidates,
    };
  }

  private captureJsxText(node: JsxText, file: SourceFile, bucket: ScanCandidate[]) {
    const text = this.normalizeText(node.getText());
    if (!text) {
      return;
    }

    bucket.push(this.createCandidate({
      node,
      file,
      kind: 'jsx-text',
      text,
      context: this.getJsxContext(node),
    }));
  }

  private captureJsxAttribute(node: JsxAttribute, file: SourceFile, bucket: ScanCandidate[]) {
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

    bucket.push(this.createCandidate({
      node,
      file,
      kind: 'jsx-attribute',
      text,
      context: `${attributeName} attribute`,
    }));
  }

  private captureJsxExpression(node: JsxExpression, file: SourceFile, bucket: ScanCandidate[]) {
    const expression = node.getExpression();
    if (!expression || !Node.isStringLiteral(expression)) {
      return;
    }

    const text = this.normalizeText(expression.getLiteralText());
    if (!text) {
      return;
    }

    bucket.push(this.createCandidate({
      node,
      file,
      kind: 'jsx-expression',
      text,
      context: this.getJsxContext(node),
    }));
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
    return normalized.length > 0 ? normalized : undefined;
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
