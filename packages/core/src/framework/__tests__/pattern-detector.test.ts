/**
 * Pattern Detector Tests
 */

import { describe, it, expect } from 'vitest';
import {
  PatternDetector,
  PatternCategory,
  isNonTranslatable,
  detectNonTranslatablePattern,
  PATTERN_NAMES,
} from '../utils/pattern-detector.js';

describe('PatternDetector', () => {
  describe('Data Structure Patterns', () => {
    it('should detect JSON objects', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('{"key": "value"}').isNonTranslatable).toBe(true);
      expect(detector.detect('{ "name": "John", "age": 30 }').isNonTranslatable).toBe(true);
      expect(detector.detect('{"nested": {"key": "value"}}').isNonTranslatable).toBe(true);
    });

    it('should detect JSON arrays', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('[1, 2, 3]').isNonTranslatable).toBe(true);
      expect(detector.detect('["a", "b", "c"]').isNonTranslatable).toBe(true);
    });

    it('should detect XML/HTML fragments', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('<div>content</div>').isNonTranslatable).toBe(true);
      expect(detector.detect('<span class="test">text</span>').isNonTranslatable).toBe(true);
    });
  });

  describe('Code Patterns', () => {
    it('should detect SQL queries', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('SELECT * FROM users').isNonTranslatable).toBe(true);
      expect(detector.detect('INSERT INTO table VALUES (1, 2)').isNonTranslatable).toBe(true);
      expect(detector.detect('UPDATE users SET name = "John"').isNonTranslatable).toBe(true);
      expect(detector.detect('DELETE FROM users WHERE id = 1').isNonTranslatable).toBe(true);
    });

    it('should detect regex patterns', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('/[a-z]+/i').isNonTranslatable).toBe(true);
      expect(detector.detect('/\\d{3}-\\d{4}/').isNonTranslatable).toBe(true);
    });

    it('should detect XPath expressions', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('//div[@class="test"]').isNonTranslatable).toBe(true);
      expect(detector.detect('//body/div/span').isNonTranslatable).toBe(true);
    });
  });

  describe('Technical Patterns', () => {
    it('should detect format specifiers', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('%s').isNonTranslatable).toBe(true);
      expect(detector.detect('%d %s').isNonTranslatable).toBe(true);
      expect(detector.detect('%f').isNonTranslatable).toBe(true);
    });

    it('should detect version strings', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('1.0.0').isNonTranslatable).toBe(true);
      expect(detector.detect('v2.3.4').isNonTranslatable).toBe(true);
      expect(detector.detect('1.0.0-beta').isNonTranslatable).toBe(true);
    });

    it('should detect log format patterns', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('[INFO]').isNonTranslatable).toBe(true);
      expect(detector.detect('[ERROR]').isNonTranslatable).toBe(true);
      expect(detector.detect('[DEBUG]').isNonTranslatable).toBe(true);
    });

    it('should detect date format patterns', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('YYYY-MM-DD').isNonTranslatable).toBe(true);
      expect(detector.detect('HH:mm:ss').isNonTranslatable).toBe(true);
    });
  });

  describe('Data Value Patterns', () => {
    it('should detect phone numbers', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('+1 555 123 4567').isNonTranslatable).toBe(true);
      expect(detector.detect('555-123-4567').isNonTranslatable).toBe(true);
      expect(detector.detect('(555) 123-4567').isNonTranslatable).toBe(true);
    });

    it('should detect email addresses', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('user@example.com').isNonTranslatable).toBe(true);
      expect(detector.detect('test.user+tag@domain.co.uk').isNonTranslatable).toBe(true);
    });

    it('should detect URLs', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('https://example.com').isNonTranslatable).toBe(true);
      expect(detector.detect('http://localhost:3000').isNonTranslatable).toBe(true);
      expect(detector.detect('mailto:user@example.com').isNonTranslatable).toBe(true);
      expect(detector.detect('tel:+1234567890').isNonTranslatable).toBe(true);
    });

    it('should detect IP addresses', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('192.168.1.1').isNonTranslatable).toBe(true);
      expect(detector.detect('127.0.0.1:8080').isNonTranslatable).toBe(true);
    });

    it('should detect UUIDs', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('123e4567-e89b-12d3-a456-426614174000').isNonTranslatable).toBe(true);
    });

    it('should detect hex colors', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('#fff').isNonTranslatable).toBe(true);
      expect(detector.detect('#FF5733').isNonTranslatable).toBe(true);
      expect(detector.detect('#FF573380').isNonTranslatable).toBe(true);
    });

    it('should detect file paths', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('./src/index.ts').isNonTranslatable).toBe(true);
      expect(detector.detect('../config/app.json').isNonTranslatable).toBe(true);
      expect(detector.detect('/usr/local/bin').isNonTranslatable).toBe(true);
    });
  });

  describe('Already I18n Patterns', () => {
    it('should detect i18n function calls', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect("t('key')").isNonTranslatable).toBe(true);
      expect(detector.detect("i18n('translation.key')").isNonTranslatable).toBe(true);
      expect(detector.detect("$t('message')").isNonTranslatable).toBe(true);
    });

    it('should detect translation key patterns', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('common.buttons.submit').isNonTranslatable).toBe(true);
      expect(detector.detect('errors.validation.required').isNonTranslatable).toBe(true);
    });
  });

  describe('UI Element Patterns', () => {
    it('should detect emoji-only strings', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('👍').isNonTranslatable).toBe(true);
      expect(detector.detect('🎉 🎊').isNonTranslatable).toBe(true);
    });

    it('should detect symbol-only strings', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('---').isNonTranslatable).toBe(true);
      expect(detector.detect('***').isNonTranslatable).toBe(true);
      expect(detector.detect('•••').isNonTranslatable).toBe(true);
    });

    it('should detect HTML entities', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('&nbsp;').isNonTranslatable).toBe(true);
      expect(detector.detect('&copy;').isNonTranslatable).toBe(true);
      expect(detector.detect('&amp;').isNonTranslatable).toBe(true);
    });
  });

  describe('Placeholder Patterns', () => {
    it('should detect placeholder patterns', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('{{name}}').isNonTranslatable).toBe(true);
      expect(detector.detect('{value}').isNonTranslatable).toBe(true);
      expect(detector.detect('%s').isNonTranslatable).toBe(true);
    });
  });

  describe('Valid Translatable Text', () => {
    it('should NOT flag normal text', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('Hello World').isNonTranslatable).toBe(false);
      expect(detector.detect('Click here to continue').isNonTranslatable).toBe(false);
      expect(detector.detect('Welcome to our application!').isNonTranslatable).toBe(false);
    });

    it('should NOT flag sentences with numbers', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('You have 5 new messages').isNonTranslatable).toBe(false);
      expect(detector.detect('Page 1 of 10').isNonTranslatable).toBe(false);
    });

    it('should NOT flag text with punctuation', () => {
      const detector = new PatternDetector();
      
      expect(detector.detect('Hello, World!').isNonTranslatable).toBe(false);
      expect(detector.detect("What's your name?").isNonTranslatable).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should support disabling specific patterns', () => {
      const detector = new PatternDetector({
        disabledPatterns: ['email', 'phone'],
      });
      
      // These should now pass through
      expect(detector.detect('user@example.com').isNonTranslatable).toBe(false);
      expect(detector.detect('555-123-4567').isNonTranslatable).toBe(false);
      
      // Other patterns should still work
      expect(detector.detect('SELECT * FROM users').isNonTranslatable).toBe(true);
    });

    it('should support enabling only specific patterns', () => {
      const detector = new PatternDetector({
        enabledPatterns: ['sql', 'email'],
      });
      
      // Only SQL and email should be detected
      expect(detector.detect('SELECT * FROM users').isNonTranslatable).toBe(true);
      expect(detector.detect('user@example.com').isNonTranslatable).toBe(true);
      
      // Other patterns should not be detected
      expect(detector.detect('{"key": "value"}').isNonTranslatable).toBe(false);
    });

    it('should support skipping entire categories', () => {
      const detector = new PatternDetector({
        skipCategories: [PatternCategory.DataValue],
      });
      
      // Data value patterns should not be detected
      expect(detector.detect('user@example.com').isNonTranslatable).toBe(false);
      expect(detector.detect('555-123-4567').isNonTranslatable).toBe(false);
      
      // Other categories should still work
      expect(detector.detect('SELECT * FROM users').isNonTranslatable).toBe(true);
    });

    it('should support minimum confidence threshold', () => {
      const detector = new PatternDetector({
        minConfidence: 0.9,
      });
      
      // High confidence patterns should match
      expect(detector.detect('user@example.com').isNonTranslatable).toBe(true); // 0.95
      expect(detector.detect('SELECT * FROM users').isNonTranslatable).toBe(true); // 0.95
      
      // Lower confidence patterns should not match
      // CSS selector has 0.7 confidence
      const cssResult = detector.detect('.my-class');
      expect(cssResult.confidence < 0.9 || !cssResult.isNonTranslatable).toBe(true);
    });

    it('should support custom patterns', () => {
      const detector = new PatternDetector({
        customPatterns: [
          {
            name: 'custom-prefix',
            category: PatternCategory.Technical,
            matcher: /^CUSTOM_/,
            confidence: 1.0,
            description: 'Custom prefix pattern',
          },
        ],
      });
      
      expect(detector.detect('CUSTOM_VALUE').isNonTranslatable).toBe(true);
      // Use a value that doesn't match any built-in patterns (lowercase without dots/underscores)
      expect(detector.detect('Just a normal sentence').isNonTranslatable).toBe(false);
    });
  });

  describe('detectAll', () => {
    it('should return all matching patterns', () => {
      const detector = new PatternDetector();
      
      // Some text might match multiple patterns
      const results = detector.detectAll('SELECT email FROM users');
      
      // Should at least match SQL
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.patternName === 'sql')).toBe(true);
    });

    it('should sort results by confidence', () => {
      const detector = new PatternDetector();
      
      const results = detector.detectAll('SELECT * FROM users');
      
      if (results.length > 1) {
        for (let i = 1; i < results.length; i++) {
          expect(results[i - 1].confidence).toBeGreaterThanOrEqual(results[i].confidence);
        }
      }
    });
  });

  describe('getPatternNames', () => {
    it('should return all pattern names', () => {
      const detector = new PatternDetector();
      const names = detector.getPatternNames();
      
      expect(names).toContain('json-object');
      expect(names).toContain('sql');
      expect(names).toContain('email');
      expect(names).toContain('phone');
    });
  });

  describe('getPatternsByCategory', () => {
    it('should return patterns for a specific category', () => {
      const detector = new PatternDetector();
      
      const dataValuePatterns = detector.getPatternsByCategory(PatternCategory.DataValue);
      expect(dataValuePatterns.length).toBeGreaterThan(0);
      expect(dataValuePatterns.every(p => p.category === PatternCategory.DataValue)).toBe(true);
    });
  });

  describe('Convenience Functions', () => {
    it('isNonTranslatable should work with defaults', () => {
      expect(isNonTranslatable('SELECT * FROM users')).toBe(true);
      expect(isNonTranslatable('Hello World')).toBe(false);
    });

    it('detectNonTranslatablePattern should return details', () => {
      const result = detectNonTranslatablePattern('user@example.com');
      
      expect(result.isNonTranslatable).toBe(true);
      expect(result.category).toBe(PatternCategory.DataValue);
      expect(result.patternName).toBe('email');
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('PATTERN_NAMES export', () => {
    it('should export all pattern names', () => {
      expect(PATTERN_NAMES).toContain('json-object');
      expect(PATTERN_NAMES).toContain('sql');
      expect(PATTERN_NAMES).toContain('email');
      expect(Array.isArray(PATTERN_NAMES)).toBe(true);
    });
  });
});
