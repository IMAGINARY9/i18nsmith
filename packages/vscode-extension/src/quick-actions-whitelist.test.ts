import { describe, it, expect } from 'vitest';
import { buildQuickActionModel } from './quick-actions-data';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Quick Actions — Dynamic Whitelist', () => {
  it('wires dynamic key quick action to whitelistDynamicKeys command', () => {
    const report: any = {
      sync: {
        dynamicKeyWarnings: [
          { filePath: 'src/app.vue', expression: "$t('errors.{{code}}')", reason: 'template' },
        ],
      },
      suggestedCommands: [],
    };

    const model = buildQuickActionModel({ report, hasSelection: false, filteredDynamicWarningCount: 1 });
    const problems = model.sections.find((s) => s.title.includes('Problems'));
    expect(problems).toBeDefined();
    const whitelistAction = problems!.actions.find((a) => a.id === 'whitelist-dynamic');
    expect(whitelistAction).toBeDefined();
    expect(whitelistAction!.command).toBe('i18nsmith.whitelistDynamicKeys');
    expect(whitelistAction!.interactive).toBe(true);
  });

  it('offers coverage action when dynamic key translations are missing', () => {
    const report: any = {
      sync: {
        dynamicKeyCoverage: [
          {
            pattern: 'workingHours.*',
            expandedKeys: ['workingHours.monday', 'workingHours.tuesday'],
            missingByLocale: {
              en: ['workingHours.tuesday'],
              es: ['workingHours.monday', 'workingHours.tuesday'],
            },
          },
        ],
      },
      suggestedCommands: [],
    };

    const model = buildQuickActionModel({ report, hasSelection: false, filteredDynamicWarningCount: 0 });
    const problems = model.sections.find((s) => s.title.includes('Problems'));
    expect(problems).toBeDefined();
    const coverageAction = problems!.actions.find((a) => a.id === 'dynamic-coverage');
    expect(coverageAction).toBeDefined();
    expect(coverageAction!.command).toBe('i18nsmith.sync');
  });

  it('suggests seeded sync when workspace config enables seedTargetLocales', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qactions-'));
    try {
      fs.writeFileSync(path.join(tmp, 'i18n.config.json'), JSON.stringify({ seedTargetLocales: true }));

      const report: any = {
        sync: {
          missingKeys: [ { key: 'common.greeting', references: [ { filePath: 'src/App.tsx' } ] } ],
        },
        suggestedCommands: [],
      };

  const model = buildQuickActionModel({ report, hasSelection: false, workspaceRoot: tmp });
  // debug: output model for investigation (removed after fix)
  const problems = model.sections.find((s) => s.title.includes('Problems'));
  expect(problems).toBeDefined();
  const drift = problems!.actions.find((a) => a.id === 'fix-locale-drift');
  expect(drift).toBeDefined();
  // CLI suggestions are surfaced as previewIntent for previewable commands
  expect(drift!.previewIntent).toBeDefined();
  expect((drift!.previewIntent as any).extraArgs).toContain('--seed-target-locales');
    } finally {
      try { fs.rmSync(tmp, { recursive: true }); } catch {}
    }
  });
  it('suggests seeded sync when diagnostics show locale key shortfall', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qactions-'));
    try {
      fs.writeFileSync(path.join(tmp, 'i18n.config.json'), JSON.stringify({ seedTargetLocales: true }));

      const report: any = {
        diagnostics: {
          localeFiles: [
            { locale: 'en', keyCount: 10 },
            { locale: 'es', keyCount: 2 },
          ],
          actionableItems: [],
        },
        suggestedCommands: [],
      };

      const model = buildQuickActionModel({ report, hasSelection: false, workspaceRoot: tmp });
      const problems = model.sections.find((s) => s.title.includes('Problems'));
      expect(problems).toBeDefined();
      const drift = problems!.actions.find((a) => a.id === 'fix-locale-drift');
      expect(drift).toBeDefined();
      const hasSeedFlag =
        (typeof drift!.command === 'string' && drift!.command.includes('--seed-target-locales')) ||
        (drift!.previewIntent && (drift!.previewIntent as any).extraArgs?.includes('--seed-target-locales'));
      expect(hasSeedFlag).toBe(true);
    } finally {
      try { fs.rmSync(tmp, { recursive: true }); } catch {}
    }
  });
});
