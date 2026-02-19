import { describe, it, expect } from 'vitest';
import { CacheValidator, type CacheValidationContext } from './cache-validator.js';

describe('CacheValidator', () => {
  const baseContext: CacheValidationContext = {
    currentVersion: 5,
    expectedTranslationIdentifier: 't',
    currentConfigHash: 'config-hash-abc',
    currentToolVersion: '1.0.0',
    currentParserSignature: 'parser-sig-xyz',
    currentParserAvailability: {
      vue: true,
      typescript: true,
    },
  };

  describe('validate', () => {
    it('returns valid for matching cache data', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 't',
        configHash: 'config-hash-abc',
        toolVersion: '1.0.0',
        parserSignature: 'parser-sig-xyz',
        parserAvailability: {
          vue: true,
          typescript: true,
        },
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('invalidates on version mismatch', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 4,
        translationIdentifier: 't',
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].type).toBe('version');
      expect(result.reasons[0].oldValue).toBe('4');
      expect(result.reasons[0].newValue).toBe('5');
    });

    it('invalidates on translation identifier mismatch', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 'i18n',
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].type).toBe('translationIdentifier');
      expect(result.reasons[0].oldValue).toBe('i18n');
      expect(result.reasons[0].newValue).toBe('t');
    });

    it('invalidates on config hash mismatch', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 't',
        configHash: 'config-hash-old',
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].type).toBe('config');
    });

    it('invalidates on tool version mismatch', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 't',
        toolVersion: '0.9.0',
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].type).toBe('toolVersion');
      expect(result.reasons[0].oldValue).toBe('0.9.0');
      expect(result.reasons[0].newValue).toBe('1.0.0');
    });

    it('invalidates on parser signature mismatch', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 't',
        parserSignature: 'parser-sig-old',
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].type).toBe('parserSignature');
      expect(result.reasons[0].message).toContain('Parser implementation changed');
    });

    it('invalidates when parser availability changed (new parser)', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 't',
        parserAvailability: {
          vue: false, // Was not available
          typescript: true,
        },
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].type).toBe('parserAvailability');
    });

    it('invalidates when parser availability changed (parser removed)', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 't',
        parserAvailability: {
          vue: true,
          typescript: true,
          python: true, // This parser no longer exists
        },
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0].type).toBe('parserAvailability');
    });

    it('allows missing optional fields in cache', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 5,
        translationIdentifier: 't',
        // Missing: configHash, toolVersion, parserSignature, parserAvailability
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('collects multiple invalidation reasons', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        version: 4, // Wrong version
        translationIdentifier: 'i18n', // Wrong identifier
        configHash: 'config-hash-old', // Wrong config
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons).toHaveLength(3);
      expect(result.reasons[0].type).toBe('version');
      expect(result.reasons[1].type).toBe('translationIdentifier');
      expect(result.reasons[2].type).toBe('config');
    });

    it('handles invalid cache data structure', () => {
      const validator = new CacheValidator(baseContext);
      
      const result1 = validator.validate(null);
      expect(result1.valid).toBe(false);
      expect(result1.reasons[0].message).toContain('Invalid cache data structure');

      const result2 = validator.validate(undefined);
      expect(result2.valid).toBe(false);

      const result3 = validator.validate('not an object');
      expect(result3.valid).toBe(false);

      const result4 = validator.validate(123);
      expect(result4.valid).toBe(false);
    });

    it('handles missing version field', () => {
      const validator = new CacheValidator(baseContext);
      const cacheData = {
        // Missing version
        translationIdentifier: 't',
        files: {},
      };

      const result = validator.validate(cacheData);
      expect(result.valid).toBe(false);
      expect(result.reasons[0].type).toBe('version');
      expect(result.reasons[0].oldValue).toBe('undefined');
    });
  });

  describe('formatReasons', () => {
    it('formats empty reasons', () => {
      const formatted = CacheValidator.formatReasons([]);
      expect(formatted).toBe('Valid cache');
    });

    it('formats single reason without values', () => {
      const formatted = CacheValidator.formatReasons([
        {
          type: 'parserAvailability',
          message: 'Parser availability changed',
        },
      ]);
      expect(formatted).toBe('Parser availability changed');
    });

    it('formats single reason with values', () => {
      const formatted = CacheValidator.formatReasons([
        {
          type: 'version',
          message: 'Cache version mismatch',
          oldValue: '4',
          newValue: '5',
        },
      ]);
      expect(formatted).toBe('Cache version mismatch: 4 → 5');
    });

    it('formats multiple reasons', () => {
      const formatted = CacheValidator.formatReasons([
        {
          type: 'version',
          message: 'Cache version mismatch',
          oldValue: '4',
          newValue: '5',
        },
        {
          type: 'config',
          message: 'Configuration changed',
          oldValue: 'abc',
          newValue: 'xyz',
        },
      ]);
      expect(formatted).toBe('Cache version mismatch: 4 → 5; Configuration changed: abc → xyz');
    });
  });
});
