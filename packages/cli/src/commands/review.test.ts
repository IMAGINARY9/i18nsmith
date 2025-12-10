import { describe, it, expect } from 'vitest';
import { literalToRegexPattern } from './review.js';

describe('literalToRegexPattern', () => {
  it('anchors the value and escapes regex metacharacters', () => {
    expect(literalToRegexPattern('Price (USD)+?')).toBe('^Price \\(USD\\)\\+\\?$');
  });

  it('preserves whitespace and newline characters', () => {
    expect(literalToRegexPattern('Multi\nLine')).toBe('^Multi\nLine$');
  });
});
