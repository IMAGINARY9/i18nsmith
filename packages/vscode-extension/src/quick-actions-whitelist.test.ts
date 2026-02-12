import { describe, it, expect } from 'vitest';
import { buildQuickActionModel } from './quick-actions-data';

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
});
