import path from "path";
import { parse } from "vue-eslint-parser";
import { I18nConfig } from "../config.js";
import type { ScanCandidate, CandidateKind, SkipReason, SkippedCandidate } from "../scanner.js";
import type { FileParser } from "./FileParser.js";

const LETTER_REGEX_GLOBAL = /\p{L}/gu;
const MAX_DIRECTIVE_COMMENT_DEPTH = 4;
const HTML_ENTITY_PATTERN = /^&[a-z][a-z0-9-]*;$/i;
const REPEATED_SYMBOL_PATTERN = /^([^\p{L}\d\s])\1{1,}$/u;

export class VueParser implements FileParser {
  private config: I18nConfig;
  private workspaceRoot: string;
  private allowPatterns: RegExp[];
  private denyPatterns: RegExp[];
  private preserveNewlines: boolean;
  private decodeHtmlEntities: boolean;
  private activeSkipLog?: SkippedCandidate[];

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
    return path.extname(filePath).toLowerCase() === '.vue';
  }

  parse(filePath: string, content: string): ScanCandidate[] {
    const candidates: ScanCandidate[] = [];
    this.activeSkipLog = [];

    try {
      // Parse Vue SFC using vue-eslint-parser
      const ast = parse(content, {
        sourceType: 'module',
        ecmaVersion: 2020,
        sourceFile: filePath,
      });

      // Extract candidates from template
      this.extractFromTemplate(ast.templateBody, content, filePath, candidates);

      // Extract candidates from script (if it exists)
      if (ast.body) {
        for (const node of ast.body) {
          if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'ObjectExpression') {
            // Vue component object
            this.extractFromScript(node.declaration, content, filePath, candidates);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to parse Vue file ${filePath}:`, error);
      // Fallback to basic text extraction
      this.extractFromContent(content, filePath, candidates);
    }

    return candidates;
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
        // Attribute values
        if (node.value && node.value.type === 'VLiteral' && node.value.value) {
          this.addCandidate('jsx-attribute', node.value.value, node.value.loc, filePath, candidates);
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

  private extractFromScript(component: any, content: string, filePath: string, candidates: ScanCandidate[]) {
    // Extract from computed properties, methods, etc.
    // This is a simplified implementation - could be enhanced
    this.walkScriptNode(component, content, filePath, candidates);
  }

  private walkScriptNode(node: any, content: string, filePath: string, candidates: ScanCandidate[]) {
    if (!node) return;

    if (node.type === 'Literal' && typeof node.value === 'string' && node.value.trim()) {
      this.addCandidate('call-expression', node.value, node.loc, filePath, candidates);
    }

    // Data function handling moved to properties loop above

    // Walk properties
    if (node.properties) {
      for (const prop of node.properties) {
        
        // Handle data() function specifically
        if (prop.key && prop.key.name === 'data' && prop.value && prop.value.type === 'FunctionExpression') {
          const dataFunction = prop.value;
          if (dataFunction.body && dataFunction.body.body) {
            for (const statement of dataFunction.body.body) {
              if (statement.type === 'ReturnStatement' && statement.argument && statement.argument.type === 'ObjectExpression') {
                this.walkScriptNode(statement.argument, content, filePath, candidates);
              }
            }
          }
        } else {
          this.walkScriptNode(prop.value, content, filePath, candidates);
        }
      }
    }

    // Walk children
    if (node.children) {
      for (const child of node.children) {
        this.walkScriptNode(child, content, filePath, candidates);
      }
    }
  }

  private extractFromContent(content: string, filePath: string, candidates: ScanCandidate[]) {
    // Fallback: extract text from template sections
    const templateRegex = /<template[^>]*>([\s\S]*?)<\/template>/g;
    let match;

    while ((match = templateRegex.exec(content)) !== null) {
      const templateContent = match[1];
      const lines = templateContent.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line && !line.startsWith('<') && !line.startsWith('{') && line.length > 3) {
          // Approximate position
          const globalMatch = content.indexOf(line, match.index);
          if (globalMatch !== -1) {
            const position = this.getPositionFromIndex(content, globalMatch);
            this.addCandidate('jsx-text', line, {
              start: position,
              end: { line: position.line, column: position.column + line.length }
            }, filePath, candidates);
          }
        }
      }
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

    if (text.length < (this.config.minTextLength ?? 3)) {
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
    const minLetterRatio = this.config.extraction?.minLetterRatio ?? 0.5;

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

  private compilePatterns(patterns?: string[]): RegExp[] {
    if (!patterns) return [];
    return patterns.map(pattern => new RegExp(pattern, 'u'));
  }

  private getPositionFromIndex(content: string, index: number): { line: number; column: number } {
    const lines = content.substring(0, index).split('\n');
    return {
      line: lines.length,
      column: lines[lines.length - 1].length + 1,
    };
  }
}