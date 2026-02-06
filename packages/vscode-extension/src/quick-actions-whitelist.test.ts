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

    const model = buildQuickActionModel({ report, hasSelection: false });
    const problems = model.sections.find((s) => s.title.includes('Problems'));
    expect(problems).toBeDefined();
    const whitelistAction = problems!.actions.find((a) => a.id === 'whitelist-dynamic');
    expect(whitelistAction).toBeDefined();
    expect(whitelistAction!.command).toBe('i18nsmith.whitelistDynamicKeys');
    expect(whitelistAction!.interactive).toBe(true);
  });
});
