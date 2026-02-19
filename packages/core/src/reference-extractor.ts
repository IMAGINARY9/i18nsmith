/**
 * Reference Extractor Module
 *
 * Extracts translation key references from TypeScript/JavaScript source files.
 * Handles caching, dynamic key detection, and reference tracking.
 */

import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import fg from 'fast-glob';
import { CallExpression, Node, Project, SourceFile } from 'ts-morph';
import { I18nConfig } from './config.js';
import { getToolVersion, hashConfig, getParsersSignature, computeCacheVersion } from './cache-utils.js';
import { CacheValidator, CacheStatsCollector, type CacheValidationContext } from './cache/index.js';
import { createDefaultProject } from './project-factory.js';
import { createDefaultParserRegistry, type ParserRegistry } from './parsers/index.js';

// Lazy runtime loader for the optional `vue-eslint-parser`. Use createRequire
// so ESM builds can resolve the dependency without eval. The loader caches the
// result so we only try once per workspaceRoot (to handle multiple projects in
// a single process).
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
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  if (workspaceRoot) {
    try {
      const resolved = require.resolve('vue-eslint-parser', {
        paths: [workspaceRoot, path.join(workspaceRoot, 'node_modules')],
      });
      _cachedVueParserRef = require(resolved);
      return _cachedVueParserRef;
    } catch {
      // Fall through to default resolution
    }
  }
  try {
    _cachedVueParserRef = require('vue-eslint-parser');
    return _cachedVueParserRef;
  } catch {
    _cachedVueParserRef = null;
    if (!_vueParserMissingWarned) {
      _vueParserMissingWarned = true;
      console.warn('[i18nsmith] vue-eslint-parser is not installed. Vue reference extraction will be skipped.');
      console.warn('[i18nsmith] Install it with: npm install --save-dev vue-eslint-parser');
    }
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
  configHash: string;
  toolVersion: string;
  parserSignature?: string;
  files: Record<string, ReferenceCacheEntry>;
}

export interface ExtractionResult {
  references: TranslationReference[];
  referencesByKey: Map<string, TranslationReference[]>;
  keySet: Set<string>;
  dynamicKeyWarnings: DynamicKeyWarning[];
  filesScanned: number;
}

// Cache schema version - only increment when cache structure changes (new/removed fields, type changes)
// Parser signature is automatically included in version computation, so no manual bumps needed
// for parser logic changes.
const CACHE_SCHEMA_VERSION = 1;

// Compute version automatically based on schema + parser signature
// This eliminates manual CACHE_VERSION bumps when parser code changes
function getReferenceCacheVersion(): number {
  return computeCacheVersion(getParsersSignature(), CACHE_SCHEMA_VERSION);
}

export interface ReferenceExtractorOptions {
  workspaceRoot: string;
  project?: Project;
  cacheDir?: string;
  translationIdentifier?: string;
  parserRegistry?: ParserRegistry;
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
  private readonly parserRegistry: ParserRegistry;
  private readonly configHash: string;
  private readonly toolVersion: string;
  private readonly parserSignature: string;
  private readonly cacheValidator: CacheValidator;
  private readonly cacheStats: CacheStatsCollector;

  constructor(
    private readonly config: I18nConfig,
    options: ReferenceExtractorOptions
  ) {
    this.workspaceRoot = options.workspaceRoot;
    this.project = options.project ?? createDefaultProject();
    this.cacheDir = options.cacheDir ?? path.join(this.workspaceRoot, 'node_modules', '.cache', 'i18nsmith');
    this.parserRegistry = options.parserRegistry ?? createDefaultParserRegistry(this.project);
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
    this.configHash = hashConfig(config);
    this.toolVersion = getToolVersion();
    this.parserSignature = getParsersSignature();
    
    // Initialize cache validator with current context
    const validationContext: CacheValidationContext = {
      currentVersion: getReferenceCacheVersion(),
      expectedTranslationIdentifier: this.translationIdentifier,
      currentConfigHash: this.configHash,
      currentToolVersion: this.toolVersion,
      currentParserSignature: this.parserSignature,
    };
    this.cacheValidator = new CacheValidator(validationContext);
    this.cacheStats = new CacheStatsCollector();
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
    const filePath = file.getFilePath();
    const parser = this.parserRegistry.getForFile(filePath);
    
    if (!parser) {
      return { references: [], dynamicKeyWarnings: [] };
    }

    if (!parser.isAvailable(this.workspaceRoot)) {
      return { references: [], dynamicKeyWarnings: [] };
    }

    try {
      const content = file.getFullText();
      // Debug: optionally inspect the raw content passed to the framework parser
      if (process.env.DEBUG_REFEXT === '1') {
        // eslint-disable-next-line no-console
        console.log(`refext.debug: parseFile content includes demo.card.greeting? ${content.includes("demo.card.greeting")}`);
      }
      const result = parser.parseFile(filePath, content, this.translationIdentifier, this.workspaceRoot);
      return result;
    } catch (error) {
      console.error(`Failed to parse ${filePath}:`, error);
      throw error;
    }
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

  /**
   * Get cache statistics for debugging and telemetry.
   */
  public getCacheStats() {
    return this.cacheStats.getStats();
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
        // Use the appropriate parser based on file extension
        const parser = this.parserRegistry.getForFile(absolutePath);
        if (parser) {
          const content = await fs.readFile(absolutePath, 'utf-8');
          const result = parser.parseFile(absolutePath, content, this.translationIdentifier, this.workspaceRoot);
          fileReferences = result.references;
          fileWarnings = result.dynamicKeyWarnings;
        } else {
          // Fallback: no parser available for this file type
          fileReferences = [];
          fileWarnings = [];
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
      this.cacheStats.recordMiss();
      await this.clearCache();
      return undefined;
    }

    try {
      const raw = await fs.readFile(this.referenceCachePath, 'utf8');
      const parsed = JSON.parse(raw);
      
      // Validate cache using unified validator
      const validation = this.cacheValidator.validate(parsed);
      if (!validation.valid) {
        this.cacheStats.recordInvalidation(validation.reasons);
        this.cacheStats.recordMiss();
        return undefined;
      }
      
      // Additional check for files structure
      const cacheData = parsed as ReferenceCacheFile;
      if (!cacheData.files || typeof cacheData.files !== 'object') {
        this.cacheStats.recordMiss();
        return undefined;
      }
      
      this.cacheStats.recordHit();
      return cacheData;
    } catch {
      this.cacheStats.recordMiss();
      return undefined;
    }
  }

  private async saveCache(entries: Record<string, ReferenceCacheEntry>): Promise<void> {
    const payload: ReferenceCacheFile = {
      version: getReferenceCacheVersion(),
      translationIdentifier: this.translationIdentifier,
      configHash: this.configHash,
      toolVersion: this.toolVersion,
      parserSignature: this.parserSignature,
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
