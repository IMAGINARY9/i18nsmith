/**
 * Translation execution logic with retry, batching, and placeholder validation
 */

import chalk from 'chalk';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import type { PlaceholderValidator, TranslationPlan, TranslationService, TranslationLocalePlan } from '@i18nsmith/core';
import { loadTranslator, type Translator, type TranslatorLoadOptions } from '@i18nsmith/translation';
import type { TranslateLocaleResult, PlaceholderIssue } from './types.js';

export interface ExecuteTranslationsInput {
  plan: TranslationPlan;
  translationService: TranslationService;
  provider: {
    name: string;
    loaderOptions: TranslatorLoadOptions;
  };
  overwrite: boolean;
  skipEmpty: boolean;
  placeholderValidator: PlaceholderValidator;
  strictPlaceholders: boolean;
}

export interface ExecuteTranslationsResult {
  results: TranslateLocaleResult[];
  stats: Awaited<ReturnType<TranslationService['flush']>>;
}

/**
 * Execute translations for all locales in the plan
 */
export async function executeTranslations(
  input: ExecuteTranslationsInput
): Promise<ExecuteTranslationsResult> {
  const translator = await loadTranslator(input.provider.loaderOptions);
  const results: TranslateLocaleResult[] = [];
  const limit = pLimit(input.provider.loaderOptions.concurrency ?? 4);

  try {
    const translationPromises = input.plan.locales.map((localePlan) =>
      limit(async () => {
        const { updates, placeholderIssues } = await translateLocalePlan(
          translator,
          localePlan,
          input.plan.sourceLocale,
          input.provider.loaderOptions.batchSize ?? 25,
          input.placeholderValidator,
          input.strictPlaceholders
        );
        const writeSummary = await input.translationService.writeTranslations(localePlan.locale, updates, {
          overwrite: input.overwrite,
          skipEmpty: input.skipEmpty,
        });
        results.push({
          ...writeSummary,
          characters: localePlan.totalCharacters,
          placeholderIssues,
        });
      })
    );

    await Promise.all(translationPromises);

    const stats = await input.translationService.flush();
    // Sort results to match the plan's locale order for consistent output
    results.sort((a, b) => {
      const aIndex = input.plan.locales.findIndex((p) => p.locale === a.locale);
      const bIndex = input.plan.locales.findIndex((p) => p.locale === b.locale);
      return aIndex - bIndex;
    });
    return { results, stats };
  } finally {
    await translator.dispose?.();
  }
}

/**
 * Translate a single locale plan with batching and retry logic
 */
async function translateLocalePlan(
  translator: Translator,
  localePlan: TranslationLocalePlan,
  sourceLocale: string,
  batchSize: number,
  placeholderValidator: PlaceholderValidator,
  strictPlaceholders: boolean
): Promise<{ updates: { key: string; value: string }[]; placeholderIssues: PlaceholderIssue[] }> {
  const updates: { key: string; value: string }[] = [];
  const placeholderIssues: PlaceholderIssue[] = [];

  for (const chunk of chunkTasks(localePlan.tasks, batchSize)) {
    const translationMap = new Map<string, string>();

    // Pre-fill with reused values
    chunk.forEach((task) => {
      if (task.reusedValue) {
        translationMap.set(task.key, task.reusedValue.value);
      }
    });

    const tasksRequiringTranslation = chunk.filter((task) => !task.reusedValue);
    if (tasksRequiringTranslation.length > 0) {
      const sourceTexts = tasksRequiringTranslation.map((task) => task.sourceValue);
      const translated = await pRetry(() => translator.translate(sourceTexts, sourceLocale, localePlan.locale), {
        retries: 3,
        onFailedAttempt: (error) => {
          console.log(
            chalk.yellow(
              `Attempt ${error.attemptNumber} failed translating ${localePlan.locale}. There are ${error.retriesLeft} retries left.`
            )
          );
        },
      });

      if (!Array.isArray(translated) || translated.length !== sourceTexts.length) {
        throw new Error(
          `Translator returned ${translated.length} result(s) for ${sourceTexts.length} input(s) while translating ${localePlan.locale}.`
        );
      }

      tasksRequiringTranslation.forEach((task, index) => {
        const candidate = translated[index] ?? '';
        const comparison = placeholderValidator.compare(task.sourceValue, candidate ?? '');

        if (task.placeholders.length && comparison.missing.length) {
          placeholderIssues.push({
            key: task.key,
            locale: localePlan.locale,
            type: 'missing',
            placeholders: comparison.missing,
          });
          if (!strictPlaceholders) {
            console.log(
              chalk.yellow(
                `Translator output for ${task.key} (${localePlan.locale}) is missing placeholder${
                  comparison.missing.length === 1 ? '' : 's'
                }: ${comparison.missing.join(', ')}. Falling back to source text.`
              )
            );
          }
          translationMap.set(task.key, task.sourceValue);
          return;
        }

        if (comparison.extra.length) {
          placeholderIssues.push({
            key: task.key,
            locale: localePlan.locale,
            type: 'extra',
            placeholders: comparison.extra,
          });
          if (!strictPlaceholders) {
            console.log(
              chalk.yellow(
                `Translator output for ${task.key} (${localePlan.locale}) introduced unexpected placeholder${
                  comparison.extra.length === 1 ? '' : 's'
                }: ${comparison.extra.join(', ')}`
              )
            );
          }
        }

        translationMap.set(task.key, candidate ?? '');
      });
    }

    chunk.forEach((task) => {
      updates.push({ key: task.key, value: translationMap.get(task.key) ?? '' });
    });
  }

  return { updates, placeholderIssues };
}

/**
 * Split an array into chunks of a given size
 */
export function chunkTasks<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
