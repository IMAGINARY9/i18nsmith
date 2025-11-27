# Refactoring Plan: Quality Improvements & Edge Case Coverage

**Date:** 2025-11-27  
**Status:** ✅ Complete  
**Priority:** High  
**Last Updated:** All parts implemented

## Progress Summary

| Phase | Status | Notes |
|-------|--------|-------|
| Part 1: Immediate Small Fixes | ✅ Complete | Suspicious key detection enhanced |
| Part 2: Syncer Decomposition | ✅ Complete | KeyValidator, ReferenceExtractor, PlaceholderValidator extracted |
| Part 3: Transformer Pre-flight | ✅ Complete | Validation, audit command, strict mode |
| Part 4: Locale Quality Checks | ✅ Complete | LocaleValidator for duplicates, consistency, orphans |
| Part 5: Test Coverage | ✅ Complete | 49 new tests (edge cases + integration) |
| Part 6: Documentation | ✅ Complete | Troubleshooting + Best Practices guides |

### Commits Made

1. `refactor: extract KeyValidator class and add audit command`
   - Extracted `KeyValidator` from syncer (~100 lines)
   - Added `SuspiciousKeyReason` typed enum
   - Created 23 KeyValidator tests
   - Added `audit` CLI command

2. `feat(transformer): add pre-flight key validation`
   - Added KeyValidator to transformer
   - Validate generated keys before transformation
   - Keys failing validation are marked as 'skipped'

3. `refactor: extract ReferenceExtractor from syncer`
   - Added `ReferenceExtractor` class (~360 lines)
   - Support for caching, dynamic key detection
   - Created 5 ReferenceExtractor tests

4. `feat(core): add PlaceholderValidator class`
   - Added `PlaceholderValidator` with compare/validate methods
   - Created 14 PlaceholderValidator tests

5. `feat: add LocaleValidator for quality checks`
   - Added `LocaleValidator` class for duplicate detection
   - Key consistency validation across locales
   - Orphaned namespace detection
   - Enhanced `audit` CLI with quality check options

6. `feat: add comprehensive edge case and integration tests`
   - 38 edge case tests (suspicious keys, key-value patterns, format preservation)
   - 11 integration tests (real project structures)

7. `docs: add troubleshooting and best practices guides`
   - Comprehensive troubleshooting guide
   - Best practices for key naming, namespaces, CI/CD, migrations

---

## Executive Summary

Following Round 3 testing, several quality issues persist with "key-as-value" patterns, suspicious key detection, and code maintainability. This plan outlines a structured approach to improve implementation quality while covering specific edge cases.

---

## Part 1: Immediate Small Fixes ✅ COMPLETE

These are small, localized changes that can be implemented immediately.

### 1.1 ✅ Enhanced Suspicious Key Detection (Completed)
Extended `isSuspiciousKey()` to detect:
- Keys with trailing punctuation (`:`, `?`, `!`)
- Keys with sentence articles/prepositions (`The`, `To`, `A`, `For`, etc.)
- PascalCase sentence-like patterns (4+ capitalized words)

### 1.2 ✅ Suspicious Key Reason Reporting (Completed)
Extracted to `KeyValidator` class with typed `SuspiciousKeyReason`:
- `'contains-spaces'`
- `'single-word-no-namespace'`
- `'trailing-punctuation'`
- `'pascal-case-sentence'`
- `'sentence-article'`
- `'key-equals-value'`

### 1.3 ✅ Locale Audit Command (Completed)
Added `i18nsmith audit` CLI command to scan locale files:

```bash
i18nsmith audit --locale en
# Output:
# ⚠️  Suspicious keys detected in en.json:
#   - "When to Use Categorized View:" (reason: trailing-punctuation)
#   - "Found" (reason: single-word-no-namespace)
#   - "TheQuickBrownFox" (reason: sentence-article-detected)
```

---

## Part 2: Syncer Decomposition ✅ COMPLETE

The `syncer.ts` file at 1206 lines was too large and handled multiple concerns.

### 2.1 ✅ Extract Key Validation Module (Completed)
**File:** `packages/core/src/key-validator.ts`

```typescript
export type SuspiciousKeyReason =
  | 'contains-spaces'
  | 'single-word-no-namespace'
  | 'trailing-punctuation'
  | 'sentence-article'
  | 'pascal-case-sentence'
  | 'key-equals-value';

export class KeyValidator {
  constructor(private readonly policy: SuspiciousKeyPolicy) {}

  public analyze(key: string): KeyAnalysisResult { ... }
  public analyzeWithValue(key: string, value?: string): KeyValueAnalysisResult { ... }
  public validate(key: string, value?: string): KeyValidationResult { ... }
  public suggestFix(key: string, reason?: SuspiciousKeyReason): string | undefined { ... }
  public isValidKeyFormat(key: string): boolean { ... }
  public shouldSkip(key: string): boolean { ... }
}
```

### 2.2 ✅ Extract Reference Extractor (Completed)
**File:** `packages/core/src/reference-extractor.ts`

Moved all AST-based reference extraction from `syncer.ts`:
- `extractFromFile()` - Extract references from single file
- `extractKeyFromCall()` - Analyze call expressions
- Reference caching logic with fingerprinting
- Dynamic key warning generation

### 2.3 ✅ Extract Placeholder Validator (Completed)
**File:** `packages/core/src/placeholders.ts`

Added `PlaceholderValidator` class to existing module:
- `extract(value)` - Extract placeholders from value
- `compare(source, target)` - Compare placeholders between values
- `validate(source, target)` - Check if placeholders match
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
