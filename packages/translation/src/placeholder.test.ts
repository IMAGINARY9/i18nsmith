import { describe, expect, it, vi } from 'vitest';
import { buildTranslatorModuleSpecifier, loadTranslator } from './index';

vi.mock('virtual-translator', () => ({
  createTranslator: () => ({
    name: 'virtual',
    translate: async (texts: string[]) => texts.map((text) => `${text}!`),
  }),
}));

describe('translation package', () => {
  it('builds translator module specifiers from provider names', () => {
    expect(buildTranslatorModuleSpecifier('mock')).toBe('@i18nsmith/translator-mock');
    expect(() => buildTranslatorModuleSpecifier('')).toThrow();
    expect(buildTranslatorModuleSpecifier('./custom/translator.js')).toBe('./custom/translator.js');
  });

  it('loads translators via mocked modules', async () => {
    const translator = await loadTranslator({ provider: 'virtual', module: 'virtual-translator' });
    const result = await translator.translate(['Hello'], 'en', 'es');
    expect(result).toEqual(['Hello!']);
  });
});
