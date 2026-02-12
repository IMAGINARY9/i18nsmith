import { describe, expect, it } from 'vitest';
import { KeyValidator, SuspiciousKeyReason, SUSPICIOUS_KEY_REASON_DESCRIPTIONS, normalizeToKey, detectNamingConvention, followsConvention } from './key-validator.js';

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
      const result = validator.analyzeWithValue('submit', 'Submit');
      expect(result.suspicious).toBe(true);
      expect(result.reason).toBe('key-equals-value');
      expect(result.keyEqualsValue).toBe(true);
    });

    it('detects normalized key-equals-value', () => {
      const validator = new KeyValidator();
      const result = validator.analyzeWithValue('submit-button', 'Submit Button');
      expect(result.keyEqualsValue).toBe(true);
    });

    it('does not flag namespaced key-value matches by default', () => {
      const validator = new KeyValidator();
      const result = validator.analyzeWithValue('common.submit', 'Submit');
      expect(result.keyEqualsValue).toBe(false);
      expect(result.suspicious).toBe(false);
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

describe('normalizeToKey', () => {
  it('normalizes space-separated text to kebab-case with namespace', () => {
    expect(normalizeToKey('When to Use')).toBe('common.when-to-use');
    expect(normalizeToKey('Hello World')).toBe('common.hello-world');
  });

  it('normalizes PascalCase to kebab-case', () => {
    expect(normalizeToKey('WhenToUseCategorizedView')).toBe('common.when-to-use-categorized');
    expect(normalizeToKey('HelloWorld')).toBe('common.hello-world');
  });

  it('normalizes camelCase to kebab-case', () => {
    expect(normalizeToKey('submitButton')).toBe('common.submit-button');
    expect(normalizeToKey('userProfileSettings')).toBe('common.user-profile-settings');
  });

  it('removes punctuation', () => {
    expect(normalizeToKey('Are you sure?')).toBe('common.are-you-sure');
    expect(normalizeToKey('Warning!')).toBe('common.warning');
    expect(normalizeToKey('Hello, World')).toBe('common.hello-world');
  });

  it('limits words to maxWords option', () => {
    expect(normalizeToKey('One Two Three Four Five Six', { maxWords: 3 })).toBe('common.one-two-three');
    expect(normalizeToKey('One Two Three Four Five Six', { maxWords: 5 })).toBe('common.one-two-three-four-five');
  });

  it('uses custom namespace', () => {
    expect(normalizeToKey('Submit Button', { defaultNamespace: 'buttons' })).toBe('buttons.submit-button');
    expect(normalizeToKey('Error Message', { defaultNamespace: 'errors' })).toBe('errors.error-message');
  });

  it('preserves valid namespace from input', () => {
    expect(normalizeToKey('nav.TheQuickBrownFox')).toBe('nav.the-quick-brown-fox');
    expect(normalizeToKey('auth.IsLoggedIn')).toBe('auth.is-logged-in');
  });

  it('supports camelCase naming convention', () => {
    expect(normalizeToKey('Submit Button', { namingConvention: 'camelCase' })).toBe('common.submitButton');
    expect(normalizeToKey('Are You Sure', { namingConvention: 'camelCase' })).toBe('common.areYouSure');
  });

  it('supports snake_case naming convention', () => {
    expect(normalizeToKey('Submit Button', { namingConvention: 'snake_case' })).toBe('common.submit_button');
    expect(normalizeToKey('Are You Sure', { namingConvention: 'snake_case' })).toBe('common.are_you_sure');
  });

  it('handles edge cases', () => {
    expect(normalizeToKey('')).toBe('common.unknown');
    expect(normalizeToKey('   ')).toBe('common.unknown');
    expect(normalizeToKey('!!!')).toBe('common.unknown');
  });
});

describe('detectNamingConvention', () => {
  it('detects kebab-case as dominant convention', () => {
    const keys = [
      'common.submit-button',
      'auth.login-form',
      'nav.main-menu',
      'user.profile-settings'
    ];
    expect(detectNamingConvention(keys)).toBe('kebab-case');
  });

  it('detects camelCase as dominant convention', () => {
    const keys = [
      'common.submitButton',
      'auth.loginForm',
      'nav.mainMenu',
      'user.profileSettings'
    ];
    expect(detectNamingConvention(keys)).toBe('camelCase');
  });

  it('detects snake_case as dominant convention', () => {
    const keys = [
      'common.submit_button',
      'auth.login_form',
      'nav.main_menu',
      'user.profile_settings'
    ];
    expect(detectNamingConvention(keys)).toBe('snake_case');
  });

  it('returns kebab-case for empty input', () => {
    expect(detectNamingConvention([])).toBe('kebab-case');
  });

  it('handles mixed conventions by picking the most common', () => {
    const keys = [
      'common.submit-button', // kebab
      'auth.loginForm',       // camel
      'nav.main_menu',        // snake
      'user.profile-button',  // kebab
    ];
    expect(detectNamingConvention(keys)).toBe('kebab-case');
  });
});

describe('followsConvention', () => {
  it('validates kebab-case keys', () => {
    expect(followsConvention('submit-button', 'kebab-case')).toBe(true);
    expect(followsConvention('submitButton', 'kebab-case')).toBe(false);
    expect(followsConvention('submit_button', 'kebab-case')).toBe(false);
  });

  it('validates camelCase keys', () => {
    expect(followsConvention('submitButton', 'camelCase')).toBe(true);
    expect(followsConvention('SubmitButton', 'camelCase')).toBe(false); // PascalCase
    expect(followsConvention('submit-button', 'camelCase')).toBe(false);
  });

  it('validates snake_case keys', () => {
    expect(followsConvention('submit_button', 'snake_case')).toBe(true);
    expect(followsConvention('submitButton', 'snake_case')).toBe(false);
    expect(followsConvention('submit-button', 'snake_case')).toBe(false);
  });
});

describe('preserveExistingConvention', () => {
  it('preserves keys that already follow a valid convention', () => {
    expect(normalizeToKey('nav.goToSignIn', {
      preserveExistingConvention: true,
      namingConvention: 'kebab-case'
    })).toBe('nav.goToSignIn'); // Already camelCase, should preserve

    expect(normalizeToKey('auth.login_form', {
      preserveExistingConvention: true,
      namingConvention: 'kebab-case'
    })).toBe('auth.login_form'); // Already snake_case, should preserve
  });

  it('normalizes keys that do not follow any convention', () => {
    expect(normalizeToKey('nav.Go To Sign In', {
      preserveExistingConvention: true,
      namingConvention: 'kebab-case'
    })).toBe('nav.go-to-sign-in'); // Contains spaces, should normalize
  });

  it('defaults to false (normalizes all keys)', () => {
    expect(normalizeToKey('nav.goToSignIn', {
      namingConvention: 'kebab-case'
    })).toBe('nav.go-to-sign-in'); // Should normalize even though it's valid camelCase
  });
});

describe('auto naming convention', () => {
  it('resolves auto to detected convention', () => {
    // This would require mocking or setting up test data, but the logic is tested
    // in the integration with generateRenameProposals
    expect(normalizeToKey('test key', {
      namingConvention: 'auto'
    })).toBe('common.test-key'); // Falls back to kebab-case
  });
});
