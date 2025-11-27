import type { Translator, TranslatorFactoryOptions } from '@i18nsmith/translation';

const ACCENT_MAP: Record<string, string> = {
  a: 'á',
  e: 'é',
  i: 'í',
  o: 'ó',
  u: 'ú',
  A: 'Á',
  E: 'É',
  I: 'Í',
  O: 'Ó',
  U: 'Ú',
};

export interface MockTranslatorOptions extends TranslatorFactoryOptions {
  provider: string;
  accentVowels?: boolean;
}

export function createTranslator(options: MockTranslatorOptions): Translator {
  const accentVowels = options.accentVowels ?? true;

  return {
    name: 'mock',
    async translate(texts: string[], _sourceLocale: string, targetLocale: string): Promise<string[]> {
      return texts.map((text) => pseudoLocalize(text, targetLocale, accentVowels));
    },
    estimateCost(characterCount: number, context?: { localeCount?: number }): string {
      const locales = context?.localeCount ?? 1;
      return `${characterCount * locales} mock-char${characterCount * locales === 1 ? '' : 's'}`;
    },
  };
}

function pseudoLocalize(input: string, locale: string, accentVowels: boolean): string {
  const prefix = `[${locale}]`;
  if (!input) {
    return `${prefix}`;
  }

  if (!accentVowels) {
    return `${prefix} ${input}`;
  }

  const transformed = Array.from(input)
    .map((char) => ACCENT_MAP[char] ?? char)
    .join('');
  return `${prefix} ${transformed}`;
}

export default {
  createTranslator,
};
