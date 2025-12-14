import { describe, it, expect } from 'vitest';
import { normalizeConfig } from './normalizer.js';
import { assertConfigValid, validateConfig } from './validator.js';
import type { I18nConfig } from './types.js';

function buildConfig(overrides: Partial<I18nConfig> = {}): I18nConfig {
  return normalizeConfig(overrides);
}

describe('config validator', () => {
  it('accepts a normalized default config', () => {
    const config = buildConfig();
    expect(() => assertConfigValid(config)).not.toThrow();
  });

  it('rejects localesDir with shell metacharacters', () => {
    const config = buildConfig({ localesDir: 'locales;rm -rf' });
    expect(() => assertConfigValid(config)).toThrow(/localesDir/);
  });

  it('rejects translation identifiers that are not identifiers', () => {
    const config = buildConfig({ sync: { translationIdentifier: 'foo-bar' } as I18nConfig['sync'] });
    const issues = validateConfig(config);
    expect(issues.some((issue) => issue.field === 'sync.translationIdentifier')).toBe(true);
  });

  it('rejects invalid language tags', () => {
    const config = buildConfig({ sourceLanguage: 'en us' });
    const issues = validateConfig(config);
    expect(issues.some((issue) => issue.field === 'sourceLanguage')).toBe(true);
  });
});
