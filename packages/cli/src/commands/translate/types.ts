/**
 * Type definitions for the translate command
 */

import type { TranslationWriteSummary, TranslationPlan } from '@i18nsmith/core';
import type { TranslationService } from '@i18nsmith/core';

export interface TranslateCommandOptions {
  config?: string;
  json?: boolean;
  report?: string;
  write?: boolean;
  locales?: string[];
  provider?: string;
  force?: boolean;
  estimate?: boolean;
  skipEmpty?: boolean;
  yes?: boolean;
  strictPlaceholders?: boolean;
  export?: string;
  import?: string;
}

export interface TranslateLocaleResult extends TranslationWriteSummary {
  characters: number;
  placeholderIssues: PlaceholderIssue[];
}

export interface PlaceholderIssue {
  key: string;
  locale: string;
  type: 'missing' | 'extra';
  placeholders: string[];
}

export interface TranslateSummary {
  provider: string;
  dryRun: boolean;
  plan: TranslationPlan;
  locales: TranslateLocaleResult[];
  localeStats: Awaited<ReturnType<TranslationService['flush']>>;
  totalCharacters: number;
}

export interface ProviderSettings {
  name: string;
  options?: Record<string, unknown>;
}

export interface CsvRow {
  key: string;
  sourceLocale: string;
  sourceValue: string;
  targetLocale: string;
  targetValue: string;
}
