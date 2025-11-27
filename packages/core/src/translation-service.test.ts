import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { I18nConfig } from './config';
import { TranslationService } from './translation-service';

let tempDir: string;

const baseConfig = (): I18nConfig => ({
  version: 1,
  sourceLanguage: 'en',
  targetLanguages: ['es', 'fr'],
  localesDir: tempDir,
  include: ['src/**/*'],
  exclude: ['node_modules/**'],
  locales: { format: 'flat', delimiter: '.' },
});

describe('TranslationService', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'translation-service-'));
    await fs.writeFile(
      path.join(tempDir, 'en.json'),
      JSON.stringify(
        {
          'common.greeting': 'Hello world',
          'cta.save': 'Save',
          'cta.cancel': 'Cancel',
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(tempDir, 'es.json'),
      JSON.stringify(
        {
          'common.greeting': '',
        },
        null,
        2
      )
    );
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('builds a plan that captures missing translations', async () => {
    const service = new TranslationService(baseConfig());
    const plan = await service.buildPlan();

    expect(plan.sourceLocale).toBe('en');
    expect(plan.targetLocales).toEqual(['es', 'fr']);
    expect(plan.totalTasks).toBeGreaterThan(0);

  const esPlan = plan.locales.find((localePlan) => localePlan.locale === 'es');
  expect(esPlan).toBeDefined();
  expect(esPlan && sortKeys(esPlan.tasks)).toEqual(['common.greeting', 'cta.cancel', 'cta.save']);

  const frPlan = plan.locales.find((localePlan) => localePlan.locale === 'fr');
  expect(frPlan && sortKeys(frPlan.tasks)).toEqual(['common.greeting', 'cta.cancel', 'cta.save']);
  });

  it('skips locales that already have translations unless forced', async () => {
    const config = baseConfig();
    await fs.writeFile(
      path.join(tempDir, 'fr.json'),
      JSON.stringify(
        {
          'common.greeting': 'Bonjour',
          'cta.save': 'Enregistrer',
          'cta.cancel': 'Annuler',
        },
        null,
        2
      )
    );

    const service = new TranslationService(config);
    const dryPlan = await service.buildPlan({ locales: ['fr'] });
    expect(dryPlan.locales.length).toBe(0);

    const forcedPlan = await service.buildPlan({ locales: ['fr'], force: true });
    expect(forcedPlan.locales.length).toBe(1);
    expect(forcedPlan.locales[0].tasks).toHaveLength(3);
    expect(forcedPlan.locales[0].existingCount).toBeGreaterThan(0);
  });

  it('writes translated values and flushes to disk', async () => {
    const service = new TranslationService(baseConfig());
    const plan = await service.buildPlan({ locales: ['es'] });
    const esPlan = plan.locales[0];

    const updates = esPlan.tasks.map((task) => ({
      key: task.key,
      value: `[es] ${task.sourceValue}`,
    }));

    const summary = await service.writeTranslations('es', updates);
    expect(summary.attempted).toBe(updates.length);
    expect(summary.written).toBe(updates.length);

    await service.flush();

    const esFile = JSON.parse(await fs.readFile(path.join(tempDir, 'es.json'), 'utf8')) as Record<string, string>;
    expect(esFile['common.greeting']).toBe('[es] Hello world');
    expect(esFile['cta.save']).toBe('[es] Save');
  });
});

function sortKeys(tasks: Array<{ key: string }>): string[] {
  return tasks.map((task) => task.key).sort((a, b) => a.localeCompare(b));
}
