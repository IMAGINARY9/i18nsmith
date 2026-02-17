# Dynamic Key Whitelist vs Pattern Detector Analysis

## Executive Summary

After analyzing both features, they serve **completely different purposes** and should **both be retained**:

| Feature | Purpose | Scope |
|---------|---------|-------|
| **Dynamic Key Whitelist** | Handle runtime-computed translation keys (e.g., `t(\`status.${code}\`)`) | Sync/reference extraction |
| **Pattern Detector** | Filter non-translatable text patterns (SQL, JSON, regex) | Text extraction/transform |

## Feature 1: Dynamic Key Whitelist

### Purpose
Handles **runtime/dynamic translation keys** - cases where the translation key itself is computed at runtime:

```tsx
// These cannot be statically analyzed
t(`errors.${errorCode}`);           // → dynamicKeyGlobs: ['errors.*']
t(item.localeKey);                   // → dynamicKeyAssumptions
t(`${prefix}.title`);                // → dynamicKeyGlobs
```

### How It Works
1. **Reference Extractor** detects dynamic keys during `sync` operation
2. Generates `DynamicKeyWarning` with reason: `'template' | 'binary' | 'expression'`
3. **Extension Quick Action** suggests patterns to whitelist
4. Patterns saved to `i18n.config.json`:

```json
{
  "dynamicKeys": {
    "assumptions": ["errors.validation.message"],
    "globs": ["status.*", "errors.*"]
  }
}
```

5. **Syncer** uses these to prevent false "unused key" warnings

### Files Involved
- `packages/core/src/reference-extractor.ts` - Generates warnings
- `packages/core/src/syncer.ts` - Uses `dynamicKeyAssumptions` and `dynamicKeyGlobs`
- `packages/vscode-extension/src/dynamic-key-whitelist.ts` - UI helpers
- `packages/vscode-extension/src/controllers/configuration-controller.ts` - Action handler

## Feature 2: Pattern Detector (Phase 6)

### Purpose
Filters **non-translatable text content** during extraction/transform:

```tsx
// These are NOT translation-worthy strings
const query = 'SELECT * FROM users';   // SQL
const pattern = /^[a-z]+$/;            // Regex
const data = '{"key": "value"}';       // JSON
const phone = '+1-555-0123';           // Phone number
const email = 'user@example.com';      // Email
```

### How It Works
1. **ExpressionAnalyzer** calls PatternDetector during text scanning
2. Categorizes patterns: `DataStructure | Code | Technical | DataValue | AlreadyI18n`
3. Skips extraction if confidence exceeds threshold
4. Returns non-translatable flag to scanner

### Files Involved
- `packages/core/src/framework/utils/pattern-detector.ts` - Pattern detection
- `packages/core/src/framework/utils/expression-analyzer.ts` - Integration point
- `packages/core/src/framework/ReactAdapter.ts` - Uses during scan

## Key Distinction

```
┌─────────────────────────────────────────────────────────────────┐
│                     i18n Workflow                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Source Code                                                    │
│       │                                                          │
│       ▼                                                          │
│   ┌─────────────────┐                                           │
│   │  Text Scanner   │──── Pattern Detector ────► Skip SQL, JSON │
│   │  (transform)    │     "Is this text translatable?"          │
│   └────────┬────────┘                                           │
│            │                                                     │
│            ▼ Creates t('key') calls                             │
│                                                                  │
│   ┌─────────────────┐                                           │
│   │ Reference       │──── Dynamic Key Whitelist                 │
│   │ Extractor       │     "Is t(dynamic) intentional?"          │
│   │ (sync)          │                                           │
│   └────────┬────────┘                                           │
│            │                                                     │
│            ▼                                                     │
│   ┌─────────────────┐                                           │
│   │ Syncer          │                                           │
│   │ (locale files)  │                                           │
│   └─────────────────┘                                           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Recommendation: Keep Both Features

### Reasons
1. **Different Workflow Stages**: Pattern Detector works during extraction, Whitelist works during sync
2. **Different Problems**: One filters text, other handles runtime key computation
3. **No Overlap**: They never compete for the same decision
4. **Both Needed**: Real projects use both dynamic keys AND need pattern filtering

### Action Items
- ✅ Keep Dynamic Key Whitelist feature as-is
- ✅ Keep Pattern Detector (Phase 6) as-is
- ✅ Ensure extension actions expose both properly
- ✅ Document the distinction in user docs

## Extension Actions Status

### Current Actions (verified working):
1. **"Resolve Dynamic Keys"** - `i18nsmith.whitelistDynamicKeys`
   - Shown when `dynamicWarningCount > 0` in sync report
   - Located in `quick-actions-data.ts` line 358

### New Improvements (Phase 6-8) Integration:
The new utilities (PatternDetector, EditConflictDetector, VueExpressionHandler) are integrated at the **core adapter level**, not as separate extension actions. They automatically improve:
- Scan accuracy (fewer false positives in extraction)
- Transform quality (cleaner edit generation)
- Preview fidelity (no file corruption)

No new extension actions needed - the improvements are transparent to users.

## Conclusion

The "Whitelist dynamic keys" feature is **still needed** and serves a **distinct purpose** from the Pattern Detector added in Phase 6. They work at different stages of the i18n workflow:

| Stage | Feature | User Interaction |
|-------|---------|------------------|
| **Extraction** | Pattern Detector | Automatic (no action) |
| **Sync** | Dynamic Key Whitelist | Quick Action menu |

Both should be retained. No deprecation or refactoring needed.
