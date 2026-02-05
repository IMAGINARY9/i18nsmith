import { describe, it, expect } from 'vitest';
import {
  shouldExtractText,
  generateKey,
  hashText,
  compilePatterns,
  isHexColor,
  isHtmlEntity,
  isRepeatedSymbol,
  escapeRegExp,
  type TextFilterConfig,
} from './text-filters.js';

describe('Text Filters', () => {
  const defaultConfig: TextFilterConfig = {
    allowPatterns: [],
    denyPatterns: [],
    skipHexColors: true,
  };

  describe('shouldExtractText', () => {
    it('should extract valid text', () => {
      const result = shouldExtractText('Hello World', defaultConfig);
      expect(result.shouldExtract).toBe(true);
      expect(result.skipReason).toBeUndefined();
    });

    it('should skip empty text', () => {
      const result = shouldExtractText('', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('empty');
    });

    it('should skip null/undefined text', () => {
      const result = shouldExtractText(null as any, defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('empty');
    });

    it('should skip single characters', () => {
      const result = shouldExtractText('A', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('single-character');
    });

    it('should skip HTML entities', () => {
      const result = shouldExtractText('&nbsp;', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('html-entity');
    });

    it('should skip repeated symbols', () => {
      const result = shouldExtractText('!!!', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('repeated-symbols');
    });

    it('should skip hex colors when enabled', () => {
      const result = shouldExtractText('#FF0000', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('hex-color');
    });

    it('should allow hex colors when disabled', () => {
      const config = { ...defaultConfig, skipHexColors: false };
      const result = shouldExtractText('#FF0000', config);
      expect(result.shouldExtract).toBe(true);
    });

    it('should skip text without letters', () => {
      const result = shouldExtractText('12345', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('no-letters');
    });

    it('should skip text matching deny patterns', () => {
      const config = {
        ...defaultConfig,
        denyPatterns: [/test/i],
      };
      const result = shouldExtractText('This is a test', config);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('deny-pattern');
    });

    it('should skip text not matching allow patterns', () => {
      const config = {
        ...defaultConfig,
        allowPatterns: [/allowed/i],
      };
      const result = shouldExtractText('This is forbidden', config);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('allow-pattern-mismatch');
    });

    it('should allow text matching allow patterns', () => {
      const config = {
        ...defaultConfig,
        allowPatterns: [/allowed/i],
      };
      const result = shouldExtractText('This is allowed', config);
      expect(result.shouldExtract).toBe(true);
    });
  });

  describe('generateKey', () => {
    it('should generate snake_case keys by default', () => {
      expect(generateKey('Hello World')).toBe('hello_world');
      expect(generateKey('User Name')).toBe('user_name');
    });

    it('should generate camelCase keys', () => {
      expect(generateKey('Hello World', 'camel')).toBe('helloWorld');
      expect(generateKey('User Name', 'camel')).toBe('userName');
    });

    it('should generate kebab-case keys', () => {
      expect(generateKey('Hello World', 'kebab')).toBe('hello-world');
      expect(generateKey('User Name', 'kebab')).toBe('user-name');
    });

    it('should limit key length', () => {
      const longText = 'A'.repeat(100);
      const key = generateKey(longText, 'snake', 10);
      expect(key.length).toBeLessThanOrEqual(10);
    });

    it('should handle empty text', () => {
      expect(generateKey('')).toBe('');
      expect(generateKey(null as any)).toBe('');
    });

    it('should remove leading/trailing separators', () => {
      expect(generateKey(' Hello World ')).toBe('hello_world');
      expect(generateKey('-Hello-World-', 'kebab')).toBe('hello-world');
    });
  });

  describe('hashText', () => {
    it('should generate consistent hashes', () => {
      const hash1 = hashText('Hello World');
      const hash2 = hashText('Hello World');
      expect(hash1).toBe(hash2);
    });

    it('should generate different hashes for different text', () => {
      const hash1 = hashText('Hello World');
      const hash2 = hashText('Goodbye World');
      expect(hash1).not.toBe(hash2);
    });

    it('should return base36 strings', () => {
      const hash = hashText('test');
      expect(typeof hash).toBe('string');
      expect(/^[a-z0-9]+$/.test(hash)).toBe(true);
    });
  });

  describe('compilePatterns', () => {
    it('should handle empty patterns', () => {
      expect(compilePatterns()).toEqual([]);
      expect(compilePatterns([])).toEqual([]);
    });

    it('should compile string patterns to case-insensitive regex', () => {
      const patterns = compilePatterns(['test', 'hello']);
      expect(patterns).toHaveLength(2);
      expect(patterns[0]).toBeInstanceOf(RegExp);
      expect(patterns[0].test('TEST')).toBe(true);
      expect(patterns[0].test('test')).toBe(true);
    });

    it('should preserve RegExp objects', () => {
      const regex = /test/i;
      const patterns = compilePatterns([regex]);
      expect(patterns).toEqual([regex]);
    });
  });

  describe('isHexColor', () => {
    it('should identify hex colors', () => {
      expect(isHexColor('#FF0000')).toBe(true);
      expect(isHexColor('#f00')).toBe(true);
      expect(isHexColor('#12345678')).toBe(true);
      expect(isHexColor('#gggggg')).toBe(false);
      expect(isHexColor('not-a-color')).toBe(false);
    });
  });

  describe('isHtmlEntity', () => {
    it('should identify HTML entities', () => {
      expect(isHtmlEntity('&nbsp;')).toBe(true);
      expect(isHtmlEntity('&amp;')).toBe(true);
      expect(isHtmlEntity('&copy;')).toBe(true);
      expect(isHtmlEntity('not-an-entity')).toBe(false);
      expect(isHtmlEntity('&')).toBe(false);
    });
  });

  describe('isRepeatedSymbol', () => {
    it('should identify repeated symbols', () => {
      expect(isRepeatedSymbol('!!!')).toBe(true);
      expect(isRepeatedSymbol('...')).toBe(true);
      expect(isRepeatedSymbol('---')).toBe(true);
      expect(isRepeatedSymbol('hello')).toBe(false);
      expect(isRepeatedSymbol('!@#')).toBe(false);
    });
  });

  describe('escapeRegExp', () => {
    it('should escape special regex characters', () => {
      expect(escapeRegExp('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
      expect(escapeRegExp('hello.world')).toBe('hello\\.world');
    });
  });
});