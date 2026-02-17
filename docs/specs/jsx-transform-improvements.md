# JSX Transform Improvements Plan

## Overview

This document outlines the improvements needed for i18nsmith to handle complex JSX patterns correctly during transformation. The issues were identified from real-world test cases involving string concatenation, template literals, dynamic variables, and edge cases.

## Problem Analysis

### Critical Issues Identified

| Issue | Original Code | Current Output | Expected Output |
|-------|--------------|----------------|-----------------|
| String concatenation | `{'Hello, ' + 'world!'}` | `{t('...')}d22ef')n.app...}` (corrupted) | `{t('common.greeting')}` with merged value |
| Template literal with expression | `` {`backtick ${'value'}`} `` | Missing closing tags | `{t('common.template', { value })}` or skip |
| Label + dynamic variable | `User name: {userName}` | `{t('user-name')}` (variable lost) | `{t('user-name', { name: userName })}` or `{t('user-name-label')}{userName}` |
| JSON strings | `{"{\"key\": \"value\"}"}` | Corrupted | Skip (non-translatable data) |
| Multiple expressions | `{emoji} {nonLatin}` | Labels only extracted | Preserve variables, extract labels |

### Root Causes

1. **Individual string extraction** - Each string literal in a JSX expression is extracted separately without considering the parent expression structure
2. **No concatenation awareness** - Binary expressions (`+`) with string operands are not merged
3. **No template literal handling** - Template literals with expressions (`${...}`) are not supported for interpolation
4. **Lost context** - When text is adjacent to dynamic expressions, the relationship is lost
5. **Overlapping edits** - Multiple edits in the same expression cause character offset corruption

## Implementation Phases

### Phase 1: Expression-Level Analysis (Foundation)
**Status: ✅ COMPLETED**

Implement expression-level analysis to understand the full context before transformation.

#### Tasks:
- [x] 1.1 Create `JsxExpressionAnalyzer` class to analyze entire JSX expressions
- [x] 1.2 Detect binary expressions with string concatenation
- [x] 1.3 Detect template literals with/without expressions
- [x] 1.4 Detect mixed text + variable patterns
- [x] 1.5 Add comprehensive unit tests for expression analysis (37 tests passing)

#### Test Cases:
```typescript
// Concatenation
{'Hello, ' + 'world!'}              // → Merge to single string
{'Count: ' + count}                 // → Static prefix + dynamic suffix
{prefix + ' middle ' + suffix}      // → Template pattern detected

// Template literals
{`Hello World`}                     // → Simple string extraction
{`Hello ${name}`}                   // → Interpolation pattern
{`${a} and ${b}`}                   // → Multiple interpolations

// Adjacent expressions
User: {userName}                    // → Text followed by expression
{count} items                       // → Expression followed by text
```

### Phase 2: Smart String Merging
**Status: ✅ COMPLETED**

Handle string concatenation at expression level rather than individual literals.

#### Tasks:
- [x] 2.1 Implement `StringConcatMerger` to merge adjacent string literals
- [x] 2.2 Support static concatenation: `'a' + 'b'` → `'ab'`
- [x] 2.3 Support partial static with dynamic suffix: `'Label: ' + value`
- [x] 2.4 Handle complex chains: `'a' + var + 'b' + var2`
- [x] 2.5 Add tests for all concatenation patterns (24 tests passing)

#### Transformation Strategies:
```typescript
// Pure static → merge and extract as single key
'Hello, ' + 'world!'  → t('hello_world')

// Static prefix + dynamic → extract prefix, preserve expression structure
'Count: ' + count     → {t('count_label')}{count}
                      // OR with interpolation support:
                      → {t('count', { count })}  // "Count: {count}"

// Complex mixed → analyze and decide
'Hello ' + name + '!' → {t('hello_name', { name })}  // "Hello {name}!"
```

### Phase 3: Template Literal Support
**Status: ✅ COMPLETED**

Properly handle template literals, including those with expressions.

#### Tasks:
- [x] 3.1 Detect `NoSubstitutionTemplateLiteral` (simple) vs `TemplateExpression` (with `${}`)
- [x] 3.2 Extract simple template literals as regular strings
- [x] 3.3 For template expressions, extract static parts and create interpolation keys
- [x] 3.4 Generate appropriate `t()` call with parameters object
- [x] 3.5 Add configuration option for interpolation format (ICU, i18next, Vue, printf)
- [x] 3.6 Add comprehensive test suite (31 tests passing)

#### Test Cases:
```typescript
// Simple template (no expressions)
{`Hello World`}  → {t('hello_world')}

// With single expression
{`Hello ${name}!`}  → {t('hello_name', { name })}  // locale: "Hello {name}!"

// With multiple expressions
{`${greeting}, ${name}!`}  → {t('greeting_name', { greeting, name })}

// With complex expressions
{`Count: ${items.length}`}  → {t('count', { count: items.length })}
```

### Phase 4: ReactAdapter Integration
**Status: ✅ COMPLETED**

Integrate the utility functions into ReactAdapter's scanning and transformation pipeline.

#### Tasks:
- [x] 4.1 Add imports for expression-analyzer, string-concat-merger, template-literal-handler
- [x] 4.2 Extend `ScanCandidate` interface with `interpolation` field
- [x] 4.3 Modify `scanJsxExpressions()` to analyze expressions as units
- [x] 4.4 Handle static concatenation → single merged candidate
- [x] 4.5 Handle mixed concatenation → candidate with interpolation info
- [x] 4.6 Handle template literals → candidate with proper extraction
- [x] 4.7 Skip non-translatable patterns (JSON, SQL, format specifiers)
- [x] 4.8 Skip pure dynamic expressions
- [x] 4.9 Track handled positions to avoid duplicate extractions
- [x] 4.10 Add comprehensive integration tests (13 tests passing)

#### Integration Points:
```typescript
// ReactAdapter.scanJsxExpressions()
// 1. Analyze expression type
const analysis = analyzeJsxExpression(innerExpression);

// 2. Handle concatenation
if (analysis.type === ExpressionType.StaticConcatenation) {
  const result = mergeStringConcatenation(innerExpression);
  // Create single candidate with mergedValue
}

// 3. Handle template literals
if (analysis.type === ExpressionType.TemplateWithExpressions) {
  const result = handleTemplateLiteral(innerExpression);
  // Create candidate with interpolation info
}
```

### Phase 5: Adjacent Text/Expression Handling
**Status: ✅ COMPLETED**

Handle patterns where static text is adjacent to dynamic JSX expressions.

#### Tasks:
- [x] 5.1 Analyze sibling nodes in JSX element children
- [x] 5.2 Identify text + expression patterns
- [x] 5.3 Determine extraction strategy (separate vs interpolated)
- [x] 5.4 Implement "label-only" mode vs "interpolation" mode
- [x] 5.5 Add configuration for preferred strategy
- [x] 5.6 Handle property access expressions (user.name → name)
- [x] 5.7 Handle array access expressions (items[0] → item)
- [x] 5.8 Detect complex expressions that can't be interpolated
- [x] 5.9 Detect nested elements that prevent interpolation
- [x] 5.10 Generate proper interpolation templates for i18next/ICU/Vue formats
- [x] 5.11 Add comprehensive test suite (32 tests passing)

#### Patterns:
```jsx
// Text before expression
<p>User name: {userName}</p>
  // Option A: {t('user_name_label')}{userName}  // Preserve variable
  // Option B: {t('user_name', { name: userName })}  // Interpolation

// Expression before text
<p>{count} items remaining</p>
  // Option A: {count}{t('items_remaining')}
  // Option B: {t('items_remaining', { count })}

// Multiple interleaved
<p>Hello {name}, you have {count} messages</p>
  // → {t('hello_messages', { name, count })}
```

### Phase 6: Non-Translatable Pattern Detection Enhancement
**Status: Partially Complete (covered by Phase 1 ExpressionAnalyzer)**

Improve detection of patterns that should NOT be extracted.

#### Tasks:
- [x] 6.1 Detect JSON-like strings (handled in expression-analyzer)
- [x] 6.2 Detect code-like content: SQL, regex, format specifiers
- [ ] 6.3 Detect data patterns: phone numbers, emails, URLs (when not user-facing labels)
- [ ] 6.4 Add configuration for pattern customization
- [ ] 6.5 Add tests for edge cases

#### Patterns to Skip:
```jsx
// JSON data strings
{"{\"key\": \"value\"}"}  // Skip

// SQL/Code patterns
{"SELECT * FROM users"}  // Skip
{/regex/}  // Skip
{"%s %d %f"}  // Skip (format specifiers)

// Data patterns (configurable)
{"+1 (555) 123-4567"}  // Skip (phone)
{"contact@email.com"}  // Skip (email)
{"https://url.com"}  // Skip (URL)
```

### Phase 7: Edit Collision Prevention
**Status: Not Started**

Prevent overlapping edits that cause corruption.

#### Tasks:
- [ ] 7.1 Implement `EditConflictDetector` to find overlapping ranges
- [ ] 7.2 Create hierarchical edit planning (parent expressions first)
- [ ] 7.3 Implement edit batching for complex expressions
- [ ] 7.4 Add validation for edit result integrity
- [ ] 7.5 Add rollback mechanism for failed transformations

### Phase 8: Vue Adapter Parity
**Status: Not Started**

Apply same improvements to Vue adapter.

#### Tasks:
- [ ] 7.1 Port expression analysis to Vue template handling
- [ ] 7.2 Support Vue-specific interpolation syntax `{{ }}`
- [ ] 7.3 Handle `v-bind` and `:attr` dynamic bindings
- [ ] 7.4 Support Vue i18n `$t()` interpolation format
- [ ] 7.5 Add Vue-specific tests

## Test-Driven Development Approach

### Test File Structure
```
packages/core/src/framework/
├── __tests__/
│   ├── expression-analysis.test.ts      # Phase 1
│   ├── string-concat-merger.test.ts     # Phase 2
│   ├── template-literal-handler.test.ts # Phase 3
│   ├── adjacent-text-handler.test.ts    # Phase 4
│   ├── non-translatable-detector.test.ts # Phase 5
│   └── edit-collision.test.ts           # Phase 6
├── utils/
│   ├── expression-analyzer.ts
│   ├── string-concat-merger.ts
│   ├── template-literal-handler.ts
│   ├── adjacent-text-handler.ts
│   └── edit-collision-detector.ts
```

### Test Categories

#### Unit Tests
- Individual utility functions
- Pattern detection algorithms
- String manipulation helpers

#### Integration Tests
- Full adapter scan → mutate flows
- Multi-file transformations
- Config variations

#### Snapshot Tests
- Complex component transformations
- Before/after comparisons

## Configuration Additions

```json
{
  "extraction": {
    "concatenationStrategy": "merge" | "separate",
    "interpolationFormat": "icu" | "i18next" | "vue-i18n",
    "handleTemplateLiterals": true,
    "adjacentTextStrategy": "interpolate" | "preserve-separate",
    "skipPatterns": {
      "json": true,
      "sql": true,
      "formatSpecifiers": true,
      "phoneNumbers": true,
      "emails": true,
      "urls": true
    }
  }
}
```

## Success Criteria

1. All identified issues from the transform preview are fixed
2. No corruption in transformed output
3. Dynamic variables are preserved appropriately
4. Non-translatable patterns are correctly skipped
5. Configuration allows customization of behavior
6. Both React and Vue adapters have feature parity
7. All tests pass with >90% coverage for new code

## Timeline Estimate

| Phase | Estimated Effort | Dependencies |
|-------|-----------------|--------------|
| Phase 1 | 4-6 hours | None |
| Phase 2 | 4-6 hours | Phase 1 |
| Phase 3 | 4-6 hours | Phase 1 |
| Phase 4 | 3-4 hours | Phase 1, 2 |
| Phase 5 | 2-3 hours | None |
| Phase 6 | 3-4 hours | Phase 1-4 |
| Phase 7 | 4-6 hours | Phase 1-6 |

**Total: ~24-35 hours**
