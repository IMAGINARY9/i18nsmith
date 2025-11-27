import { describe, it, expect } from 'vitest';
import {
  LocaleValidator,
  DuplicateValueWarning,
  InconsistentKeyWarning,
  OrphanedNamespaceWarning,
} from './locale-validator.js';

describe('LocaleValidator', () => {
  describe('detectDuplicateValues', () => {
    it('detects duplicate values across multiple keys', () => {
      const validator = new LocaleValidator();
      const data = {
        'button.save': 'Save changes',
        'form.submit': 'Save changes',
        'action.confirm': 'Save changes',
        'button.cancel': 'Cancel',
      };

      const warnings = validator.detectDuplicateValues('en', data);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toEqual({
        value: 'Save changes',
        keys: ['action.confirm', 'button.save', 'form.submit'],
        locale: 'en',
      });
    });

    it('ignores short values that are often intentionally duplicated', () => {
      const validator = new LocaleValidator();
      const data = {
        'button.ok': 'OK',
        'dialog.ok': 'OK',
        'button.no': 'No',
        'dialog.no': 'No',
      };

      const warnings = validator.detectDuplicateValues('en', data);

      expect(warnings).toHaveLength(0);
    });

    it('respects minDuplicateValueLength option', () => {
      const validator = new LocaleValidator({ minDuplicateValueLength: 2 });
      const data = {
        'button.ok': 'OK',
        'dialog.ok': 'OK',
      };

      const warnings = validator.detectDuplicateValues('en', data);

      expect(warnings).toHaveLength(1);
    });

    it('normalizes whitespace for comparison', () => {
      const validator = new LocaleValidator();
      const data = {
        'key1': 'Hello World',
        'key2': '  Hello World  ',
        'key3': 'Different value',
      };

      const warnings = validator.detectDuplicateValues('en', data);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].keys).toContain('key1');
      expect(warnings[0].keys).toContain('key2');
    });

    it('returns empty array when no duplicates', () => {
      const validator = new LocaleValidator();
      const data = {
        'key1': 'Value one',
        'key2': 'Value two',
        'key3': 'Value three',
      };

      const warnings = validator.detectDuplicateValues('en', data);

      expect(warnings).toHaveLength(0);
    });

    it('sorts results by number of duplicate keys (descending)', () => {
      const validator = new LocaleValidator();
      const data = {
        'a1': 'Three copies',
        'a2': 'Three copies',
        'a3': 'Three copies',
        'b1': 'Two copies',
        'b2': 'Two copies',
      };

      const warnings = validator.detectDuplicateValues('en', data);

      expect(warnings).toHaveLength(2);
      expect(warnings[0].keys).toHaveLength(3);
      expect(warnings[1].keys).toHaveLength(2);
    });
  });

  describe('detectInconsistentKeys', () => {
    it('detects abbreviation vs full word conflicts', () => {
      const validator = new LocaleValidator();
      const keys = [
        'btn.save',
        'btn.cancel',
        'button.submit',
        'button.reset',
      ];

      const warnings = validator.detectInconsistentKeys(keys);

      expect(warnings.length).toBeGreaterThan(0);
      const btnWarning = warnings.find(w => w.pattern.includes('btn'));
      expect(btnWarning).toBeDefined();
      expect(btnWarning!.variants).toContain('btn.save');
    });

    it('detects case inconsistencies in namespaces', () => {
      const validator = new LocaleValidator();
      const keys = [
        'Auth.login',
        'auth.logout',
        'AUTH.register',
      ];

      const warnings = validator.detectInconsistentKeys(keys);

      const caseWarning = warnings.find(w => w.pattern.includes('Case mismatch'));
      expect(caseWarning).toBeDefined();
    });

    it('returns empty array when keys are consistent', () => {
      const validator = new LocaleValidator();
      const keys = [
        'auth.login',
        'auth.logout',
        'user.profile',
        'user.settings',
      ];

      const warnings = validator.detectInconsistentKeys(keys);

      expect(warnings).toHaveLength(0);
    });
  });

  describe('detectOrphanedNamespaces', () => {
    it('detects namespaces with few keys', () => {
      const validator = new LocaleValidator();
      const keys = [
        'common.save',
        'common.cancel',
        'common.ok',
        'common.yes',
        'common.no',
        'orphan.lonely',  // Only 1 key in this namespace
      ];

      const warnings = validator.detectOrphanedNamespaces(keys);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toEqual({
        namespace: 'orphan',
        keyCount: 1,
        keys: ['orphan.lonely'],
      });
    });

    it('respects orphanedNamespaceThreshold option', () => {
      const validator = new LocaleValidator({ orphanedNamespaceThreshold: 3 });
      const keys = [
        'small.one',
        'small.two',
        'small.three',
        'large.one',
        'large.two',
        'large.three',
        'large.four',
      ];

      const warnings = validator.detectOrphanedNamespaces(keys);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].namespace).toBe('small');
    });

    it('ignores keys without namespace', () => {
      const validator = new LocaleValidator();
      const keys = [
        'flatKey',
        'anotherFlatKey',
        'namespace.key1',
        'namespace.key2',
        'namespace.key3',
      ];

      const warnings = validator.detectOrphanedNamespaces(keys);

      expect(warnings).toHaveLength(0);
    });

    it('sorts by key count ascending', () => {
      const validator = new LocaleValidator();
      const keys = [
        'two.a',
        'two.b',
        'one.single',
      ];

      const warnings = validator.detectOrphanedNamespaces(keys);

      expect(warnings).toHaveLength(2);
      expect(warnings[0].keyCount).toBe(1);
      expect(warnings[1].keyCount).toBe(2);
    });
  });

  describe('validateLocale', () => {
    it('returns comprehensive quality report', () => {
      const validator = new LocaleValidator();
      const data = {
        'common.save': 'Save',
        'common.cancel': 'Cancel',
        'btn.submit': 'Save', // Duplicate value with slightly different case
        'button.reset': 'Reset', // Inconsistent with btn.*
        'orphan.lonely': 'All alone',
      };

      const report = validator.validateLocale('en', data);

      expect(report).toHaveProperty('duplicateValues');
      expect(report).toHaveProperty('inconsistentKeys');
      expect(report).toHaveProperty('orphanedNamespaces');
    });
  });

  describe('validateKeyConsistency', () => {
    it('detects missing keys across locales', () => {
      const validator = new LocaleValidator();
      const localesData = new Map<string, Record<string, string>>();
      localesData.set('en', { 'common.save': 'Save', 'common.cancel': 'Cancel', 'en.only': 'English only' });
      localesData.set('de', { 'common.save': 'Speichern', 'common.cancel': 'Abbrechen' });
      localesData.set('fr', { 'common.save': 'Sauvegarder' });

      const result = validator.validateKeyConsistency(localesData);

      expect(result.get('en')!.missing).toHaveLength(0);
      expect(result.get('de')!.missing).toContain('en.only');
      expect(result.get('fr')!.missing).toContain('common.cancel');
      expect(result.get('fr')!.missing).toContain('en.only');
    });

    it('returns empty missing arrays when all locales have same keys', () => {
      const validator = new LocaleValidator();
      const localesData = new Map<string, Record<string, string>>();
      localesData.set('en', { 'common.save': 'Save', 'common.cancel': 'Cancel' });
      localesData.set('de', { 'common.save': 'Speichern', 'common.cancel': 'Abbrechen' });

      const result = validator.validateKeyConsistency(localesData);

      expect(result.get('en')!.missing).toHaveLength(0);
      expect(result.get('de')!.missing).toHaveLength(0);
    });
  });

  describe('custom delimiter', () => {
    it('uses custom delimiter for namespace extraction', () => {
      const validator = new LocaleValidator({ delimiter: '/' });
      const keys = [
        'orphan/lonely',
        'common/save',
        'common/cancel',
        'common/ok',
      ];

      const warnings = validator.detectOrphanedNamespaces(keys);

      expect(warnings).toHaveLength(1);
      expect(warnings[0].namespace).toBe('orphan');
    });
  });
});
