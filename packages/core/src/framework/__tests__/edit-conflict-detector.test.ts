/**
 * Tests for Edit Collision Detection and Resolution
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  EditConflictDetector,
  EditOperation,
  ConflictType,
  rangesOverlap,
  rangeContains,
  rangesAdjacent,
  rangesEqual,
  detectConflicts,
  planEdits,
  applyEdits,
  validateEditPlan,
  canApplyEdits,
  createEdit,
} from '../utils/edit-conflict-detector';

describe('EditConflictDetector', () => {
  describe('Range Utility Functions', () => {
    describe('rangesOverlap', () => {
      it('should detect overlapping ranges', () => {
        expect(rangesOverlap({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(true);
        expect(rangesOverlap({ start: 5, end: 15 }, { start: 0, end: 10 })).toBe(true);
      });

      it('should return false for non-overlapping ranges', () => {
        expect(rangesOverlap({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(false);
        expect(rangesOverlap({ start: 0, end: 10 }, { start: 15, end: 25 })).toBe(false);
      });

      it('should handle zero-width ranges', () => {
        expect(rangesOverlap({ start: 5, end: 5 }, { start: 5, end: 10 })).toBe(false);
      });
    });

    describe('rangeContains', () => {
      it('should detect when outer contains inner', () => {
        expect(rangeContains({ start: 0, end: 20 }, { start: 5, end: 15 })).toBe(true);
      });

      it('should return true for equal ranges', () => {
        expect(rangeContains({ start: 5, end: 15 }, { start: 5, end: 15 })).toBe(true);
      });

      it('should return false when inner extends beyond outer', () => {
        expect(rangeContains({ start: 5, end: 15 }, { start: 0, end: 10 })).toBe(false);
        expect(rangeContains({ start: 5, end: 15 }, { start: 10, end: 20 })).toBe(false);
      });
    });

    describe('rangesAdjacent', () => {
      it('should detect adjacent ranges', () => {
        expect(rangesAdjacent({ start: 0, end: 10 }, { start: 10, end: 20 })).toBe(true);
        expect(rangesAdjacent({ start: 10, end: 20 }, { start: 0, end: 10 })).toBe(true);
      });

      it('should return false for non-adjacent ranges', () => {
        expect(rangesAdjacent({ start: 0, end: 10 }, { start: 15, end: 25 })).toBe(false);
      });

      it('should return false for overlapping ranges', () => {
        expect(rangesAdjacent({ start: 0, end: 10 }, { start: 5, end: 15 })).toBe(false);
      });
    });

    describe('rangesEqual', () => {
      it('should detect equal ranges', () => {
        expect(rangesEqual({ start: 5, end: 15 }, { start: 5, end: 15 })).toBe(true);
      });

      it('should return false for different ranges', () => {
        expect(rangesEqual({ start: 5, end: 15 }, { start: 5, end: 16 })).toBe(false);
        expect(rangesEqual({ start: 4, end: 15 }, { start: 5, end: 15 })).toBe(false);
      });
    });
  });

  describe('detectConflicts', () => {
    it('should detect no conflicts for non-overlapping edits', () => {
      const edits: EditOperation[] = [
        createEdit('1', 0, 10, 'a'),
        createEdit('2', 20, 30, 'b'),
        createEdit('3', 40, 50, 'c'),
      ];

      const result = detectConflicts(edits);
      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect overlapping conflicts', () => {
      const edits: EditOperation[] = [
        createEdit('1', 0, 15, 'a'),
        createEdit('2', 10, 25, 'b'),
      ];

      const result = detectConflicts(edits);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe(ConflictType.Overlap);
    });

    it('should detect containment conflicts', () => {
      const edits: EditOperation[] = [
        createEdit('outer', 0, 30, '{t("key")}'),
        createEdit('inner', 5, 20, 't("key")'),
      ];

      const result = detectConflicts(edits);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe(ConflictType.Containment);
      expect(result.conflicts[0].edit1.id).toBe('outer');
      expect(result.conflicts[0].edit2.id).toBe('inner');
    });

    it('should detect duplicate conflicts', () => {
      const edits: EditOperation[] = [
        createEdit('1', 10, 20, 'a'),
        createEdit('2', 10, 20, 'b'),
      ];

      const result = detectConflicts(edits);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe(ConflictType.Duplicate);
    });

    it('should detect adjacent conflicts when configured', () => {
      const edits: EditOperation[] = [
        createEdit('1', 0, 10, 'a'),
        createEdit('2', 10, 20, 'b'),
      ];

      const result = detectConflicts(edits, { allowAdjacent: false });
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe(ConflictType.Adjacent);
    });

    it('should allow adjacent edits by default', () => {
      const edits: EditOperation[] = [
        createEdit('1', 0, 10, 'a'),
        createEdit('2', 10, 20, 'b'),
      ];

      const result = detectConflicts(edits);
      expect(result.hasConflicts).toBe(false);
    });

    it('should detect multiple conflicts', () => {
      const edits: EditOperation[] = [
        createEdit('1', 0, 10, 'a'),
        createEdit('2', 5, 15, 'b'),
        createEdit('3', 5, 15, 'c'),
      ];

      const result = detectConflicts(edits);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('planEdits', () => {
    it('should sort edits by position (end-first) for safe application', () => {
      const edits: EditOperation[] = [
        createEdit('first', 0, 10, 'a'),
        createEdit('second', 20, 30, 'b'),
        createEdit('third', 40, 50, 'c'),
      ];

      const planned = planEdits(edits);
      
      // Should be sorted end-first
      expect(planned[0].id).toBe('third');
      expect(planned[1].id).toBe('second');
      expect(planned[2].id).toBe('first');
    });

    it('should exclude nested edits when parent exists (auto-resolve)', () => {
      const edits: EditOperation[] = [
        createEdit('outer', 0, 50, '{t("outer")}'),
        createEdit('inner1', 10, 20, 't("inner1")'),
        createEdit('inner2', 25, 35, 't("inner2")'),
      ];

      const planned = planEdits(edits, { autoResolveContainment: true });
      
      // Should only have the outer edit
      expect(planned).toHaveLength(1);
      expect(planned[0].id).toBe('outer');
    });

    it('should keep nested edits when auto-resolve is disabled', () => {
      const edits: EditOperation[] = [
        createEdit('outer', 0, 50, '{t("outer")}'),
        createEdit('inner', 10, 20, 't("inner")'),
      ];

      const planned = planEdits(edits, { autoResolveContainment: false });
      
      // Should have both edits
      expect(planned).toHaveLength(2);
    });

    it('should respect priority ordering', () => {
      const edits: EditOperation[] = [
        createEdit('low', 0, 10, 'a', { priority: 1 }),
        createEdit('high', 20, 30, 'b', { priority: 10 }),
        createEdit('medium', 40, 50, 'c', { priority: 5 }),
      ];

      const planned = planEdits(edits);
      
      expect(planned[0].id).toBe('high');
      expect(planned[1].id).toBe('medium');
      expect(planned[2].id).toBe('low');
    });

    it('should handle empty edit list', () => {
      const planned = planEdits([]);
      expect(planned).toHaveLength(0);
    });
  });

  describe('applyEdits', () => {
    it('should apply single edit correctly', () => {
      const source = 'Hello World';
      const edits = [createEdit('1', 0, 5, 'Hi')];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('Hi World');
    });

    it('should apply multiple non-overlapping edits', () => {
      const source = 'Hello World Today';
      const edits = [
        createEdit('1', 0, 5, 'Hi'),
        createEdit('2', 12, 17, 'Now'),
      ];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('Hi World Now');
    });

    it('should handle edits regardless of input order', () => {
      const source = 'aaa bbb ccc';
      const edits = [
        createEdit('3', 8, 11, 'CCC'),
        createEdit('1', 0, 3, 'AAA'),
        createEdit('2', 4, 7, 'BBB'),
      ];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('AAA BBB CCC');
    });

    it('should handle deletion (empty replacement)', () => {
      const source = 'Hello World';
      const edits = [createEdit('1', 5, 11, '')];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('Hello');
    });

    it('should handle insertion at position', () => {
      const source = 'HelloWorld';
      const edits = [createEdit('1', 5, 5, ' ')];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('Hello World');
    });

    it('should throw for invalid range (negative start)', () => {
      const source = 'Hello';
      const edits = [createEdit('1', -1, 5, 'Hi')];
      
      expect(() => applyEdits(source, edits)).toThrow();
    });

    it('should throw for invalid range (end beyond source)', () => {
      const source = 'Hello';
      const edits = [createEdit('1', 0, 100, 'Hi')];
      
      expect(() => applyEdits(source, edits)).toThrow();
    });

    it('should throw for invalid range (start > end)', () => {
      const source = 'Hello';
      const edits = [createEdit('1', 10, 5, 'Hi')];
      
      expect(() => applyEdits(source, edits)).toThrow();
    });
  });

  describe('validateEditPlan', () => {
    it('should pass valid edit plan', () => {
      const edits = [
        createEdit('1', 0, 10, 'a'),
        createEdit('2', 20, 30, 'b'),
      ];
      
      const result = validateEditPlan(edits, 50);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should fail for negative start', () => {
      const edits = [createEdit('1', -5, 10, 'a')];
      
      const result = validateEditPlan(edits, 50);
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.message.includes('negative'))).toBe(true);
    });

    it('should fail for end beyond source', () => {
      const edits = [createEdit('1', 0, 100, 'a')];
      
      const result = validateEditPlan(edits, 50);
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.message.includes('exceeds'))).toBe(true);
    });

    it('should fail for overlapping edits', () => {
      const edits = [
        createEdit('1', 0, 15, 'a'),
        createEdit('2', 10, 25, 'b'),
      ];
      
      const result = validateEditPlan(edits, 50);
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.message.toLowerCase().includes('overlap'))).toBe(true);
    });

    it('should warn for adjacent edits', () => {
      const edits = [
        createEdit('1', 0, 10, 'a'),
        createEdit('2', 10, 20, 'b'),
      ];
      
      const result = validateEditPlan(edits, 50);
      // Adjacent is warning, not error
      expect(result.isValid).toBe(true);
    });
  });

  describe('canApplyEdits', () => {
    it('should return true for valid edits', () => {
      const edits = [createEdit('1', 0, 10, 'a')];
      expect(canApplyEdits(edits, 20)).toBe(true);
    });

    it('should return false for invalid edits', () => {
      const edits = [createEdit('1', 0, 100, 'a')];
      expect(canApplyEdits(edits, 20)).toBe(false);
    });
  });

  describe('EditConflictDetector class', () => {
    let detector: EditConflictDetector;

    beforeEach(() => {
      detector = new EditConflictDetector();
    });

    it('should add and track pending edits', () => {
      detector.addEdit(createEdit('1', 0, 10, 'a'));
      detector.addEdit(createEdit('2', 20, 30, 'b'));
      
      expect(detector.getPendingEdits()).toHaveLength(2);
    });

    it('should add multiple edits at once', () => {
      detector.addEdits([
        createEdit('1', 0, 10, 'a'),
        createEdit('2', 20, 30, 'b'),
      ]);
      
      expect(detector.getPendingEdits()).toHaveLength(2);
    });

    it('should clear all edits', () => {
      detector.addEdit(createEdit('1', 0, 10, 'a'));
      detector.clear();
      
      expect(detector.getPendingEdits()).toHaveLength(0);
    });

    it('should detect conflicts in pending edits', () => {
      detector.addEdits([
        createEdit('1', 0, 15, 'a'),
        createEdit('2', 10, 25, 'b'),
      ]);
      
      const result = detector.detectConflicts();
      expect(result.hasConflicts).toBe(true);
    });

    it('should plan edits for safe execution', () => {
      detector.addEdits([
        createEdit('first', 0, 10, 'a'),
        createEdit('second', 20, 30, 'b'),
      ]);
      
      const planned = detector.plan();
      expect(planned).toHaveLength(2);
      // Should be sorted end-first
      expect(planned[0].range.start).toBeGreaterThan(planned[1].range.start);
    });

    it('should validate edits against source', () => {
      detector.addEdit(createEdit('1', 0, 100, 'a'));
      
      const result = detector.validate(50);
      expect(result.isValid).toBe(false);
    });

    it('should apply edits and track completed', () => {
      detector.addEdits([
        createEdit('1', 0, 5, 'Hi'),
        createEdit('2', 6, 11, 'Earth'),
      ]);
      
      const { result, appliedEdits } = detector.apply('Hello World');
      
      expect(result).toBe('Hi Earth');
      expect(appliedEdits).toHaveLength(2);
      expect(detector.getCompletedEdits()).toHaveLength(2);
      expect(detector.getPendingEdits()).toHaveLength(0);
    });

    it('should throw when applying invalid edits', () => {
      detector.addEdit(createEdit('1', 0, 100, 'a'));
      
      expect(() => detector.apply('Hello')).toThrow();
    });

    it('should create rollback plan', () => {
      const originalSource = 'Hello World';
      detector.addEdit(createEdit('1', 0, 5, 'Hi'));
      
      const { result } = detector.apply(originalSource);
      expect(result).toBe('Hi World');
      
      const rollback = detector.createRollbackPlan(originalSource);
      expect(rollback).toHaveLength(1);
      
      // Apply rollback
      const restored = applyEdits(result, rollback);
      expect(restored).toBe(originalSource);
    });

    it('should handle multiple rollbacks correctly', () => {
      const originalSource = 'aaa bbb ccc';
      detector.addEdits([
        createEdit('1', 0, 3, 'AAA'),
        createEdit('2', 4, 7, 'BBB'),
        createEdit('3', 8, 11, 'CCC'),
      ]);
      
      const { result } = detector.apply(originalSource);
      expect(result).toBe('AAA BBB CCC');
      
      const rollback = detector.createRollbackPlan(originalSource);
      const restored = applyEdits(result, rollback);
      expect(restored).toBe(originalSource);
    });
  });

  describe('Real-world JSX Transform Scenarios', () => {
    it('should handle nested JSX expression edits', () => {
      // Simulate: <div>{"Hello " + name + "!"}</div>
      // The entire expression should be one edit, not multiple
      const source = '<div>{"Hello " + name + "!"}</div>';
      // source[5:28] = {"Hello " + name + "!"}
      
      const edits = [
        createEdit('whole-expr', 5, 28, '{t("hello_name", { name })}'),
      ];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('<div>{t("hello_name", { name })}</div>');
    });

    it('should handle multiple non-conflicting JSX edits', () => {
      const source = '<div><p>Hello</p><p>World</p></div>';
      // source[8:13] = Hello, source[20:25] = World
      
      const edits = [
        createEdit('1', 8, 13, '{t("hello")}'),
        createEdit('2', 20, 25, '{t("world")}'),
      ];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('<div><p>{t("hello")}</p><p>{t("world")}</p></div>');
    });

    it('should exclude inner edits when outer encompasses them', () => {
      // Scenario: Parent expression edit vs child string literal edit
      const edits = [
        createEdit('parent', 0, 30, '{t("combined")}'),
        createEdit('child1', 5, 12, 't("a")'),
        createEdit('child2', 15, 25, 't("b")'),
      ];

      const detector = new EditConflictDetector({ autoResolveContainment: true });
      detector.addEdits(edits);
      
      const planned = detector.plan();
      expect(planned).toHaveLength(1);
      expect(planned[0].id).toBe('parent');
    });

    it('should handle template literal conversion', () => {
      // <div>{`Hello ${name}`}</div>
      const source = '<div>{`Hello ${name}`}</div>';
      // source[5:22] = {`Hello ${name}`}
      
      const edits = [
        createEdit('template', 5, 22, '{t("hello_name", { name })}'),
      ];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('<div>{t("hello_name", { name })}</div>');
    });

    it('should handle adjacent text and expression', () => {
      // <p>Label: {value}</p>
      // When combining into single translation
      const source = '<p>Label: {value}</p>';
      
      const edits = [
        createEdit('combined', 3, 17, '{t("label_value", { value })}'),
      ];
      
      const result = applyEdits(source, edits);
      expect(result).toBe('<p>{t("label_value", { value })}</p>');
    });
  });
});
