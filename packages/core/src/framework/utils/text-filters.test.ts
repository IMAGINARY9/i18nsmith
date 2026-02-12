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

    it('should skip CSS class lists', () => {
      const result = shouldExtractText('flex items-center gap-2 text-sm', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip Tailwind arbitrary values', () => {
      const result = shouldExtractText('bg-[var(--color-primary)] text-white', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip SVG path data', () => {
      const result = shouldExtractText('M19 7l-.867 12.142A2 2 0 01 16.138 21H7.862', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip icon identifiers', () => {
      const result = shouldExtractText('mdi:email-send', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip CSS custom properties', () => {
      const result = shouldExtractText('--color-muted', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip CSS unit values', () => {
      const result = shouldExtractText('12px', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip relative URL paths', () => {
      const result = shouldExtractText('/dashboard/billing', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip screaming snake case constants', () => {
      const result = shouldExtractText('ORDER_STATUS_UPDATED', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip debug messages starting with emoji', () => {
      const result = shouldExtractText('✅ Logo updated from server:', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip input types in attribute context', () => {
      const config: TextFilterConfig = { ...defaultConfig, context: { attribute: 'type' } };
      const result = shouldExtractText('email', config);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip class attribute values in context', () => {
      const config: TextFilterConfig = { ...defaultConfig, context: { attribute: 'className' } };
      const result = shouldExtractText('flex items-center', config);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip camelCase identifiers', () => {
      const result = shouldExtractText('categoryId', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip dot-notation paths', () => {
      const result = shouldExtractText('management.activityHistory.filters', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip font family strings', () => {
      const result = shouldExtractText('Helvetica, Arial, sans-serif', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip http methods and targets', () => {
      const result = shouldExtractText('POST', defaultConfig);
      expect(result.shouldExtract).toBe(false);
    });

    it('should skip CSS keywords in attribute context', () => {
      const config: TextFilterConfig = { ...defaultConfig, context: { attribute: 'style' } };
      const result = shouldExtractText('flex', config);
      expect(result.shouldExtract).toBe(false);
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

    it('should skip HTML input type keywords (context-free)', () => {
      const result = shouldExtractText('text', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('html-type-keyword');
    });

    it('should skip CSS single-word value keywords', () => {
      const result = shouldExtractText('flex', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('css-value-keyword');
    });

    it('should skip locale codes', () => {
      const result = shouldExtractText('en', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('locale-code');
    });

    it('should skip rel attribute values', () => {
      const result = shouldExtractText('noopener noreferrer', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('rel-attribute');
    });

    it('should skip DOM event handler names', () => {
      const result = shouldExtractText('ontouchstart', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('dom-event');
    });

    it('should skip SVG fill-rule values', () => {
      const result = shouldExtractText('evenodd', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('svg-attribute');
    });

    it('should skip ALL-CAPS constant-like words', () => {
      const result = shouldExtractText('BASIC', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('all-caps-constant');
    });

    it('should skip CSS transition shorthand strings', () => {
      const result = shouldExtractText('background 0.3s', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('css-transition');
    });

    it('should skip single-token Tailwind utility classes', () => {
      const testCases = [
        'flex-1', 'p-6', 'text-white', 'ml-2', 'mb-6', 'shadow-xl', 'text-right',
        'font-medium', 'space-y-4', 'bg-blue-500', 'rounded-lg', 'opacity-100'
      ];

      for (const testCase of testCases) {
        const result = shouldExtractText(testCase, defaultConfig);
        expect(result.shouldExtract).toBe(false);
        expect(result.skipReason).toBe('single-token-tailwind');
      }
    });

    it('should skip short SVG path data', () => {
      const result = shouldExtractText('M12 4v16m8-8H4', defaultConfig);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('non_sentence');
    });

    it('should skip longer SVG paths in attribute context', () => {
      const config: TextFilterConfig = { ...defaultConfig, context: { attribute: 'd' } };
      const result = shouldExtractText('M12 4v16m8-8H4', config);
      expect(result.shouldExtract).toBe(false);
      expect(result.skipReason).toBe('non_sentence');
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