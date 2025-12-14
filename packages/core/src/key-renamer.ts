import path from 'path';
import { Node, Project, SourceFile } from 'ts-morph';
import { I18nConfig } from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';
import { ActionableItem } from './actionable.js';
import { createUnifiedDiff, SourceFileDiffEntry } from './diff-utils.js';
import { createDefaultProject } from './project-factory.js';

export interface KeyRenamerOptions {
  workspaceRoot?: string;
  project?: Project;
  localeStore?: LocaleStore;
  translationIdentifier?: string;
}

export interface KeyRenameOptions {
  write?: boolean;
  diff?: boolean;
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

    if (duplicateConflicts.length && write) {
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

    const files = this.loadFiles();
    const filesToSave = new Map<string, SourceFile>();
    const mappingBySource = new Map<string, KeyRenameMapping>();

    // Store original content for diff generation
    const originalContents = new Map<string, string>();

    for (const mapping of mappings) {
      if (mappingBySource.has(mapping.from)) {
        throw new Error(`Duplicate mapping detected for key "${mapping.from}".`);
      }
      mappingBySource.set(mapping.from, mapping);
    }

    const occurrencesByKey = new Map<string, number>();
    const filesToModify = new Set<SourceFile>();

    // First pass: identify files to modify and count occurrences
    for (const file of files) {
      let hasMatch = false;
      file.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) {
          return;
        }
        const callee = node.getExpression();
        if (!Node.isIdentifier(callee) || callee.getText() !== this.translationIdentifier) {
          return;
        }
        const [arg] = node.getArguments();
        if (!arg || !Node.isStringLiteral(arg)) {
          return;
        }
        const literal = arg.getLiteralText();
        const mapping = mappingBySource.get(literal);
        if (!mapping) {
          return;
        }

        occurrencesByKey.set(literal, (occurrencesByKey.get(literal) ?? 0) + 1);
        hasMatch = true;
      });

      if (hasMatch) {
        filesToModify.add(file);
        // Capture original content for diffs
        if (generateDiffs || write) {
          originalContents.set(file.getFilePath(), file.getFullText());
        }
      }
    }

    // Second pass: apply modifications (only if writing or generating diffs)
    if (write || generateDiffs) {
      for (const file of filesToModify) {
        file.forEachDescendant((node) => {
          if (!Node.isCallExpression(node)) {
            return;
          }
          const callee = node.getExpression();
          if (!Node.isIdentifier(callee) || callee.getText() !== this.translationIdentifier) {
            return;
          }
          const [arg] = node.getArguments();
          if (!arg || !Node.isStringLiteral(arg)) {
            return;
          }
          const literal = arg.getLiteralText();
          const mapping = mappingBySource.get(literal);
          if (mapping) {
            arg.setLiteralValue(mapping.to);
          }
        });

        filesToSave.set(file.getFilePath(), file);
      }
    }

    // Generate diffs before saving
    const diffs: SourceFileDiffEntry[] = [];
    if (generateDiffs) {
      for (const [filePath, file] of filesToSave) {
        const original = originalContents.get(filePath) ?? '';
        const modified = file.getFullText();
        const diff = createUnifiedDiff(filePath, original, modified, this.workspaceRoot);
        if (diff) {
          diffs.push(diff);
        }
      }
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

    if (write) {
      for (const mapping of mappings) {
        const analysis = localeAnalysis.get(mapping.from);
        if (!analysis) {
          continue;
        }

        for (const preview of analysis.localePreview) {
          if (preview.missing || preview.duplicate) {
            continue;
          }

          const result = await this.localeStore.renameKey(preview.locale, mapping.from, mapping.to);
          if (result === 'duplicate') {
            throw new Error(
              `Target key "${mapping.to}" already exists in locale ${preview.locale}. Rename aborted to prevent data loss.`
            );
          }
        }
      }
    }

    if (write) {
      await Promise.all(Array.from(filesToSave.values()).map((file) => file.save()));
    }

    const localeStats = write ? await this.localeStore.flush() : [];
    const totalOccurrences = mappingSummaries.reduce((sum, item) => sum + item.occurrences, 0);
    const actionableItems = this.buildActionableItems(mappingSummaries);

    return {
      filesScanned: files.length,
      filesUpdated: Array.from(filesToSave.keys()).map((filePath) => this.getRelativePath(filePath)),
      occurrences: totalOccurrences,
      localeStats,
      mappingSummaries,
      write,
      actionableItems,
      diffs,
    };
  }

  private buildActionableItems(mappingSummaries: KeyRenameMappingSummary[]): ActionableItem[] {
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
            severity: 'error',
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
    const locales = [this.sourceLocale, ...this.targetLocales];
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
}
