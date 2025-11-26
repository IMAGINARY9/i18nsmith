import { describe, expect, it } from 'vitest';
import { generateValueFromKey } from './value-generator.js';

describe('generateValueFromKey', () => {
  it('converts dotted keys to human readable text', () => {
    expect(generateValueFromKey('account.name')).toBe('Account Name');
    expect(generateValueFromKey('auth.login.title')).toBe('Auth Login Title');
  });

  it('handles kebab, snake, and camel case segments', () => {
    expect(generateValueFromKey('common.account_name.title')).toBe('Common Account Name Title');
    expect(generateValueFromKey('ctaPrimaryAction')).toBe('Cta Primary Action');
    expect(generateValueFromKey('CTASecondary')).toBe('CTA Secondary');
  });

  it('deduplicates repeated namespace segments', () => {
    expect(generateValueFromKey('account.accountInformation')).toBe('Account Information');
    expect(generateValueFromKey('activity.activityVerified')).toBe('Activity Verified');
  });

  it('returns empty string for invalid keys', () => {
    expect(generateValueFromKey('')).toBe('');
    expect(generateValueFromKey('   ')).toBe('');
  });
});
