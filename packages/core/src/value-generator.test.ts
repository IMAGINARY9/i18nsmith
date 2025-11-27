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

  it('returns empty string for invalid keys', () => {
    expect(generateValueFromKey('')).toBe('');
    expect(generateValueFromKey('   ')).toBe('');
  });
});
