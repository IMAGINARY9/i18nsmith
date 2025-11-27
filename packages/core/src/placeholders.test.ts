import { describe, expect, it } from 'vitest';
import { PlaceholderValidator, extractPlaceholders, buildPlaceholderPatterns } from './placeholders.js';

describe('PlaceholderValidator', () => {
  describe('extract', () => {
    it('extracts doubleCurly placeholders by default', () => {
      const validator = new PlaceholderValidator();
      const result = validator.extract('Hello {{name}}, you have {{count}} messages');
      expect(result).toEqual(new Set(['name', 'count']));
    });

    it('handles empty or invalid values', () => {
      const validator = new PlaceholderValidator();
      expect(validator.extract('')).toEqual(new Set());
      expect(validator.extract(undefined as unknown as string)).toEqual(new Set());
    });

    it('extracts percentCurly format', () => {
      const validator = new PlaceholderValidator(['percentCurly']);
      const result = validator.extract('Hello %{name}, you have %{count} messages');
      expect(result).toEqual(new Set(['name', 'count']));
    });

    it('extracts percentSymbol (positional) format', () => {
      const validator = new PlaceholderValidator(['percentSymbol']);
      const result = validator.extract('Hello %s, you have %s messages');
      expect(result).toEqual(new Set(['__positional__1', '__positional__2']));
    });

    it('extracts multiple formats', () => {
      const validator = new PlaceholderValidator(['doubleCurly', 'percentCurly']);
      const result = validator.extract('Hello {{name}}, you have %{count} items');
      expect(result).toEqual(new Set(['name', 'count']));
    });
  });

  describe('compare', () => {
    it('detects matching placeholders', () => {
      const validator = new PlaceholderValidator();
      const result = validator.compare(
        'Hello {{name}}, you have {{count}} messages',
        'Bonjour {{name}}, vous avez {{count}} messages'
      );
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.extra).toEqual([]);
    });

    it('detects missing placeholders', () => {
      const validator = new PlaceholderValidator();
      const result = validator.compare(
        'Hello {{name}}, you have {{count}} messages',
        'Bonjour {{name}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('count');
      expect(result.extra).toEqual([]);
    });

    it('detects extra placeholders', () => {
      const validator = new PlaceholderValidator();
      const result = validator.compare(
        'Hello {{name}}',
        'Bonjour {{name}}, vous avez {{count}} messages'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual([]);
      expect(result.extra).toContain('count');
    });

    it('detects both missing and extra placeholders', () => {
      const validator = new PlaceholderValidator();
      const result = validator.compare(
        'Hello {{name}}, {{greeting}}',
        'Bonjour {{name}}, {{farewell}}'
      );
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('greeting');
      expect(result.extra).toContain('farewell');
    });
  });

  describe('validate', () => {
    it('returns true when placeholders match', () => {
      const validator = new PlaceholderValidator();
      expect(
        validator.validate(
          'Hello {{name}}',
          'Bonjour {{name}}'
        )
      ).toBe(true);
    });

    it('returns false when placeholders do not match', () => {
      const validator = new PlaceholderValidator();
      expect(
        validator.validate(
          'Hello {{name}}, {{count}}',
          'Bonjour {{name}}'
        )
      ).toBe(false);
    });
  });
});

describe('extractPlaceholders', () => {
  it('extracts named placeholders', () => {
    const patterns = buildPlaceholderPatterns(['doubleCurly']);
    const result = extractPlaceholders('Hello {{ name }}, welcome!', patterns);
    expect(result).toContain('name');
  });

  it('handles whitespace in placeholders', () => {
    const patterns = buildPlaceholderPatterns(['doubleCurly']);
    const result = extractPlaceholders('{{ spacedName }}', patterns);
    expect(result).toContain('spacedName');
  });

  it('deduplicates placeholders', () => {
    const patterns = buildPlaceholderPatterns(['doubleCurly']);
    const result = extractPlaceholders('{{name}} says hello to {{name}}', patterns);
    expect(result).toEqual(['name']);
  });
});
