# Post-Testing Analysis: External Session 2 (Next.js Real-World Project)

**Date:** 2025-11-26
**Context:** Integration testing against `bilinmenu` (Next.js 15.4.4, Node 22, pnpm 10).

## Executive Summary
The CLI was successfully integrated into a real-world Next.js monorepo, but several critical reliability and usability issues were identified. The most severe issue was broken ESM module resolution in the built CLI, which prevented execution until manually patched. Other feedback highlights inconsistencies in CLI arguments (`--report`), noise in diagnostics, and the need for better handling of dynamic keys and nested JSON structures.

## Critical Issues (Bugs)

### 1. ESM Module Resolution Failure
- **Severity:** Critical (Blocker)
- **Symptom:** `ERR_MODULE_NOT_FOUND` when running the built CLI (`dist/index.js`).
- **Cause:** The TypeScript build output targets ESM (`"type": "module"`) but source files use extension-less relative imports (e.g., `import './commands/init'`). Node.js ESM requires explicit `.js` extensions for relative imports.
- **Fix:**
  - Update all relative imports in `packages/cli/src` to include `.js` extensions (or use a bundler like `tsup` to handle resolution).
  - Enforce this via ESLint (`import/extensions` rule).

### 2. Inconsistent CLI Options
- **Severity:** Moderate
- **Symptom:** `i18nsmith sync` does not support `--report`, unlike `diagnose` and `check`.
- **Impact:** Inconsistent CI integration; users cannot easily persist sync results.
- **Fix:** Add `--report <path>` to `sync`, `transform`, and `rename-key` commands.

### 3. Config Lookup Assumptions
- **Severity:** Minor (DX)
- **Symptom:** Commands fail if run from a subdirectory because they default to `process.cwd()/i18n.config.json`.
- **Fix:** Implement upward directory traversal to find the config file, or improve the error message to suggest `-c`.

## Usability & Heuristics Improvements

### 4. Diagnostics Noise
- **Issue:** `diagnose` reports internal Next.js providers in `node_modules` as candidates.
- **Fix:** Update default `providerGlobs` to exclude `node_modules` and focus on `src/` or `app/`.

### 5. Dynamic Key Handling
- **Issue:** Many warnings for template literals (e.g., `` `service.orderStatuses.${status}` ``) without clear resolution steps.
- **Fix:**
  - Improve warning output to suggest `sync.dynamicKeyAssumptions`.
  - Consider a command to "snapshot" current dynamic warnings into the config as assumptions.

### 6. Nested Key Pruning Safety
- **Issue:** The report notes "Unused top-level namespace/group keys" (e.g., `auth`, `account`) being flagged for removal.
- **Analysis:** If `auth.login` is used but `auth` is flagged as unused, it implies the syncer might be treating the top-level key as a value key, or the user usage is `t('auth')` (which is rare).
- **Action:** Verify `Syncer` logic handles nested JSON objects correctly—it should not prune a parent key if *any* child key is used.

### 7. Missing `relativeTime` Keys
- **Issue:** `relativeTime.*` keys reported missing but not auto-seeded.
- **Fix:** Investigate if these are standard Intl keys or app-specific. If app-specific, they should be seeded if `seedTargetLocales` is true.

## Documentation & Process

### 8. Exit Codes & CI
- **Action:** Consolidate exit code documentation for all commands in README.
- **Action:** Document `--patch-dir` for `sync` dry-runs.

### 9. Testing
- **Action:** Add integration tests running the *built* CLI in a Node ESM environment to catch resolution issues.

## Implementation Plan Updates
The following tasks will be added to the implementation plan:
- **Fix:** ESM import extensions in CLI.
- **Feat:** Add `--report` to `sync` and `transform`.
- **Feat:** Upward config lookup.
- **Refactor:** Exclude `node_modules` from provider scan.
- **Docs:** Exit codes and patch workflows.
