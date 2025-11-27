import { describe, expect, it } from 'vitest';
import { KeyValidator, SuspiciousKeyReason, SUSPICIOUS_KEY_REASON_DESCRIPTIONS } from './key-validator.js';

describe('KeyValidator', () => {
  describe('analyze', () => {
    it('detects keys with spaces as suspicious', () => {
      const validator = new KeyValidator();
      const result = validator.analyze('When to Use Categorized View');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toBe('contains-spaces');
    });

    it('detects single-word keys without namespace as suspicious', () => {
      const validator = new KeyValidator();
      const result = validator.analyze('Found');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toBe('single-word-no-namespace');
    });

    it('detects keys with trailing punctuation as suspicious', () => {
      const validator = new KeyValidator();
      
      expect(validator.analyze('WhenToUse:').reason).toBe('trailing-punctuation');
      expect(validator.analyze('AreYouSure?').reason).toBe('trailing-punctuation');
      expect(validator.analyze('Warning!').reason).toBe('trailing-punctuation');
    });

    it('detects PascalCase sentence patterns as suspicious', () => {
      const validator = new KeyValidator();
      // With namespace to bypass single-word check
      const result = validator.analyze('common.TheQuickBrownFoxJumps');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toBe('pascal-case-sentence');
      
      // Without namespace, single-word check fires first
      const noNamespace = validator.analyze('TheQuickBrownFoxJumps');
      expect(noNamespace.suspicious).toBe(true);
      expect(noNamespace.reason).toBe('single-word-no-namespace');
    });

    it('detects keys with sentence articles as suspicious', () => {
      const validator = new KeyValidator();
      
      // These keys have sentence articles but fewer than 4 PascalCase words
      // so they trigger sentence-article instead of pascal-case-sentence
      expect(validator.analyze('nav.TheTitle').reason).toBe('sentence-article');
      expect(validator.analyze('info.ForMore').reason).toBe('sentence-article');
      expect(validator.analyze('auth.IsLoggedIn').reason).toBe('sentence-article');
    });

    it('allows properly structured keys', () => {
      const validator = new KeyValidator();
      
      expect(validator.analyze('common.title').suspicious).toBe(false);
      expect(validator.analyze('auth.login.button').suspicious).toBe(false);
      expect(validator.analyze('menu.items.count').suspicious).toBe(false);
      expect(validator.analyze('navigation.home').suspicious).toBe(false);
    });

    it('allows camelCase keys with namespace', () => {
      const validator = new KeyValidator();
      
      expect(validator.analyze('common.submitButton').suspicious).toBe(false);
      expect(validator.analyze('form.inputField').suspicious).toBe(false);
    });
  });

  describe('analyzeWithValue', () => {
    it('detects key-equals-value pattern', () => {
      const validator = new KeyValidator();
      // Use a namespaced key so single-word check doesn't fire first
      const result = validator.analyzeWithValue('common.submit', 'Submit');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toBe('key-equals-value');
      expect(result.keyEqualsValue).toBe(true);
    });

    it('detects normalized key-equals-value', () => {
      const validator = new KeyValidator();
      const result = validator.analyzeWithValue('common.submit-button', 'Submit Button');
      expect(result.keyEqualsValue).toBe(true);
    });

    it('does not flag different key and value', () => {
      const validator = new KeyValidator();
      const result = validator.analyzeWithValue('common.greeting', 'Hello, World!');
      expect(result.suspicious).toBe(false);
      expect(result.keyEqualsValue).toBe(false);
    });
  });

  describe('validate', () => {
    it('returns valid=true for proper keys', () => {
      const validator = new KeyValidator('skip');
      const result = validator.validate('common.title');
      expect(result.valid).toBe(true);
      expect(result.suspicious).toBe(false);
    });

    it('returns valid=false for suspicious keys with skip policy', () => {
      const validator = new KeyValidator('skip');
      const result = validator.validate('Found');
      expect(result.valid).toBe(false);
      expect(result.suspicious).toBe(true);
    });

    it('returns valid=true for suspicious keys with allow policy', () => {
      const validator = new KeyValidator('allow');
      const result = validator.validate('Found');
      expect(result.valid).toBe(true);
      expect(result.suspicious).toBe(true);
    });
  });

  describe('shouldSkip', () => {
    it('returns true for suspicious keys with skip policy', () => {
      const validator = new KeyValidator('skip');
      expect(validator.shouldSkip('Found')).toBe(true);
      expect(validator.shouldSkip('common.title')).toBe(false);
    });

    it('returns false for all keys with allow policy', () => {
      const validator = new KeyValidator('allow');
      expect(validator.shouldSkip('Found')).toBe(false);
      expect(validator.shouldSkip('common.title')).toBe(false);
    });
  });

  describe('shouldError', () => {
    it('returns true for suspicious keys with error policy', () => {
      const validator = new KeyValidator('error');
      expect(validator.shouldError('Found')).toBe(true);
      expect(validator.shouldError('common.title')).toBe(false);
    });

    it('returns false with skip or allow policy', () => {
      expect(new KeyValidator('skip').shouldError('Found')).toBe(false);
      expect(new KeyValidator('allow').shouldError('Found')).toBe(false);
    });
  });

  describe('suggestFix', () => {
    it('suggests namespace for single-word keys', () => {
      const validator = new KeyValidator();
      expect(validator.suggestFix('Found', 'single-word-no-namespace')).toBe('common.found');
    });

    it('removes trailing punctuation', () => {
      const validator = new KeyValidator();
      expect(validator.suggestFix('WhenToUse:', 'trailing-punctuation')).toBe('WhenToUse');
    });

    it('converts sentences to slugs', () => {
      const validator = new KeyValidator();
      const suggestion = validator.suggestFix('When to Use', 'contains-spaces');
      expect(suggestion).toBe('common.when-to-use');
    });
  });

  describe('isValidKeyFormat', () => {
    it('accepts valid key formats', () => {
      const validator = new KeyValidator();
      expect(validator.isValidKeyFormat('common.title')).toBe(true);
      expect(validator.isValidKeyFormat('auth_login')).toBe(true);
      expect(validator.isValidKeyFormat('menu-item')).toBe(true);
    });

    it('rejects invalid key formats', () => {
      const validator = new KeyValidator();
      expect(validator.isValidKeyFormat('')).toBe(false);
      expect(validator.isValidKeyFormat('key with spaces')).toBe(false);
      expect(validator.isValidKeyFormat('key:value')).toBe(false);
      expect(validator.isValidKeyFormat('key?')).toBe(false);
    });
  });

  describe('SUSPICIOUS_KEY_REASON_DESCRIPTIONS', () => {
    it('has descriptions for all reason types', () => {
      const reasons: SuspiciousKeyReason[] = [
        'contains-spaces',
        'single-word-no-namespace',
        'trailing-punctuation',
        'pascal-case-sentence',
        'sentence-article',
        'key-equals-value',
      ];

      for (const reason of reasons) {
        expect(SUSPICIOUS_KEY_REASON_DESCRIPTIONS[reason]).toBeDefined();
        expect(typeof SUSPICIOUS_KEY_REASON_DESCRIPTIONS[reason]).toBe('string');
      }
    });
  });
});
