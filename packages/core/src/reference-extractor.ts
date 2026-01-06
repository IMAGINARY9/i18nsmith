/**
 * Reference Extractor Module
 *
 * Extracts translation key references from TypeScript/JavaScript source files.
 * Handles caching, dynamic key detection, and reference tracking.
 */

import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';
import { CallExpression, Node, Project, SourceFile } from 'ts-morph';
import { I18nConfig } from './config.js';
import { createDefaultProject } from './project-factory.js';

export interface TranslationReference {
  key: string;
  /**
   * Optional fallback literal associated with the key in code.
   * Example: `t('common.email') || 'Email'`.
   *
   * Used by sync to seed missing entries with a high-confidence default.
   */
  fallbackLiteral?: string;
  filePath: string;
  position: {
    line: number;
    column: number;
  };
}

export type DynamicKeyReason = 'template' | 'binary' | 'expression';

export interface DynamicKeyWarning {
  filePath: string;
  position: {
    line: number;
    column: number;
  };
  expression: string;
  reason: DynamicKeyReason;
}

interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

interface ReferenceCacheEntry {
  fingerprint: FileFingerprint;
  references: TranslationReference[];
  dynamicKeyWarnings: DynamicKeyWarning[];
}

export interface ReferenceCacheFile {
  version: number;
  translationIdentifier: string;
  files: Record<string, ReferenceCacheEntry>;
}

export interface ExtractionResult {
  references: TranslationReference[];
  referencesByKey: Map<string, TranslationReference[]>;
  keySet: Set<string>;
  dynamicKeyWarnings: DynamicKeyWarning[];
  filesScanned: number;
}

const REFERENCE_CACHE_VERSION = 2;

export interface ReferenceExtractorOptions {
  workspaceRoot: string;
  project?: Project;
  cacheDir?: string;
  translationIdentifier?: string;
}

/**
 * ReferenceExtractor scans source files to find translation function calls
 * and extract the keys being used. It supports caching for performance.
 */
export class ReferenceExtractor {
  private readonly workspaceRoot: string;
  private readonly project: Project;
  private readonly cacheDir: string;
  private readonly translationIdentifier: string;
  private readonly referenceCachePath: string;

  constructor(
    private readonly config: I18nConfig,
    options: ReferenceExtractorOptions
  ) {
    this.workspaceRoot = options.workspaceRoot;
    this.project = options.project ?? createDefaultProject();
    this.cacheDir = options.cacheDir ?? path.join(this.workspaceRoot, 'node_modules', '.cache', 'i18nsmith');
    this.translationIdentifier =
      options.translationIdentifier ??
      config.sync?.translationIdentifier ??
      't';
    this.referenceCachePath = path.join(this.cacheDir, 'references.json');
  }

  /**
   * Extract all translation references from source files matching the configured patterns.
   */
  public async extract(options?: {
    invalidateCache?: boolean;
    assumedKeys?: Set<string>;
  }): Promise<ExtractionResult> {
    const filePaths = await this.resolveSourceFilePaths();
    const cache = await this.loadCache(options?.invalidateCache);
    const nextCacheEntries: Record<string, ReferenceCacheEntry> = {};
    const assumedKeys = options?.assumedKeys ?? new Set<string>();

    const result = await this.collectReferences(
      filePaths,
      assumedKeys,
      cache,
      nextCacheEntries
    );

    await this.saveCache(nextCacheEntries);

    return {
      ...result,
      filesScanned: filePaths.length,
    };
  }

  /**
   * Extract references from a single source file.
   */
  public extractFromFile(file: SourceFile): {
    references: TranslationReference[];
    dynamicKeyWarnings: DynamicKeyWarning[];
  } {
    const references: TranslationReference[] = [];
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];

    file.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) {
        return;
      }

      const analysis = this.extractKeyFromCall(node);
      if (!analysis) {
        return;
      }

      if (analysis.kind === 'dynamic') {
        dynamicKeyWarnings.push(this.createDynamicWarning(file, node, analysis.reason));
        return;
      }

      const reference = this.createReference(file, node, analysis.key);
      reference.fallbackLiteral = this.extractFallbackLiteral(node);
      references.push(reference);
    });

    return { references, dynamicKeyWarnings };
  }

  /**
   * Analyze a call expression to determine if it's a translation call
   * and extract the key if present.
   */
  public extractKeyFromCall(
    node: CallExpression
  ):
    | { kind: 'literal'; key: string }
    | { kind: 'dynamic'; reason: DynamicKeyReason }
    | undefined {
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== this.translationIdentifier) {
      return undefined;
    }

    const [arg] = node.getArguments();
    if (!arg) {
      return undefined;
    }

    if (Node.isStringLiteral(arg)) {
      return { kind: 'literal', key: arg.getLiteralText() };
    }

    if (Node.isNoSubstitutionTemplateLiteral(arg)) {
      return { kind: 'literal', key: arg.getLiteralText() };
    }

    if (Node.isTemplateExpression(arg)) {
      return { kind: 'dynamic', reason: 'template' };
    }

    if (Node.isBinaryExpression(arg)) {
      return { kind: 'dynamic', reason: 'binary' };
    }

    return { kind: 'dynamic', reason: 'expression' };
  }

  private extractFallbackLiteral(call: CallExpression): string | undefined {
    // In JSX/TS, the call is often wrapped (e.g. inside a JsxExpression or parentheses)
    // before participating in a binary expression.
    let current: Node = call;
    for (let depth = 0; depth < 4; depth++) {
      const parentNode = current.getParent() as Node | undefined;
      if (!parentNode) break;

      if (
        Node.isParenthesizedExpression(parentNode) ||
        Node.isAsExpression(parentNode) ||
        Node.isNonNullExpression(parentNode) ||
        Node.isJsxExpression(parentNode)
      ) {
        current = parentNode;
        continue;
      }

      current = parentNode;
      break;
    }

    // BinaryExpression might be either the *parent* of the call, or the parent of a wrapper.
    // Check both the current node (after wrapper lifting) and parents.
    const tryBinary = (node: Node | undefined): string | undefined => {
      if (!node || !Node.isBinaryExpression(node)) return undefined;

      const operator = node.getOperatorToken().getText();
      if (operator !== '||' && operator !== '??') return undefined;

      const left = node.getLeft();
      if (!left.getText().includes(call.getText())) return undefined;

      const right = node.getRight();
      if (Node.isStringLiteral(right) || Node.isNoSubstitutionTemplateLiteral(right)) {
        return right.getLiteralText();
      }

      return undefined;
    };

    // First: binary is the current node itself.
    const direct = tryBinary(current);
    if (direct) return direct;

    // Then: walk up across wrappers until we hit a binary or exit.
    let candidate: Node | undefined = current;
    for (let depth = 0; depth < 10; depth++) {
      const parent = candidate?.getParent() as Node | undefined;
      if (!parent) break;

      const found = tryBinary(parent);
      if (found) return found;

      if (
        Node.isParenthesizedExpression(parent) ||
        Node.isAsExpression(parent) ||
        Node.isNonNullExpression(parent) ||
        Node.isJsxExpression(parent)
      ) {
        candidate = parent;
        continue;
      }

      break;
    }

    return undefined;
  }

  /**
   * Clear the reference cache.
   */
  public async clearCache(): Promise<void> {
    await fs.rm(this.referenceCachePath, { force: true }).catch(() => {});
  }

  private async collectReferences(
    filePaths: string[],
    assumedKeys: Set<string>,
    cache: ReferenceCacheFile | undefined,
    nextCacheEntries: Record<string, ReferenceCacheEntry>
  ): Promise<Omit<ExtractionResult, 'filesScanned'>> {
    const references: TranslationReference[] = [];
    const referencesByKey = new Map<string, TranslationReference[]>();
    const keySet = new Set<string>();
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];
    const canUseCache = Boolean(cache);

    for (const absolutePath of filePaths) {
      const relativePath = this.getRelativePath(absolutePath);
      const fingerprint = await this.getFileFingerprint(absolutePath);

      let fileReferences: TranslationReference[];
      let fileWarnings: DynamicKeyWarning[];

      const cachedEntry = canUseCache
        ? this.getCachedEntry(cache!, relativePath, fingerprint)
        : undefined;

      if (cachedEntry) {
        fileReferences = cachedEntry.references;
        fileWarnings = cachedEntry.dynamicKeyWarnings;
        nextCacheEntries[relativePath] = cachedEntry;
      } else {
        const sourceFile = this.project.addSourceFileAtPath(absolutePath);
        const extracted = this.extractFromFile(sourceFile);
        fileReferences = extracted.references;
        fileWarnings = extracted.dynamicKeyWarnings;
        nextCacheEntries[relativePath] = {
          fingerprint,
          references: fileReferences,
          dynamicKeyWarnings: fileWarnings,
        };
      }

      for (const reference of fileReferences) {
        references.push(reference);
        keySet.add(reference.key);
        if (!referencesByKey.has(reference.key)) {
          referencesByKey.set(reference.key, []);
        }
        referencesByKey.get(reference.key)!.push(reference);
      }

      dynamicKeyWarnings.push(...fileWarnings);
    }

    for (const key of assumedKeys) {
      keySet.add(key);
      if (!referencesByKey.has(key)) {
        referencesByKey.set(key, []);
      }
    }

    return { references, referencesByKey, keySet, dynamicKeyWarnings };
  }

  private createReference(
    file: SourceFile,
    node: CallExpression,
    key: string
  ): TranslationReference {
    const position = file.getLineAndColumnAtPos(node.getStart());
    return {
      key,
      filePath: this.getRelativePath(file.getFilePath()),
      position,
    };
  }

  private createDynamicWarning(
    file: SourceFile,
    node: CallExpression,
    reason: DynamicKeyReason
  ): DynamicKeyWarning {
    const [arg] = node.getArguments();
    const position = file.getLineAndColumnAtPos((arg ?? node).getStart());
    const expression = arg ? arg.getText() : node.getText();

    return {
      filePath: this.getRelativePath(file.getFilePath()),
      position,
      expression,
      reason,
    };
  }

  private async getFileFingerprint(filePath: string): Promise<FileFingerprint> {
    const stats = await fs.stat(filePath);
    return {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  }

  private getCachedEntry(
    cache: ReferenceCacheFile,
    relativePath: string,
    fingerprint: FileFingerprint
  ): ReferenceCacheEntry | undefined {
    const entry = cache.files[relativePath];
    if (!entry) {
      return undefined;
    }
    if (
      entry.fingerprint.mtimeMs !== fingerprint.mtimeMs ||
      entry.fingerprint.size !== fingerprint.size
    ) {
      return undefined;
    }
    return entry;
  }

  private async loadCache(invalidate?: boolean): Promise<ReferenceCacheFile | undefined> {
    if (invalidate) {
      await this.clearCache();
      return undefined;
    }

    try {
      const raw = await fs.readFile(this.referenceCachePath, 'utf8');
      const parsed = JSON.parse(raw) as ReferenceCacheFile;
      if (parsed.version !== REFERENCE_CACHE_VERSION) {
        return undefined;
      }
      if (parsed.translationIdentifier !== this.translationIdentifier) {
        return undefined;
      }
      if (!parsed.files || typeof parsed.files !== 'object') {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async saveCache(entries: Record<string, ReferenceCacheEntry>): Promise<void> {
    const payload: ReferenceCacheFile = {
      version: REFERENCE_CACHE_VERSION,
      translationIdentifier: this.translationIdentifier,
      files: entries,
    };

    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.referenceCachePath, JSON.stringify(payload), 'utf8');
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

  private resolveGlobPatterns(patterns: string[]): string[] {
    return patterns.map((pattern) => {
      const isNegated = pattern.startsWith('!');
      const rawPattern = isNegated ? pattern.slice(1) : pattern;
      const absolute = path.isAbsolute(rawPattern)
        ? rawPattern
        : path.join(this.workspaceRoot, rawPattern);
      return isNegated ? `!${absolute}` : absolute;
    });
  }

  private async resolveSourceFilePaths(): Promise<string[]> {
    const patterns = this.resolveGlobPatterns(this.getGlobPatterns());
    const files = (await fg(patterns, {
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: true,
    })) as string[];
    return files.sort((a, b) => a.localeCompare(b));
  }
}
