# Refactoring Plan: Quality Improvements & Edge Case Coverage

**Date:** 2025-11-27  
**Status:** Proposed  
**Priority:** High  

## Executive Summary

Following Round 3 testing, several quality issues persist with "key-as-value" patterns, suspicious key detection, and code maintainability. This plan outlines a structured approach to improve implementation quality while covering specific edge cases.

---

## Part 1: Immediate Small Fixes (Do Now)

These are small, localized changes that can be implemented immediately.

### 1.1 ✅ Enhanced Suspicious Key Detection (Completed)
Extended `isSuspiciousKey()` to detect:
- Keys with trailing punctuation (`:`, `?`, `!`)
- Keys with sentence articles/prepositions (`The`, `To`, `A`, `For`, etc.)
- PascalCase sentence-like patterns (4+ capitalized words)

### 1.2 Suspicious Key Reason Reporting
**Current State:** `isSuspiciousKey()` returns boolean only.  
**Improvement:** Return specific reason for better debugging.

```typescript
// syncer.ts - Change from:
private isSuspiciousKey(key: string): boolean { ... }

// To:
private analyzeSuspiciousKey(key: string): { suspicious: boolean; reason?: string } {
  if (key.includes(' ')) {
    return { suspicious: true, reason: 'contains-spaces' };
  }
  if (!key.includes('.') && /^[A-Za-z]+$/.test(key)) {
    return { suspicious: true, reason: 'single-word-no-namespace' };
  }
  if (/[:?!]$/.test(key)) {
    return { suspicious: true, reason: 'trailing-punctuation' };
  }
  // ... etc
  return { suspicious: false };
}
```

### 1.3 Locale Audit Command
Add `i18nsmith audit` to scan locale files for malformed keys without touching code.

```bash
i18nsmith audit --locale en
# Output:
# ⚠️  Suspicious keys detected in en.json:
#   - "When to Use Categorized View:" (reason: trailing-punctuation)
#   - "Found" (reason: single-word-no-namespace)
#   - "TheQuickBrownFox" (reason: sentence-article-detected)
```

---

## Part 2: Syncer Decomposition (Medium Effort)

The `syncer.ts` file at 1206 lines is too large and handles multiple concerns.

### 2.1 Extract Key Validation Module
**File:** `packages/core/src/key-validator.ts`

```typescript
export interface KeyValidationResult {
  valid: boolean;
  suspicious: boolean;
  reason?: SuspiciousKeyReason;
  suggestions?: string[];
}

export type SuspiciousKeyReason =
  | 'contains-spaces'
  | 'single-word-no-namespace'
  | 'trailing-punctuation'
  | 'sentence-article'
  | 'pascal-case-sentence'
  | 'key-equals-value';

export class KeyValidator {
  constructor(private readonly policy: SuspiciousKeyPolicy) {}

  public validate(key: string, value?: string): KeyValidationResult { ... }
  public suggestFix(key: string): string | undefined { ... }
  public isValidKeyFormat(key: string): boolean { ... }
}
```

### 2.2 Extract Reference Extractor
**File:** `packages/core/src/reference-extractor.ts`

Move all AST-based reference extraction from `syncer.ts`:
- `extractReferencesFromFile()`
- `extractKeyFromCall()`
- Reference caching logic

### 2.3 Extract Placeholder Validator
**File:** `packages/core/src/placeholder-validator.ts`

Move placeholder validation logic:
- `validatePlaceholderConsistency()`
- `buildPlaceholderIssues()`

### 2.4 Proposed Syncer Structure After Decomposition

```
packages/core/src/
├── syncer.ts              (~400 lines, orchestration only)
├── key-validator.ts       (~150 lines)
├── reference-extractor.ts (~250 lines)
├── placeholder-validator.ts (~100 lines)
├── sync-reporter.ts       (~150 lines, builds SyncSummary)
└── sync-applicator.ts     (~150 lines, applies changes to locale files)
```

---

## Part 3: Key-as-Value Prevention Pipeline

### 3.1 Transformer Pre-flight Check
Before transforming, validate that generated keys don't match common anti-patterns:

```typescript
// transformer.ts
private validateGeneratedKey(key: string, originalText: string): boolean {
  // Reject if key is identical to original text (normalization aside)
  if (this.normalizeForComparison(key) === this.normalizeForComparison(originalText)) {
    return false;
  }
  
  // Reject if key looks like a sentence
  const validator = new KeyValidator('error');
  const result = validator.validate(key);
  return !result.suspicious;
}
```

### 3.2 Syncer Post-sync Audit
After sync operations, automatically audit for newly introduced suspicious patterns:

```typescript
// syncer.ts
private async auditNewKeys(addedKeys: string[]): Promise<AuditWarning[]> {
  const warnings: AuditWarning[] = [];
  for (const key of addedKeys) {
    const value = await this.localeStore.getValue(this.sourceLocale, key);
    if (this.keyEqualsValue(key, value)) {
      warnings.push({
        key,
        type: 'key-equals-value',
        suggestion: 'Consider using a structured key or providing a proper translation',
      });
    }
  }
  return warnings;
}
```

### 3.3 CI Integration Mode
Add `--strict` flag that fails on any suspicious patterns:

```bash
i18nsmith sync --strict
# Exit code 1 if any:
# - Key equals value
# - Suspicious key patterns
# - Empty/placeholder values in source locale
```

---

## Part 4: Locale File Quality Checks

### 4.1 Duplicate Value Detection
Flag when multiple keys have identical values (potential consolidation opportunity):

```typescript
interface DuplicateValueWarning {
  value: string;
  keys: string[];
  locale: string;
}

public detectDuplicateValues(locale: string): DuplicateValueWarning[] { ... }
```

### 4.2 Key Consistency Across Locales
Ensure key naming is consistent (e.g., `auth.login` vs `authentication.login`):

```typescript
interface InconsistentKeyWarning {
  pattern: string;
  variants: string[];
  suggestion: string;
}

public detectInconsistentKeys(): InconsistentKeyWarning[] { ... }
```

### 4.3 Orphaned Namespace Detection
Detect namespaces with only 1-2 keys (candidates for consolidation):

```typescript
interface OrphanedNamespaceWarning {
  namespace: string;
  keyCount: number;
  keys: string[];
}

public detectOrphanedNamespaces(): OrphanedNamespaceWarning[] { ... }
```

---

## Part 5: Test Coverage Improvements

### 5.1 Edge Case Test Suite
Create dedicated test file for edge cases:

**File:** `packages/core/src/edge-cases.test.ts`

```typescript
describe('Edge Cases', () => {
  describe('Suspicious Key Detection', () => {
    it('detects "When to Use Categorized View:" as suspicious');
    it('detects "TheQuickBrownFox" as suspicious');
    it('detects "HowToGetStarted" as suspicious');
    it('allows "auth.login.title" as valid');
    it('allows "menu.items.count" as valid');
  });

  describe('Key-Value Patterns', () => {
    it('flags key === value as suspicious');
    it('flags key === titleCase(value) as suspicious');
    it('allows key with meaningful different value');
  });

  describe('Locale Format Preservation', () => {
    it('preserves nested structure when format=auto');
    it('flattens structure when format=flat');
    it('expands structure when format=nested');
  });
});
```

### 5.2 Integration Test Suite
Add end-to-end tests simulating real project structures:

**File:** `packages/core/src/integration.test.ts`

```typescript
describe('Integration', () => {
  it('transforms Next.js App Router project correctly');
  it('preserves existing translations during migration');
  it('handles mixed nested/flat locale files');
  it('respects dynamicKeyGlobs for runtime keys');
});
```

---

## Part 6: Documentation Improvements

### 6.1 Troubleshooting Guide
**File:** `docs/troubleshooting.md`

Common issues and solutions:
- "Why are my keys showing as suspicious?"
- "Why are my target locales being cleared?"
- "Why do I see key=value patterns?"

### 6.2 Best Practices Guide
**File:** `docs/best-practices.md`

- Key naming conventions
- Namespace organization
- CI/CD integration
- Migration strategies

---

## Implementation Priority

| Phase | Items | Effort | Impact |
|-------|-------|--------|--------|
| **Now** | 1.2, 1.3 | Small | High |
| **Week 1** | 2.1, 3.1, 3.2 | Medium | High |
| **Week 2** | 2.2, 2.3, 2.4 | Medium | Medium |
| **Week 3** | 4.1, 4.2, 4.3 | Medium | Medium |
| **Week 4** | 5.1, 5.2, 6.1, 6.2 | Small | High |

---

## Success Metrics

1. **Zero key-as-value patterns** in new transformations
2. **100% test coverage** for suspicious key detection
3. **Syncer < 500 lines** after decomposition
4. **Clear audit trail** for all detected issues
5. **CI integration** blocks suspicious patterns before merge

---

## Next Steps

1. ✅ Commit current suspicious key detection improvements
2. Implement `analyzeSuspiciousKey()` with reasons (1.2)
3. Add `audit` command scaffold (1.3)
4. Extract `KeyValidator` class (2.1)
5. Add transformer pre-flight validation (3.1)
