# Post-Testing Analysis 4: Root Cause Analysis & Prevention Plan

**Date:** 2025-11-28  
**Context:** Analysis of three external testing sessions to identify systemic issues preventing tool adoption.

## Executive Summary

After analyzing all three post-testing reports, the tool has fundamental **usability and reliability problems** that make it **unusable in real-world scenarios**:

1. **Data Loss**: Target locales being cleared (most critical)
2. **Incomplete Processing**: Files not being scanned/transformed
3. **Poor Key Quality**: Text-as-keys, verbose naming, value=key patterns
4. **Broken Workflows**: Module resolution failures, missing dependencies
5. **Confusing Defaults**: Behaviors that surprise users

The core issue is that the tool was built with **ideal scenarios in mind**, not real-world messy projects with:
- Pre-existing i18n setups (partial implementations)
- Dynamic/computed translation keys
- Nested JSON locale structures
- Mixed file patterns across framework conventions

---

## Critical Issue Categories

### Category A: Data Integrity Failures

| Issue | Report | Root Cause | Status |
|-------|--------|------------|--------|
| Target locale clearing | #3 | Syncer prunes keys not found in code; scanner misses files | ⚠️ Partially fixed |
| Value=key fallback | #1, #3 | Generator defaults to key as value when no source text | ⚠️ Partially fixed |
| Nested key namespace pruning | #2 | Syncer treats parent objects as unused when only children used | ⚠️ Needs verification |

**Prevention Strategy:**
1. **Never delete by default** - `--prune` must be explicit opt-in
2. **Backup before write** - Auto-create `.i18nsmith-backup/` with timestamp
3. **Dry-run first mandate** - `--write` without prior dry-run warns loudly

### Category B: Scanner Reliability

| Issue | Report | Root Cause | Status |
|-------|--------|------------|--------|
| Files not processed | #1, #3 | Include patterns don't match project structure | ✅ Fixed (P0.4) |
| Dynamic keys flagged as unused | #2, #3 | No way to whitelist computed keys | ✅ Fixed (dynamicKeyGlobs) |
| Template literals skipped | #3 | Scanner didn't handle backtick strings | ✅ Fixed |
| Property access calls missed | #3 | `obj.t()` patterns not detected | ✅ Fixed |

**Prevention Strategy:**
1. **Zero-match detection** - Warn if include patterns match 0 files (P0.3 ✅)
2. **File list preview** - Show matched files before processing
3. **Comprehensive call detection** - All `t()` variants including chained

### Category C: Developer Experience

| Issue | Report | Root Cause | Status |
|-------|--------|------------|--------|
| ESM module resolution failure | #2 | Missing `.js` extensions in imports | ✅ Fixed |
| Missing react-i18next dependency | #1 | Transform doesn't check for adapter deps | ⚠️ Warning added |
| Inconsistent CLI options | #2 | `--report` not on all commands | ✅ Fixed (P3.3) |
| Verbose/ugly generated keys | #1 | `common.auto.xxx.hash` format | ⚠️ Configurable but defaults unchanged |
| Confusing exit codes | #2 | Not documented, inconsistent | ⚠️ Docs incomplete |

**Prevention Strategy:**
1. **Pre-flight checks** - Verify dependencies, config, file access before processing
2. **Unified CLI interface** - All commands support `--json`, `--report`, `--verbose`
3. **Sensible key defaults** - Shorter, cleaner key generation

---

## Proposed Phase 7: Reliability & Safety

### 7.1. Safety Guards (P0)

#### 7.1.1. Backup Before Write
```typescript
// Before any --write operation:
// 1. Create .i18nsmith-backup/YYYY-MM-DD-HHmmss/
// 2. Copy all locale files that will be modified
// 3. Log backup location
// 4. Proceed with write
```

**Config:**
```json
{
  "safety": {
    "backupBeforeWrite": true,  // default: true
    "backupDir": ".i18nsmith-backup",
    "backupRetention": 5  // keep last 5 backups
  }
}
```

#### 7.1.2. Explicit Prune Mode
- Current: `sync --write` adds AND removes
- New: `sync --write` only adds; `sync --write --prune` removes

#### 7.1.3. Dry-Run Mandate
- If running `--write` for first time in session, print warning:
  ```
  ⚠️  This will modify files. Run without --write first to preview changes.
  Continue anyway? [y/N]
  ```
- Skip prompt with `--yes` flag

### 7.2. Pre-Flight Validation (P0)

#### 7.2.1. Config Validation
Before any operation, validate:
- [ ] Config file exists and is valid JSON
- [ ] `include` patterns match at least 1 file
- [ ] `localesDir` exists or can be created
- [ ] Write permissions on locale files (if `--write`)

#### 7.2.2. Dependency Check
For `transform` command:
- [ ] Check package.json for adapter dependency (react-i18next, vue-i18n, etc.)
- [ ] Warn if missing with install command

#### 7.2.3. Existing Setup Detection
Before `init` or first `transform`:
- [ ] Detect existing locale files and warn
- [ ] Detect existing i18n provider and suggest merge
- [ ] Show summary of detected setup

### 7.3. Key Quality Improvements (P1)

#### 7.3.1. Cleaner Default Key Format
- Current: `common.auto.filename.slug.abc123`
- New: `filename.slug` (fallback to `.abc12` only on collision)

#### 7.3.2. Text-as-Key Migration Command
```bash
i18nsmith migrate-keys --strategy=semantic
```
Bulk rename `"Save Changes"` → `"actions.saveChanges"` with:
- Automatic locale file updates
- Source file updates
- Collision detection

#### 7.3.3. Key Linting in CI
```bash
i18nsmith lint-keys --rules=no-spaces,has-namespace,max-length
```

### 7.4. Scanner Completeness (P1)

#### 7.4.1. Coverage Report
```bash
i18nsmith scan --coverage
```
Output:
```
Files matched:     289/312 (92%)
Files skipped:      23 (see --verbose)
Keys found:        1,245
Dynamic patterns:    47 (configure in dynamicKeyGlobs)
```

#### 7.4.2. Pattern Debugging
```bash
i18nsmith debug-patterns
```
Shows exactly which files match/don't match and why.

### 7.5. Error Recovery (P2)

#### 7.5.1. Rollback Command
```bash
i18nsmith rollback          # Restore from latest backup
i18nsmith rollback --list   # Show available backups
i18nsmith rollback 2025-11-28-143022  # Restore specific backup
```

#### 7.5.2. Diff Review Before Write
```bash
i18nsmith sync --write --interactive
```
Shows each change and asks for confirmation.

---

## Implementation Priority

### Immediate (Before Next External Test)

1. **7.1.2 Explicit Prune Mode** - Never delete without `--prune`
2. **7.2.1 Config Validation** - Fail fast on bad config
3. **7.1.3 Dry-Run Mandate** - Force preview before write

### Short-Term (1-2 days)

4. **7.1.1 Backup Before Write** - Automatic safety net
5. **7.2.2 Dependency Check** - Warn on missing adapter
6. **7.4.1 Coverage Report** - Help users verify scan completeness

### Medium-Term (3-5 days)

7. **7.3.1 Cleaner Key Format** - Improve generated key readability
8. **7.3.2 Text-as-Key Migration** - Bulk fix for legacy patterns
9. **7.5.1 Rollback Command** - Easy recovery from mistakes

---

## Success Criteria

The tool is "usable" when an external project test meets:

1. ✅ Zero data loss in target locales
2. ✅ All source files processed (or explicit skip reason)
3. ✅ Generated keys are readable without hash suffixes (where possible)
4. ✅ Clear error messages for every failure mode
5. ✅ Recovery path available for any mistake

---

## Appendix: Issue Cross-Reference

| Report | Issue | This Analysis Section |
|--------|-------|----------------------|
| #1 | JSON circular structure | Fixed (CLI) |
| #1 | Missing react-i18next | 7.2.2 |
| #1 | Verbose key names | 7.3.1 |
| #1 | Empty target files | 7.1.2 (prune control) |
| #2 | ESM resolution | Fixed |
| #2 | Inconsistent --report | Fixed (P3.3) |
| #2 | Config lookup | 7.2.1 |
| #2 | node_modules in diagnostics | Fixed (default excludes) |
| #2 | Dynamic key warnings | Fixed (dynamicKeyGlobs) |
| #2 | Nested key pruning | 7.1.2 |
| #3 | Text-as-key patterns | 7.3.2 |
| #3 | Target locale clearing | 7.1.1, 7.1.2 |
| #3 | Files not processed | 7.4.1 |
| #3 | Value=key fallback | 7.3.3 |
