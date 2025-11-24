import path from 'path';
import { Node, Project, SourceFile } from 'ts-morph';
import { I18nConfig } from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';

export interface KeyRenameOptions {
  write?: boolean;
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

export interface KeyRenamerOptions {
  workspaceRoot?: string;
  project?: Project;
  localeStore?: LocaleStore;
  translationIdentifier?: string;
}

export interface KeyRenameLocalePreview {
  locale: string;
  renamedFrom: string;
  renamedTo: string;
  missing: boolean;
  duplicate: boolean;
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

    const write = options.write ?? false;
    const files = this.loadFiles();
  const filesToSave = new Map<string, SourceFile>();
    let occurrences = 0;

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
        if (arg.getLiteralText() !== oldKey) {
          return;
        }
        occurrences += 1;
        if (write) {
          arg.setLiteralValue(newKey);
          fileTouched = true;
        }
      });
      if (fileTouched) {
        filesToSave.set(file.getFilePath(), file);
      }
    }

  const localePreview: KeyRenameLocalePreview[] = [];
    const missingLocales: string[] = [];

    const locales = [this.sourceLocale, ...this.targetLocales];
    for (const locale of locales) {
      const data = await this.localeStore.get(locale);
      if (typeof data[oldKey] === 'undefined') {
        missingLocales.push(locale);
        localePreview.push({
          locale,
          renamedFrom: oldKey,
          renamedTo: newKey,
          missing: true,
          duplicate: false,
        });
        continue;
      }

      if (typeof data[newKey] !== 'undefined') {
        localePreview.push({
          locale,
          renamedFrom: oldKey,
          renamedTo: newKey,
          missing: false,
          duplicate: true,
        });
        continue;
      }

      localePreview.push({
        locale,
        renamedFrom: oldKey,
        renamedTo: newKey,
        missing: false,
        duplicate: false,
      });

      if (write) {
        await this.localeStore.renameKey(locale, oldKey, newKey);
      }
    }

    if (write) {
      await Promise.all(Array.from(filesToSave.values()).map((file) => file.save()));
    }

    const localeStats = write ? await this.localeStore.flush() : [];

    return {
      filesScanned: files.length,
  filesUpdated: Array.from(filesToSave.keys()).map((filePath) => this.getRelativePath(filePath)),
      occurrences,
      localeStats,
      localePreview,
      missingLocales,
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
