import { describe, expect, it } from 'vitest';
import { generateValueFromKey } from './value-generator.js';

describe('generateValueFromKey', () => {
  it('uses only the last segment for dotted keys', () => {
    expect(generateValueFromKey('account.name')).toBe('Name');
    expect(generateValueFromKey('auth.login.title')).toBe('Title');
    expect(generateValueFromKey('management.activityHistory.activities')).toBe('Activities');
  });

  it('handles kebab, snake, and camel case segments', () => {
    expect(generateValueFromKey('common.account_name.title')).toBe('Title');
    expect(generateValueFromKey('ctaPrimaryAction')).toBe('Cta Primary Action');
    expect(generateValueFromKey('CTASecondary')).toBe('CTA Secondary');
  });

  it('splits camelCase in last segment', () => {
    expect(generateValueFromKey('account.accountInformation')).toBe('Account Information');
    expect(generateValueFromKey('activity.activityVerified')).toBe('Activity Verified');
    expect(generateValueFromKey('restaurant.featureUnavailable')).toBe('Feature Unavailable');
  });

  it('skips hash-like segments and uses meaningful segments', () => {
    expect(generateValueFromKey('common.newpage.hardcoded-text-here.ccf1c8')).toBe('Hardcoded Text Here');
    expect(generateValueFromKey('common.newpage.this-is-a-new.7b6678')).toBe('This Is A New');
    expect(generateValueFromKey('common.otherpage.description.f8eb29')).toBe('Description');
    expect(generateValueFromKey('namespace.scope.text-slug.abc123')).toBe('Text Slug');
  });

  it('falls back to hash if all segments look like hashes', () => {
    expect(generateValueFromKey('abc123.def456')).toBe('Def456');
    expect(generateValueFromKey('a1b2c3')).toBe('A1b2c3');
  });

  it('returns empty string for invalid keys', () => {
    expect(generateValueFromKey('')).toBe('');
    expect(generateValueFromKey('   ')).toBe('');
  });
});