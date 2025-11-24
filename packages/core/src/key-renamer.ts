import path from 'path';
import { Node, Project, SourceFile } from 'ts-morph';
import { I18nConfig } from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';

export interface KeyRenamerOptions {
  workspaceRoot?: string;
  project?: Project;
  localeStore?: LocaleStore;
  translationIdentifier?: string;
}

export interface KeyRenameOptions {
  write?: boolean;
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
}

export class KeyRenamer {
  private readonly project: Project;
  private readonly workspaceRoot: string;
  private readonly localeStore: LocaleStore;
  private readonly translationIdentifier: string;
  private readonly sourceLocale: string;
  private readonly targetLocales: string[];

  constructor(private readonly config: I18nConfig, options: KeyRenamerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.project = options.project ?? new Project({ skipAddingFilesFromTsConfig: true });
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
    this.localeStore = options.localeStore ?? new LocaleStore(localesDir);
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
    const files = this.loadFiles();
    const filesToSave = new Map<string, SourceFile>();
    const mappingBySource = new Map<string, KeyRenameMapping>();

    for (const mapping of mappings) {
      if (mappingBySource.has(mapping.from)) {
        throw new Error(`Duplicate mapping detected for key "${mapping.from}".`);
      }
      mappingBySource.set(mapping.from, mapping);
    }

    const occurrencesByKey = new Map<string, number>();

    for (const file of files) {
      let fileTouched = false;
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
        if (write) {
          arg.setLiteralValue(mapping.to);
          fileTouched = true;
        }
      });

      if (fileTouched) {
        filesToSave.set(file.getFilePath(), file);
      }
    }

    const mappingSummaries: KeyRenameMappingSummary[] = mappings.map((mapping) => ({
      from: mapping.from,
      to: mapping.to,
      occurrences: occurrencesByKey.get(mapping.from) ?? 0,
      localePreview: [],
      missingLocales: [],
    }));

    const locales = [this.sourceLocale, ...this.targetLocales];
    for (const summary of mappingSummaries) {
      for (const locale of locales) {
        const data = await this.localeStore.get(locale);
        const missing = typeof data[summary.from] === 'undefined';
        const duplicate = !missing && typeof data[summary.to] !== 'undefined';

        summary.localePreview.push({
          locale,
          renamedFrom: summary.from,
          renamedTo: summary.to,
          missing,
          duplicate,
        });

        if (missing) {
          summary.missingLocales.push(locale);
          continue;
        }

        if (duplicate) {
          continue;
        }

        if (write) {
          await this.localeStore.renameKey(locale, summary.from, summary.to);
        }
      }
    }

    if (write) {
      await Promise.all(Array.from(filesToSave.values()).map((file) => file.save()));
    }

    const localeStats = write ? await this.localeStore.flush() : [];
    const totalOccurrences = mappingSummaries.reduce((sum, item) => sum + item.occurrences, 0);

    return {
      filesScanned: files.length,
      filesUpdated: Array.from(filesToSave.keys()).map((filePath) => this.getRelativePath(filePath)),
      occurrences: totalOccurrences,
      localeStats,
      mappingSummaries,
      write,
    };
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
