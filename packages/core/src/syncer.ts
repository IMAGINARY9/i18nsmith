import path from 'path';
import { CallExpression, Node, Project, SourceFile } from 'ts-morph';
import { I18nConfig } from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';

export interface TranslationReference {
  key: string;
  filePath: string;
  position: {
    line: number;
    column: number;
  };
}

export interface MissingKeyRecord {
  key: string;
  references: TranslationReference[];
}

export interface UnusedKeyRecord {
  key: string;
  locales: string[];
}

export interface SyncSummary {
  filesScanned: number;
  references: TranslationReference[];
  missingKeys: MissingKeyRecord[];
  unusedKeys: UnusedKeyRecord[];
  localeStats: LocaleFileStats[];
  localePreview: LocaleDiffPreview[];
  write: boolean;
}

export interface LocaleDiffPreview {
  locale: string;
  add: string[];
  remove: string[];
}

export interface SyncerOptions {
  workspaceRoot?: string;
  project?: Project;
  localeStore?: LocaleStore;
  translationIdentifier?: string;
}

export interface SyncRunOptions {
  write?: boolean;
}

export class Syncer {
  private readonly project: Project;
  private readonly workspaceRoot: string;
  private readonly localeStore: LocaleStore;
  private readonly translationIdentifier: string;
  private readonly sourceLocale: string;
  private readonly targetLocales: string[];

  constructor(private readonly config: I18nConfig, options: SyncerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.project = options.project ?? new Project({
      skipAddingFilesFromTsConfig: true,
    });
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
  this.localeStore = options.localeStore ?? new LocaleStore(localesDir);
  this.translationIdentifier = options.translationIdentifier ?? this.config.sync?.translationIdentifier ?? 't';
    this.sourceLocale = config.sourceLanguage ?? 'en';
    this.targetLocales = (config.targetLanguages ?? []).filter(Boolean);
  }

  public async run(runOptions: SyncRunOptions = {}): Promise<SyncSummary> {
    const write = runOptions.write ?? false;
    const files = this.loadFiles();
    const { references, referencesByKey, keySet } = this.collectReferences(files);

    const localeKeySets = await this.collectLocaleKeys();
    const sourceLocaleKeys = localeKeySets.get(this.sourceLocale) ?? new Set<string>();

    const localeDiff = new Map<string, { add: Set<string>; remove: Set<string> }>();

    const previewAdd = (locale: string, key: string) => {
      if (!localeDiff.has(locale)) {
        localeDiff.set(locale, { add: new Set(), remove: new Set() });
      }
      localeDiff.get(locale)!.add.add(key);
    };

    const previewRemove = (locale: string, key: string) => {
      if (!localeDiff.has(locale)) {
        localeDiff.set(locale, { add: new Set(), remove: new Set() });
      }
      localeDiff.get(locale)!.remove.add(key);
    };

    const missingKeys = Array.from(keySet)
      .filter((key) => !sourceLocaleKeys.has(key))
      .map((key) => ({
        key,
        references: referencesByKey.get(key) ?? [],
      }));

    for (const record of missingKeys) {
      previewAdd(this.sourceLocale, record.key);
      if (this.config.seedTargetLocales) {
        for (const locale of this.targetLocales) {
          previewAdd(locale, record.key);
        }
      }
    }

    const unusedKeyMap = new Map<string, Set<string>>();
    for (const [locale, keys] of localeKeySets) {
      for (const key of keys) {
        if (keySet.has(key)) {
          continue;
        }
        if (!unusedKeyMap.has(key)) {
          unusedKeyMap.set(key, new Set());
        }
        unusedKeyMap.get(key)!.add(locale);
      }
    }

    const unusedKeys: UnusedKeyRecord[] = Array.from(unusedKeyMap.entries()).map(([key, locales]) => {
      const localeList = Array.from(locales).sort();
      localeList.forEach((locale) => previewRemove(locale, key));
      return {
        key,
        locales: localeList,
      };
    });

    let localeStats: LocaleFileStats[] = [];
    if (write) {
      await this.applyMissingKeys(missingKeys);
      await this.applyUnusedKeys(unusedKeys);
      localeStats = await this.localeStore.flush();
    }

    const localePreview: LocaleDiffPreview[] = Array.from(localeDiff.entries()).map(([locale, diff]) => ({
      locale,
      add: Array.from(diff.add).sort(),
      remove: Array.from(diff.remove).sort(),
    }));

    return {
      filesScanned: files.length,
      references,
      missingKeys,
      unusedKeys,
      localeStats,
      localePreview,
      write,
    };
  }

  private loadFiles(): SourceFile[] {
    const patterns = this.resolveGlobPatterns(this.getGlobPatterns());
    let files = this.project.getSourceFiles();
    if (files.length === 0) {
      files = this.project.addSourceFilesAtPaths(patterns);
    }
    return files;
  }

  private collectReferences(files: SourceFile[]) {
    const references: TranslationReference[] = [];
    const referencesByKey = new Map<string, TranslationReference[]>();
    const keySet = new Set<string>();

    for (const file of files) {
      file.forEachDescendant((node) => {
        if (!Node.isCallExpression(node)) {
          return;
        }

        const key = this.extractKeyFromCall(node);
        if (!key) {
          return;
        }

        const reference = this.createReference(file, node, key);
        references.push(reference);
        keySet.add(key);
        if (!referencesByKey.has(key)) {
          referencesByKey.set(key, []);
        }
        referencesByKey.get(key)!.push(reference);
      });
    }

    return { references, referencesByKey, keySet };
  }

  private extractKeyFromCall(node: CallExpression): string | undefined {
    const callee = node.getExpression();
    if (!Node.isIdentifier(callee) || callee.getText() !== this.translationIdentifier) {
      return undefined;
    }

    const [arg] = node.getArguments();
    if (!arg) {
      return undefined;
    }

    if (Node.isStringLiteral(arg)) {
      return arg.getLiteralText();
    }

    if (Node.isNoSubstitutionTemplateLiteral(arg)) {
      return arg.getLiteralText();
    }

    return undefined;
  }

  private createReference(file: SourceFile, node: CallExpression, key: string): TranslationReference {
    const position = file.getLineAndColumnAtPos(node.getStart());
    return {
      key,
      filePath: this.getRelativePath(file.getFilePath()),
      position,
    };
  }

  private async collectLocaleKeys(): Promise<Map<string, Set<string>>> {
    const locales = [this.sourceLocale, ...this.targetLocales];
    const result = new Map<string, Set<string>>();

    for (const locale of locales) {
      const data = await this.localeStore.get(locale);
      result.set(locale, new Set(Object.keys(data)));
    }

    return result;
  }

  private async applyMissingKeys(missingKeys: MissingKeyRecord[]) {
    for (const record of missingKeys) {
      await this.localeStore.upsert(this.sourceLocale, record.key, record.key);
      if (this.config.seedTargetLocales) {
        for (const locale of this.targetLocales) {
          await this.localeStore.upsert(locale, record.key, '');
        }
      }
    }
  }

  private async applyUnusedKeys(unusedKeys: UnusedKeyRecord[]) {
    for (const record of unusedKeys) {
      for (const locale of record.locales) {
        await this.localeStore.remove(locale, record.key);
      }
    }
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
