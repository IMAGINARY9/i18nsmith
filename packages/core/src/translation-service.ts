import path from 'path';
import { DEFAULT_EMPTY_VALUE_MARKERS, DEFAULT_PLACEHOLDER_FORMATS, I18nConfig } from './config.js';
import { LocaleFileStats, LocaleStore } from './locale-store.js';
import { PlaceholderValidator } from './placeholders.js';

export interface TranslationServiceOptions {
  workspaceRoot?: string;
  localeStore?: LocaleStore;
}

export interface BuildTranslationPlanOptions {
  locales?: string[];
  force?: boolean;
  treatEmptyAsMissing?: boolean;
}

export interface TranslationTask {
  key: string;
  sourceValue: string;
  existingValue?: string;
  reusedValue?: {
    locale: string;
    value: string;
  };
  placeholders: string[];
}

export interface TranslationLocalePlan {
  locale: string;
  tasks: TranslationTask[];
  totalCharacters: number;
  missingCount: number;
  existingCount: number;
}

export interface TranslationPlan {
  sourceLocale: string;
  targetLocales: string[];
  locales: TranslationLocalePlan[];
  totalCharacters: number;
  totalTasks: number;
}

export interface TranslationUpdate {
  key: string;
  value: string;
}

export interface TranslationWriteOptions {
  overwrite?: boolean;
  skipEmpty?: boolean;
}

export interface TranslationWriteSummary {
  locale: string;
  attempted: number;
  written: number;
  skipped: number;
  emptySkipped: number;
}

const DEFAULT_SKIP_EMPTY = true;

export class TranslationService {
  private readonly workspaceRoot: string;
  private readonly localeStore: LocaleStore;
  private readonly sourceLocale: string;
  private readonly targetLocales: string[];
  private readonly emptyValueMarkers: Set<string>;
  private readonly placeholderValidator: PlaceholderValidator;

  constructor(private readonly config: I18nConfig, options: TranslationServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    const localesDir = path.resolve(this.workspaceRoot, config.localesDir ?? 'locales');
    this.localeStore =
      options.localeStore ?? new LocaleStore(localesDir, {
        format: config.locales?.format,
        delimiter: config.locales?.delimiter,
        sortKeys: config.locales?.sortKeys ?? 'alphabetical',
      });
    this.sourceLocale = config.sourceLanguage ?? 'en';
    const configuredTargets = Array.from(new Set((config.targetLanguages ?? []).filter(Boolean)));
    this.targetLocales = configuredTargets.filter((locale) => locale !== this.sourceLocale);
    const emptyMarkers = config.sync?.emptyValueMarkers?.length
      ? config.sync.emptyValueMarkers
      : DEFAULT_EMPTY_VALUE_MARKERS;
    this.emptyValueMarkers = new Set(emptyMarkers.map((marker) => marker.toLowerCase()));
    const placeholderFormats = config.sync?.placeholderFormats?.length
      ? config.sync.placeholderFormats
      : DEFAULT_PLACEHOLDER_FORMATS;
    this.placeholderValidator = new PlaceholderValidator(placeholderFormats);
  }

  public async buildPlan(options: BuildTranslationPlanOptions = {}): Promise<TranslationPlan> {
    const locales = this.resolveLocales(options.locales);
    if (!locales.length) {
      throw new Error('No target locales configured. Update "targetLanguages" in i18n.config.json.');
    }

    const treatEmptyAsMissing = options.treatEmptyAsMissing ?? true;
    const force = options.force ?? false;
    const sourceData = await this.localeStore.get(this.sourceLocale);
    const keys = Object.keys(sourceData).sort((a, b) => a.localeCompare(b));
    const localePlans: TranslationLocalePlan[] = [];

    const allTargetData = new Map<string, Record<string, string>>();
    for (const l of this.targetLocales) {
      allTargetData.set(l, await this.localeStore.get(l));
    }

    let totalCharacters = 0;
    let totalTasks = 0;

    for (const locale of locales) {
      const targetData = allTargetData.get(locale) ?? {};
      const tasks: TranslationTask[] = [];
      let localeCharacters = 0;
      let missingCount = 0;
      let existingCount = 0;

      for (const key of keys) {
        const sourceValue = sourceData[key];
        if (typeof sourceValue !== 'string' || !sourceValue.trim().length) {
          continue;
        }

        const currentValue = targetData[key];
        const hasMeaningfulValue = this.hasMeaningfulValue(currentValue, treatEmptyAsMissing);
        if (!force && hasMeaningfulValue) {
          continue;
        }

        let reusedValue: TranslationTask['reusedValue'] | undefined;
        if (!hasMeaningfulValue) {
          const suggestion = this.findSuggestion(key, locale, allTargetData);
          if (suggestion && this.hasMeaningfulValue(suggestion.value, true)) {
            reusedValue = {
              locale: suggestion.locale,
              value: suggestion.value,
            };
          }
        }

        if (typeof currentValue === 'string') {
          existingCount += 1;
        } else {
          missingCount += 1;
        }

        localeCharacters += sourceValue.length;
        tasks.push({
          key,
          sourceValue,
          existingValue: typeof currentValue === 'string' ? currentValue : undefined,
          reusedValue,
          placeholders: Array.from(this.placeholderValidator.extract(sourceValue)),
        });
      }

      if (!tasks.length) {
        continue;
      }

      localePlans.push({
        locale,
        tasks,
        totalCharacters: localeCharacters,
        missingCount,
        existingCount,
      });

      totalCharacters += localeCharacters;
      totalTasks += tasks.length;
    }

    return {
      sourceLocale: this.sourceLocale,
      targetLocales: locales,
      locales: localePlans,
      totalCharacters,
      totalTasks,
    };
  }

  public async writeTranslations(
    locale: string,
    updates: TranslationUpdate[],
    options: TranslationWriteOptions = {}
  ): Promise<TranslationWriteSummary> {
    if (!updates.length) {
      return { locale, attempted: 0, written: 0, skipped: 0, emptySkipped: 0 };
    }

    const overwrite = options.overwrite ?? false;
    const skipEmpty = options.skipEmpty ?? DEFAULT_SKIP_EMPTY;
    const treatEmptyAsMissing = true;
    const existingValues = await this.localeStore.get(locale);

    let written = 0;
    let skipped = 0;
    let emptySkipped = 0;

    for (const update of updates) {
      const nextValue = typeof update.value === 'string' ? update.value : '';
      if (skipEmpty && !nextValue.trim().length) {
        emptySkipped += 1;
        continue;
      }

      if (!overwrite && this.hasMeaningfulValue(existingValues[update.key], treatEmptyAsMissing)) {
        skipped += 1;
        continue;
      }

      const status = await this.localeStore.upsert(locale, update.key, nextValue);
      if (status === 'unchanged') {
        skipped += 1;
      } else {
        written += 1;
      }
    }

    return {
      locale,
      attempted: updates.length,
      written,
      skipped,
      emptySkipped,
    };
  }

  public async flush(): Promise<LocaleFileStats[]> {
    return this.localeStore.flush();
  }

  private findSuggestion(
    key: string,
    targetLocale: string,
    allData: Map<string, Record<string, string>>
  ): { locale: string; value: string } | undefined {
    const baseLanguage = targetLocale.split('-')[0];
    const searchOrder = [
      // Exact match already failed, so we look for related locales
      ...this.targetLocales.filter((l) => l.startsWith(`${baseLanguage}-`) && l !== targetLocale),
      // Fallback to base language if available
      this.targetLocales.find((l) => l === baseLanguage),
    ].filter((l): l is string => Boolean(l));

    for (const locale of searchOrder) {
      const data = allData.get(locale);
      const value = data?.[key];
      if (this.hasMeaningfulValue(value, true)) {
        return { locale, value: value as string };
      }
    }

    return undefined;
  }

  private resolveLocales(requested?: string[]): string[] {
    if (!requested || !requested.length) {
      return [...this.targetLocales];
    }

    const normalized = requested
      .map((locale) => locale?.trim())
      .filter((locale): locale is string => Boolean(locale));

    const allowed = new Set(this.targetLocales);
    const filtered = normalized.filter((locale) => allowed.has(locale));
    return filtered.length ? filtered : [...this.targetLocales];
  }

  private hasMeaningfulValue(value: unknown, treatEmpty: boolean): boolean {
    if (typeof value !== 'string') {
      return false;
    }

    if (!treatEmpty) {
      return true;
    }

    const trimmed = value.trim();
    if (!trimmed.length) {
      return false;
    }

    return !this.emptyValueMarkers.has(trimmed.toLowerCase());
  }
}
