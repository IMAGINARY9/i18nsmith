import path from 'path';
import fs from 'fs/promises';
import fg from 'fast-glob';
import { Node, Project, SourceFile } from 'ts-morph';
import { I18nConfig, DEFAULT_INCLUDE } from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';
import { ActionableItem } from './actionable.js';
import { createUnifiedDiff, SourceFileDiffEntry, LocaleDiffEntry, buildLocaleDiffs } from './diff-utils.js';
import { createDefaultProject } from './project-factory.js';
import { AdapterRegistry } from './framework/registry.js';
import { Scanner, TransformCandidate } from './index.js';
import MagicString from 'magic-string';

// Lazy loader for optional vue-eslint-parser
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

export interface KeyRenamerOptions {
  workspaceRoot?: string;
  project?: Project;
  localeStore?: LocaleStore;
  translationIdentifier?: string;
  registry?: AdapterRegistry;
}

export interface KeyRenameOptions {
  write?: boolean;
  diff?: boolean;
  allowConflicts?: boolean;
}

export interface KeyRenameMapping {
  from: string;
  to: string;
}

export interface KeyRenameLocalePreview {
  locale: string;
  renamedFrom: string;
  renamedTo: string;
  missing: boolean;
  duplicate: boolean;
}

export interface KeyRenameSummary {
  filesScanned: number;
  filesUpdated: string[];
  occurrences: number;
  localeStats: LocaleFileStats[];
  localePreview: KeyRenameLocalePreview[];
  missingLocales: string[];
  write: boolean;
  actionableItems: ActionableItem[];
  diffs: SourceFileDiffEntry[];
  localeDiffs?: LocaleDiffEntry[];
}

export interface KeyRenameMappingSummary {
  from: string;
  to: string;
  occurrences: number;
  localePreview: KeyRenameLocalePreview[];
  missingLocales: string[];
}

export interface KeyRenameBatchSummary {
  filesScanned: number;
  filesUpdated: string[];
  occurrences: number;
  localeStats: LocaleFileStats[];
  mappingSummaries: KeyRenameMappingSummary[];
  write: boolean;
  actionableItems: ActionableItem[];
  diffs: SourceFileDiffEntry[];
  localeDiffs?: LocaleDiffEntry[];
}

type MappingLocaleAnalysis = {
  localePreview: KeyRenameLocalePreview[];
  missingLocales: string[];
  duplicateLocales: string[];
};

export class KeyRenamer {
  private readonly project: Project;
  private readonly workspaceRoot: string;
  private readonly localeStore: LocaleStore;
  private readonly translationIdentifier: string;
  private readonly sourceLocale: string;
  private readonly targetLocales: string[];
  private readonly registry: AdapterRegistry;

  constructor(private readonly config: I18nConfig, options: KeyRenamerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
  this.project = options.project ?? createDefaultProject();
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
    const localeStoreOptions = {
      format: config.locales?.format ?? 'auto',
      delimiter: config.locales?.delimiter ?? '.',
      sortKeys: config.locales?.sortKeys ?? 'alphabetical',
    };
    this.localeStore = options.localeStore ?? new LocaleStore(localesDir, localeStoreOptions);
    this.translationIdentifier = options.translationIdentifier ?? this.config.sync?.translationIdentifier ?? 't';
    this.sourceLocale = config.sourceLanguage ?? 'en';
    this.targetLocales = (config.targetLanguages ?? []).filter(Boolean);
    this.registry = options.registry ?? new AdapterRegistry();
  }

  public async rename(oldKey: string, newKey: string, options: KeyRenameOptions = {}): Promise<KeyRenameSummary> {
    if (!oldKey || !newKey) {
      throw new Error('Both oldKey and newKey must be provided.');
    }

    const batchResult = await this.renameBatch([{ from: oldKey, to: newKey }], options);
    const mappingSummary = batchResult.mappingSummaries[0];

    return {
      filesScanned: batchResult.filesScanned,
      filesUpdated: batchResult.filesUpdated,
      occurrences: mappingSummary?.occurrences ?? 0,
      localeStats: batchResult.localeStats,
      localePreview: mappingSummary?.localePreview ?? [],
      missingLocales: mappingSummary?.missingLocales ?? [],
      write: batchResult.write,
      actionableItems: batchResult.actionableItems,
      diffs: batchResult.diffs,
      localeDiffs: batchResult.localeDiffs,
    };
  }

  public async renameBatch(
    mappingsInput: KeyRenameMapping[],
    options: KeyRenameOptions = {}
  ): Promise<KeyRenameBatchSummary> {
    const mappings = this.normalizeMappings(mappingsInput);
    if (!mappings.length) {
      throw new Error('At least one mapping must be provided.');
    }

    const write = options.write ?? false;
    const generateDiffs = options.diff ?? false;
    const allowConflicts = options.allowConflicts ?? false;
    const localeAnalysis = await this.buildLocaleAnalysis(mappings);
    const duplicateConflicts = mappings
      .map((mapping) => {
        const analysis = localeAnalysis.get(mapping.from);
        if (!analysis || analysis.duplicateLocales.length === 0) {
          return undefined;
        }
        return { mapping, locales: analysis.duplicateLocales };
      })
      .filter((entry): entry is { mapping: KeyRenameMapping; locales: string[] } => Boolean(entry));

    if (duplicateConflicts.length && write && !allowConflicts) {
      const conflictSummary = duplicateConflicts
        .slice(0, 5)
        .map(({ mapping, locales }) => `${mapping.from} → ${mapping.to} (${locales.join(', ')})`)
        .join('; ');
      const moreConflicts = duplicateConflicts.length > 5 ? ` (and ${duplicateConflicts.length - 5} more)` : '';
      throw new Error(
        `Cannot rename keys because target entries already exist in locale files: ${conflictSummary}${moreConflicts}. ` +
          'Rename or remove the conflicting keys, or choose a different target before running with --write.'
      );
    }

    const mappingBySource = new Map<string, KeyRenameMapping>();
    for (const mapping of mappings) {
      if (mappingBySource.has(mapping.from)) {
        throw new Error(`Duplicate mapping detected for key "${mapping.from}".`);
      }
      mappingBySource.set(mapping.from, mapping);
    }

    const occurrencesByKey = new Map<string, number>();
    const filesToModify = new Map<string, TransformCandidate[]>();

    // First pass: identify files to modify and count occurrences using adapters
    const scanner = new Scanner(this.config, {
      workspaceRoot: this.workspaceRoot,
      project: this.project,
      registry: this.registry,
    });
    const scanSummary = scanner.scan({
      targets: undefined, // scan all files
      scanCalls: true,
    });

    for (const candidate of scanSummary.candidates) {
      const literal = candidate.text;
      // Try exact match first, then normalized match
      let mapping = mappingBySource.get(literal);
      if (!mapping) {
        const normalized = literal.replace(/\s+/g, ' ').trim();
        mapping = mappingBySource.get(normalized);
      }
      
      if (!mapping) {
        continue;
      }

      occurrencesByKey.set(mapping.from, (occurrencesByKey.get(mapping.from) ?? 0) + 1);
      
      const filePath = candidate.filePath;
      const existing = filesToModify.get(filePath) ?? [];
      existing.push({
        ...candidate,
        suggestedKey: mapping.to,
        hash: '', // not needed for renaming
        status: 'pending' as const,
      });
      filesToModify.set(filePath, existing);

      // Capture original content for diffs
      if (generateDiffs || write) {
        // Note: original content handling would need to be adjusted
      }
    }

    // Second pass: apply modifications using adapters
    const updatedFiles: string[] = [];
    if (write || generateDiffs) {
      for (const [filePath, candidates] of filesToModify) {
        const adapter = this.registry.getForFile(filePath);
        if (!adapter) {
          continue;
        }

        // Read the file content
        const content = await fs.readFile(filePath, 'utf-8');
        
        const result = adapter.mutate(filePath, content, candidates, {
          config: this.config,
          workspaceRoot: this.workspaceRoot,
          translationAdapter: { module: '@i18nsmith/core', hookName: this.translationIdentifier },
        });

        if (result.didMutate) {
          if (write) {
            await fs.writeFile(filePath, result.content, 'utf-8');
          }
          updatedFiles.push(filePath);
          
          // Handle diffs
          if (generateDiffs) {
            // Generate diffs using result.edits
            // This would need to be implemented
          }
        }
      }
    }

    // Generate diffs before saving
    const diffs: SourceFileDiffEntry[] = [];
    if (generateDiffs) {
      // TODO: Implement diff generation using adapter mutation results
      // For now, diffs are not generated
    }

    const mappingSummaries: KeyRenameMappingSummary[] = mappings.map((mapping) => {
      const analysis = localeAnalysis.get(mapping.from);
      return {
        from: mapping.from,
        to: mapping.to,
        occurrences: occurrencesByKey.get(mapping.from) ?? 0,
        localePreview: analysis?.localePreview ?? [],
        missingLocales: analysis?.missingLocales ?? [],
      };
    });

    // Capture original locale data before any modifications
    const originalLocaleData = new Map<string, Record<string, string>>();
    if (generateDiffs) {
      const storedLocales = await this.localeStore.getStoredLocales();
      const allLocales = new Set([this.sourceLocale, ...this.targetLocales, ...storedLocales]);
      for (const locale of allLocales) {
        originalLocaleData.set(locale, await this.localeStore.get(locale));
      }
    }

    if (write || generateDiffs) {
      for (const mapping of mappings) {
        const analysis = localeAnalysis.get(mapping.from);
        if (!analysis) {
          continue;
        }

        for (const preview of analysis.localePreview) {
          if (preview.missing) {
            continue;
          }

          // If target exists (duplicate), we still want to remove the old key (merge behavior)
          // If target doesn't exist, we rename (move behavior)
          if (preview.duplicate) {
            // Just remove the old key, as the new key already exists
            await this.localeStore.remove(preview.locale, mapping.from);
          } else {
            const result = await this.localeStore.renameKey(preview.locale, mapping.from, mapping.to);
            if (result === 'duplicate') {
              if (allowConflicts) {
                // If conflicts are allowed, just remove the old key (merge)
                await this.localeStore.remove(preview.locale, mapping.from);
              } else {
                throw new Error(
                  `Target key "${mapping.to}" already exists in locale ${preview.locale}. Rename aborted to prevent data loss.`
                );
              }
            }
          }
        }
      }
    }

    const localeStats = write ? await this.localeStore.flush() : [];
    
    const currentLocaleData = new Map<string, Record<string, string>>();
    if (generateDiffs) {
      const storedLocales = await this.localeStore.getStoredLocales();
      const allLocales = new Set([this.sourceLocale, ...this.targetLocales, ...storedLocales]);
      for (const locale of allLocales) {
        currentLocaleData.set(locale, await this.localeStore.get(locale));
      }
    }

    const localeDiffs = generateDiffs
      ? buildLocaleDiffs(
          originalLocaleData,
          currentLocaleData,
          (locale) => this.localeStore.getFilePath(locale),
          this.workspaceRoot
        )
      : [];

    const totalOccurrences = mappingSummaries.reduce((sum, item) => sum + item.occurrences, 0);
    const actionableItems = this.buildActionableItems(mappingSummaries, allowConflicts);

    return {
      filesScanned: scanSummary.candidates.length,
      filesUpdated: updatedFiles.map((filePath) => this.getRelativePath(filePath)),
      occurrences: totalOccurrences,
      localeStats,
      mappingSummaries,
      write,
      actionableItems,
      diffs,
      localeDiffs,
    };
  }

  private buildActionableItems(
    mappingSummaries: KeyRenameMappingSummary[],
    allowConflicts: boolean = false
  ): ActionableItem[] {
    const items: ActionableItem[] = [];
    mappingSummaries.forEach((mapping) => {
      if (mapping.occurrences === 0) {
        items.push({
          kind: 'rename-no-occurrences',
          severity: 'warn',
          key: mapping.from,
          message: `No usages of "${mapping.from}" were found in source files.`,
          details: { to: mapping.to },
        });
      }

      mapping.localePreview.forEach((preview) => {
        if (preview.missing) {
          items.push({
            kind: 'rename-missing-locale',
            severity: 'warn',
            key: mapping.from,
            locale: preview.locale,
            message: `Locale ${preview.locale} is missing key "${mapping.from}".`,
          });
        }
        if (preview.duplicate) {
          items.push({
            kind: 'rename-duplicate-target',
            severity: allowConflicts ? 'warn' : 'error',
            key: mapping.to,
            locale: preview.locale,
            message: `Locale ${preview.locale} already has key "${mapping.to}".`,
          });
        }
      });
    });

    return items;
  }

  private async buildLocaleAnalysis(mappings: KeyRenameMapping[]): Promise<Map<string, MappingLocaleAnalysis>> {
    const storedLocales = await this.localeStore.getStoredLocales();
    const locales = new Set([this.sourceLocale, ...this.targetLocales, ...storedLocales]);
    const cache = new Map<string, Record<string, string>>();
    const getLocaleData = async (locale: string) => {
      if (!cache.has(locale)) {
        cache.set(locale, await this.localeStore.get(locale));
      }
      return cache.get(locale)!;
    };

    const analysis = new Map<string, MappingLocaleAnalysis>();

    for (const mapping of mappings) {
      const localePreview: KeyRenameLocalePreview[] = [];
      const missingLocales: string[] = [];
      const duplicateLocales: string[] = [];

      for (const locale of locales) {
        const data = await getLocaleData(locale);
        const missing = typeof data[mapping.from] === 'undefined';
        const duplicate = !missing && typeof data[mapping.to] !== 'undefined';

        localePreview.push({
          locale,
          renamedFrom: mapping.from,
          renamedTo: mapping.to,
          missing,
          duplicate,
        });

        if (missing) {
          missingLocales.push(locale);
        } else if (duplicate) {
          duplicateLocales.push(locale);
        }
      }

      analysis.set(mapping.from, {
        localePreview,
        missingLocales,
        duplicateLocales,
      });
    }

    return analysis;
  }

  private loadFiles() {
    const patterns = this.resolveGlobPatterns(this.getGlobPatterns());
    let files = this.project.getSourceFiles();
    if (files.length === 0) {
      files = this.project.addSourceFilesAtPaths(patterns);
    }
    return files;
  }

  private normalizeMappings(mappings: KeyRenameMapping[]): KeyRenameMapping[] {
    return mappings
      .map(({ from, to }) => ({ from: from?.trim(), to: to?.trim() }))
      .filter((mapping): mapping is KeyRenameMapping => Boolean(mapping.from) && Boolean(mapping.to))
      .filter((mapping) => mapping.from !== mapping.to);
  }

  private getGlobPatterns(): string[] {
    const includes = Array.isArray(this.config.include) && this.config.include.length
      ? this.config.include
      : DEFAULT_INCLUDE;
    const excludes = this.config.exclude?.map((pattern) => `!${pattern}`) ?? [];
    return [...includes, ...excludes];
  }

  private isTranslationCall(node: Node): boolean {
    // Simple identifier: t('key')
    if (Node.isIdentifier(node) && node.getText() === this.translationIdentifier) {
      return true;
    }

    // Property access: i18n.t('key')
    if (Node.isPropertyAccessExpression(node)) {
      const name = node.getName();
      if (name === this.translationIdentifier) {
        return true;
      }
      // Recursive check for nested property access like i18n.methods.t
      return this.isTranslationCall(node.getExpression());
    }

    return false;
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

  /**
   * Find Vue files in the workspace that match the include patterns.
   */
  private findVueFiles(): string[] {
    const patterns = this.getGlobPatterns();
    const vuePatterns = patterns
      .filter(p => !p.startsWith('!'))
      .map(p => {
        // Convert generic patterns to Vue-specific ones
        if (p.endsWith('.ts') || p.endsWith('.tsx') || p.endsWith('.js') || p.endsWith('.jsx')) {
          return p.replace(/\.(ts|tsx|js|jsx)$/, '.vue');
        }
        if (p.includes('*.{')) {
          // Replace extensions with just .vue
          return p.replace(/\.{[^}]+}/, '.vue');
        }
        // For other patterns, add .vue extension
        if (p.includes('*') && !p.includes('.vue')) {
          return p.replace(/(\*\*\/\*+)(.*)$/, '$1.vue');
        }
        return p;
      });
    
    // Also add explicit Vue patterns
    const includePatterns = [...new Set([
      ...vuePatterns,
      '**/*.vue',
    ])];
    
    const excludePatterns = patterns
      .filter(p => p.startsWith('!'))
      .map(p => p.slice(1));
    
    try {
      const resolvedInclude = includePatterns.map(p => 
        path.isAbsolute(p) ? p : path.join(this.workspaceRoot, p)
      );
      const resolvedExclude = excludePatterns.map(p =>
        path.isAbsolute(p) ? p : path.join(this.workspaceRoot, p)
      );
      
      return fg.sync(resolvedInclude, {
        ignore: [...resolvedExclude, '**/node_modules/**'],
        absolute: true,
      });
    } catch {
      return [];
    }
  }

  /**
   * Count and apply key renames in a Vue file using vue-eslint-parser.
   */
  private async processVueFile(
    filePath: string,
    mappingBySource: Map<string, KeyRenameMapping>,
    occurrencesByKey: Map<string, number>,
    applyChanges: boolean
  ): Promise<{ hasMatches: boolean; original: string; modified: string }> {
    const vueParser = getVueEslintParser();
    const content = await fs.readFile(filePath, 'utf-8');
    
    if (!vueParser || typeof vueParser.parse !== 'function') {
      if (!_vueParserMissingWarned) {
        _vueParserMissingWarned = true;
        console.warn('[i18nsmith] vue-eslint-parser is not installed. Vue key renaming will be skipped for .vue files.');
      }
      // Parser not available, skip Vue files
      return { hasMatches: false, original: content, modified: content };
    }

    try {
      const ast = vueParser.parse(content, { sourceType: 'module', ecmaVersion: 2020 });
      const magicString = new MagicString(content);
      let hasMatches = false;

      // Collect all translation call positions and their new keys
      const replacements: Array<{ start: number; end: number; newKey: string }> = [];

      const visit = (node: any) => {
        if (!node) return;

        if (node.type === 'CallExpression' && this.isEstreeTranslationCall(node)) {
          const args = node.arguments;
          if (args && args.length > 0) {
            const arg = args[0];
            let key: string | undefined;
            let argStart: number | undefined;
            let argEnd: number | undefined;

            if (arg.type === 'Literal' && typeof arg.value === 'string') {
              key = arg.value;
              // Position is the whole literal including quotes
              argStart = arg.range?.[0] ?? arg.start;
              argEnd = arg.range?.[1] ?? arg.end;
            } else if (arg.type === 'TemplateLiteral' && arg.quasis.length === 1 && arg.expressions.length === 0) {
              key = arg.quasis[0].value.raw;
              argStart = arg.range?.[0] ?? arg.start;
              argEnd = arg.range?.[1] ?? arg.end;
            }

            if (key && argStart !== undefined && argEnd !== undefined) {
              let mapping = mappingBySource.get(key);
              if (!mapping) {
                const normalized = key.replace(/\s+/g, ' ').trim();
                mapping = mappingBySource.get(normalized);
              }

              if (mapping) {
                occurrencesByKey.set(mapping.from, (occurrencesByKey.get(mapping.from) ?? 0) + 1);
                hasMatches = true;

                if (applyChanges) {
                  replacements.push({
                    start: argStart,
                    end: argEnd,
                    newKey: mapping.to,
                  });
                }
              }
            }
          }
        }

        // Recursively visit
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
      visit(ast.body);

      // Apply replacements in reverse order to maintain correct positions
      if (applyChanges && replacements.length > 0) {
        replacements.sort((a, b) => b.start - a.start);
        for (const { start, end, newKey } of replacements) {
          // Determine the quote style from the original
          const original = content.substring(start, end);
          let replacement: string;
          if (original.startsWith("'")) {
            replacement = `'${newKey}'`;
          } else if (original.startsWith('"')) {
            replacement = `"${newKey}"`;
          } else if (original.startsWith('`')) {
            replacement = `\`${newKey}\``;
          } else {
            replacement = `'${newKey}'`;
          }
          magicString.overwrite(start, end, replacement);
        }
      }

      return {
        hasMatches,
        original: content,
        modified: replacements.length > 0 ? magicString.toString() : content,
      };
    } catch (e) {
      console.warn(`Failed to parse Vue file ${filePath}:`, e);
      return { hasMatches: false, original: content, modified: content };
    }
  }

  /**
   * Check if an ESTree node is a translation call.
   */
  private isEstreeTranslationCall(node: any): boolean {
    if (node.type !== 'CallExpression') return false;
    const callee = node.callee;

    // t('...') or $t('...')
    if (callee.type === 'Identifier' && (callee.name === this.translationIdentifier || callee.name === '$t')) {
      return true;
    }

    // this.$t('...') or i18n.t('...')
    if (callee.type === 'MemberExpression') {
      const prop = callee.property;
      if (prop.type === 'Identifier' && (prop.name === 't' || prop.name === '$t')) {
        return true;
      }
    }

    return false;
  }
}
