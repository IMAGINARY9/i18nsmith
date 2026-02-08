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

// Lazy runtime loader for the optional `vue-eslint-parser`. We intentionally
// use `eval('require')` to prevent bundlers from statically hoisting the
// require call. The loader caches the result so we only try once per
// workspaceRoot (to handle multiple projects in a single process).
let _cachedVueParserRef: any | undefined;
let _cachedVueParserRoot: string | undefined;
let _vueParserMissingWarned = false;
function getVueEslintParser(workspaceRoot?: string): any | null {
  // If the workspace root changed, invalidate the cache so we re-resolve
  // from the new project's node_modules.
  if (workspaceRoot && workspaceRoot !== _cachedVueParserRoot) {
    _cachedVueParserRef = undefined;
    _cachedVueParserRoot = workspaceRoot;
  }
  if (_cachedVueParserRef !== undefined) return _cachedVueParserRef;
  // Try to resolve from the project's workspace root first, then fall back
  // to the CLI's own node_modules.
  if (workspaceRoot) {
    try {
      // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval
      const resolved = eval('require').resolve('vue-eslint-parser', {
        paths: [workspaceRoot, path.join(workspaceRoot, 'node_modules')],
      });
      // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval
      _cachedVueParserRef = eval('require')(resolved);
      return _cachedVueParserRef;
    } catch {
      // Fall through to default resolution
    }
  }
  try {
    // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval
    _cachedVueParserRef = eval('require')('vue-eslint-parser');
    return _cachedVueParserRef;
  } catch {
    _cachedVueParserRef = null;
    return null;
  }
}

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
    const adapterHook = config.translationAdapter?.hookName?.trim();
    const inferredIdentifier = adapterHook && !adapterHook.startsWith('use')
      ? adapterHook
      : undefined;
    this.translationIdentifier =
      options.translationIdentifier ??
      config.sync?.translationIdentifier ??
      inferredIdentifier ??
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
        if (absolutePath.toLowerCase().endsWith('.vue')) {
          const extracted = await this.extractFromVueFile(absolutePath);
          fileReferences = extracted.references;
          fileWarnings = extracted.dynamicKeyWarnings;
        } else {
          const sourceFile = this.project.addSourceFileAtPath(absolutePath);
          const extracted = this.extractFromFile(sourceFile);
          fileReferences = extracted.references;
          fileWarnings = extracted.dynamicKeyWarnings;
        }

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

  /**
   * Extract references from a single Vue file.
   */
  public async extractFromVueFile(filePath: string): Promise<{
    references: TranslationReference[];
    dynamicKeyWarnings: DynamicKeyWarning[];
  }> {
    const content = await fs.readFile(filePath, 'utf-8');
    const references: TranslationReference[] = [];
    const dynamicKeyWarnings: DynamicKeyWarning[] = [];

    const vueEslintParser = getVueEslintParser(this.workspaceRoot);
    if (!vueEslintParser || typeof vueEslintParser.parse !== 'function') {
      if (!_vueParserMissingWarned) {
        _vueParserMissingWarned = true;
        console.warn('[i18nsmith] vue-eslint-parser is not installed. Vue reference extraction will be skipped.');
        console.warn('[i18nsmith] Install it with: npm install --save-dev vue-eslint-parser');
      }
      // vue-eslint-parser not available, skip Vue AST parsing and return empty
      // results. We avoid throwing so the extension can activate in runtime
      // environments where the optional parser isn't installed.
      return { references, dynamicKeyWarnings };
    }

    try {
      const ast = vueEslintParser.parse(content, { sourceType: 'module', ecmaVersion: 2020 });
      
      const visit = (node: any) => {
        if (!node) return;
        // console.log('Visiting:', node.type);

        // Check for CallExpression
        if (node.type === 'CallExpression') {
          // Check callee: t('key'), $t('key'), this.$t('key'), i18n.t('key')
          const isTranslationCall = this.isEstreeTranslationCall(node);
          if (isTranslationCall) {
            const analysis = this.extractKeyFromEstreeNode(node);
            if (analysis) {
               if (analysis.kind === 'literal') {
                 references.push(this.createEstreeReference(filePath, node, analysis.key));
               } else {
                 dynamicKeyWarnings.push(this.createEstreeDynamicWarning(filePath, node, analysis.reason, content));
               }
            }
          }
        }
        
        // Check for VDirective (v-t)
        if (node.type === 'VAttribute' && node.directive && node.key?.name?.name === 't') {
             // v-t="'key'" -> value is VExpressionContainer -> expression is Literal
             if (node.value && node.value.type === 'VExpressionContainer' && node.value.expression) {
                 const expr = node.value.expression;
                 if (expr.type === 'Literal' && typeof expr.value === 'string') {
                     references.push(this.createEstreeReference(filePath, node.value, expr.value));
                 } else {
                     // Dynamic v-t
                     dynamicKeyWarnings.push(this.createEstreeDynamicWarning(filePath, node.value, 'expression', content));
                 }
             }
        }

        // Recursively visit properties
        for (const key in node) {
            if (key === 'parent') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                child.forEach(c => visit(c));
            } else if (typeof child === 'object' && child !== null && typeof child.type === 'string') {
                visit(child);
            }
        }
      };

      visit(ast.templateBody);
      visit(ast.body); // Script (Program)
    } catch (e) {
      console.warn(`Failed to parse Vue file ${filePath}:`, e);
    }

    return { references, dynamicKeyWarnings };
  }

  private isEstreeTranslationCall(node: any): boolean {
      if (node.type !== 'CallExpression') return false;
      const callee = node.callee;
      
      // t('...')
      if (callee.type === 'Identifier' && (callee.name === this.translationIdentifier || callee.name === '$t')) return true;
      
      // this.$t('...')
      if (callee.type === 'MemberExpression') {
          const prop = callee.property;
          
          if (prop.type === 'Identifier' && (prop.name === 't' || prop.name === '$t')) {
              // this.$t or i18n.t
               return true;
          }
      }
      return false;
  }

  private extractKeyFromEstreeNode(node: any): { kind: 'literal'; key: string } | { kind: 'dynamic'; reason: DynamicKeyReason } | undefined {
      const args = node.arguments;
      if (!args || args.length === 0) return undefined;
      const arg = args[0];

      if (arg.type === 'Literal' && typeof arg.value === 'string') {
          return { kind: 'literal', key: arg.value };
      }
      if (arg.type === 'TemplateLiteral') {
          if (arg.quasis.length === 1 && arg.expressions.length === 0) {
              return { kind: 'literal', key: arg.quasis[0].value.raw };
          }
          return { kind: 'dynamic', reason: 'template' };
      }
      if (arg.type === 'BinaryExpression') {
          return { kind: 'dynamic', reason: 'binary' };
      }
      return { kind: 'dynamic', reason: 'expression' };
  }

  private createEstreeReference(filePath: string, node: any, key: string): TranslationReference {
      const loc = node.loc?.start ?? { line: 1, column: 0 };
      return {
          key,
          filePath: this.getRelativePath(filePath),
          position: { line: loc.line, column: loc.column },
      };
  }

  private createEstreeDynamicWarning(filePath: string, node: any, reason: DynamicKeyReason, content: string): DynamicKeyWarning {
       const loc = node.loc?.start ?? { line: 1, column: 0 };
       let expression = '<dynamic>';
       if (node.range && Array.isArray(node.range)) {
           expression = content.substring(node.range[0], node.range[1]);
       }

       return {
           filePath: this.getRelativePath(filePath),
           position: { line: loc.line, column: loc.column },
           expression,
           reason
       };
  }
}
