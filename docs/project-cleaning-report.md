# Project Cleaning Report

This document identifies areas of code duplication, unused or potentially redundant code, overlapping features, and simplification opportunities across the i18nsmith monorepo.

---

## Table of Contents

1. [Code Duplication](#1-code-duplication)
2. [Unused or Redundant Code](#2-unused-or-redundant-code)
3. [Overlapping Features](#3-overlapping-features)
4. [Simplification Opportunities](#4-simplification-opportunities)
5. [Architecture Improvements](#5-architecture-improvements)
6. [Recommendations Priority Matrix](#6-recommendations-priority-matrix)

---

## 1. Code Duplication

### 1.1 Diff Utilities (Core vs CLI)

**Location:**
- `packages/core/src/diff-utils.ts` — Core diff building logic
- `packages/cli/src/utils/diff-utils.ts` — CLI-specific printing/writing

**Analysis:**

| Core (`diff-utils.ts`)      | CLI (`diff-utils.ts`)           |
|-----------------------------|----------------------------------|
| `buildLocaleDiffs()`        | `printLocaleDiffs()` — prints   |
| `buildLocalePreview()`      | `writeLocaleDiffPatches()` — writes .patch files |
| `createUnifiedDiff()`       | N/A                              |

**Issue:** The split is intentional (core is pure logic, CLI handles I/O), but there's room for confusion. The CLI file is only 41 lines and could be:
- Inlined into the 3 commands that use it (`sync.ts`, `check.ts`, `transform.ts`), or
- Kept as-is but documented as "CLI presentation layer"

**Recommendation:** ✅ Keep separate — this is a clean separation of concerns. Add a comment at the top of CLI's diff-utils explaining it's a presentation layer.

---

### 1.2 CLI Execution Pattern (Extension)

**Location:**
- `packages/vscode-extension/src/cli-utils.ts` — `resolveCliCommand()`, `quoteCliArg()`
- `packages/vscode-extension/src/cli-runner.ts` — `runResolvedCliCommand()`
- `packages/vscode-extension/src/services/cli-service.ts` — `CliService.runCliCommand()`

**Files using direct CLI execution:**
- `controllers/transform-controller.ts` — imports both `resolveCliCommand` and `runResolvedCliCommand` directly
- `preview-manager.ts` — imports both directly
- `scanner.ts` — imports both directly
- `services/cli-service.ts` — imports both, wraps in `CliService`

**Issue:** `TransformController`, `PreviewManager`, and `SmartScanner` duplicate the pattern that `CliService` encapsulates. They should use `CliService` instead of raw imports.

**Recommendation:** 🔴 HIGH PRIORITY — Refactor all CLI invocations to go through `CliService`. Benefits:
- Centralized logging, error handling, progress tracking
- Single place to modify CLI resolution logic
- Consistent output channel management

**Migration path:**
```typescript
// Before (in transform-controller.ts)
import { resolveCliCommand } from '../cli-utils';
import { runResolvedCliCommand } from '../cli-runner';
// ... 
const resolved = resolveCliCommand(rawCommand);
const result = await runResolvedCliCommand(resolved, { ... });

// After
// Use injected cliService
const result = await this.cliService.runCliCommand(rawCommand, { ... });
```

**Status (Dec 2025):** ✅ Completed. The extension now routes every CLI call (scanner, preview manager, sync/transform controllers, quick actions) through `CliService`, leaving `resolveCliCommand`/`runResolvedCliCommand` usage isolated within the service itself.

---

### 1.3 Config Loading

**Locations using `loadConfig` or `loadConfigWithMeta`:**

| File | Uses |
|------|------|
| `cli/commands/sync.ts` | `loadConfig`, `loadConfigWithMeta` |
| `cli/commands/scan.ts` | `loadConfigWithMeta` |
| `cli/commands/check.ts` | `loadConfigWithMeta` |
| `cli/commands/transform.ts` | `loadConfigWithMeta` |
| `cli/commands/audit.ts` | `loadConfig` |
| `cli/commands/diagnose.ts` | `loadConfig` |
| `cli/commands/debug-patterns.ts` | `loadConfigWithMeta` |
| `cli/commands/rename.ts` | `loadConfig` |
| `vscode-extension/scanner.ts` | `loadConfigWithMeta` |
| `vscode-extension/extraction-controller.ts` | Uses cached from scanner |
| `vscode-extension/hover.ts` | `loadConfigWithMeta` |
| `vscode-extension/sync-integration.ts` | `loadConfigWithMeta` |
| `vscode-extension/check-integration.ts` | `loadConfigWithMeta` |

**Issue:** 
- CLI: Each command loads config independently — this is correct for CLI commands
- Extension: Multiple services load config independently instead of sharing

**Recommendation:** 🟡 MEDIUM PRIORITY — For the extension, create a `ConfigurationService` that:
- Caches the loaded config per workspace
- Invalidates on file change (already have `watcher.ts`)
- Provides `getConfig()`, `getProjectRoot()`, `getConfigPath()`

The `SmartScanner` already partially does this but it's tightly coupled to scanning.

**Status (Dec 2025):** ✅ Completed. `ConfigurationService` now watches `i18n.config.json`, caches snapshots per workspace, emits change events, and all consumers (controllers, providers, helpers) access config exclusively through it.

---

## 2. Unused or Redundant Code

### 2.1 Potentially Underused CLI Commands

| Command | Purpose | Usage Concern |
|---------|---------|---------------|
| `audit` | Audit locale files for suspicious keys | Overlaps significantly with `sync --strict` and `check` |
| `diagnose` | Workspace diagnosis | One-time setup helper, rarely used after initial config |
| `debug-patterns` | Debug glob patterns | Developer debugging tool, could be hidden/internal |
| `preflight` | Pre-flight checks | May overlap with `check` command |
| `review` | Review translations | Usage unclear, possibly unused |
| `backup` | Backup management | Utility command, usage unclear |

**Commands actively used:**
- `sync` — Core workflow
- `transform` — Batch extraction
- `scan` — String detection
- `check` — CI validation
- `init` — Project setup
- `rename-key` / `rename-keys` — Key renaming

**Recommendation:** 🟡 MEDIUM PRIORITY — Audit command usage:
1. Add telemetry/logging to understand which commands are used
2. Consider deprecating or consolidating:
   - `audit` → integrate into `check --audit-keys` flag
   - `preflight` → integrate into `check --preflight` flag
   - `debug-patterns` → make it a `--debug` flag on other commands

---

### 2.2 Unused CLI Options

**Sync command has 25+ options:**
```
--json, --report, --write, --prune, --no-backup, --yes, --check, --strict,
--validate-interpolations, --no-empty-values, --assume, --assume-globs,
--interactive, --diff, --patch-dir, --invalidate-cache, --target, --include,
--exclude, --auto-rename-suspicious, --rename-map-file, --naming-convention,
--rewrite-shape, --shape-delimiter, --seed-target-locales, --seed-value,
--preview-output, --selection-file, --apply-preview
```

**Potential consolidation:**
- `--check` vs `--strict` — Could be unified (strict = check + suspicious key warnings)
- `--diff` vs `--patch-dir` — Similar purpose, different output
- `--assume` vs `--assume-globs` — Could be a single option with smart detection

**Recommendation:** 🟢 LOW PRIORITY — Document all options clearly. Consider adding option groups in help text.

**Status (Dec 2025):** ✅ Completed. `sync` now appends grouped help text (examples plus option clusters for workflow, safety, targeting, output, automation, and seeding flags) so operators can scan the CLI usage more easily.

---

### 2.3 Core Exports Analysis

`packages/core/src/index.ts` re-exports everything from 20 modules. Some exports may be internal-only:

| Module | Public API | Possibly Internal |
|--------|-----------|-------------------|
| `config.js` | `loadConfig`, `loadConfigWithMeta` | Config types |
| `scanner.js` | `Scanner`, `ScanCandidate` | Internal helpers |
| `key-generator.js` | `KeyGenerator` | Implementation details |
| `key-validator.js` | `KeyValidator`, `normalizeToKey` | `createKeyValidator` (redundant) |
| `locale-store.js` | `LocaleStore` | `LocaleFileStats` (internal) |
| `syncer.js` | `Syncer`, `SyncSummary` | Many re-exports from sub-modules |
| `diff-utils.js` | `buildLocaleDiffs`, `LocaleDiffEntry` | OK |
| `diagnostics.js` | `diagnoseWorkspace` | OK |
| `check-runner.js` | `CheckRunner` | OK |
| `gitignore.js` | `ensureGitignore` | May be CLI-only concern |

**Recommendation:** 🟢 LOW PRIORITY — Consider splitting into:
- `@i18nsmith/core` — Public API
- `@i18nsmith/core/internal` — Implementation details for CLI/extension

---

## 3. Overlapping Features

### 3.1 Key Renaming: `rename-key` vs `sync --auto-rename-suspicious`

**`rename-key` command:**
- Renames a single key across source files and locale JSON
- Used for intentional, explicit key renaming

**`sync --auto-rename-suspicious`:**
- Proposes normalized names for suspicious keys (whitespace, special chars)
- Batch operation, generates rename map file

**Overlap:**
- Both use `KeyRenamer` class internally
- Both modify source files and locale JSON

**Issue:** The features serve different purposes but share code. The confusion is:
- When should users use `rename-key` vs `sync --auto-rename-suspicious`?
- Can they be combined?

**Recommendation:** ✅ Keep separate but clarify:
- `rename-key` — Explicit, intentional rename (user chooses old/new)
- `sync --auto-rename-suspicious` — Automated normalization (tool suggests)
- Add clear documentation distinguishing the use cases

---

### 3.2 `check` vs `sync --check` vs `audit`

| Feature | `check` | `sync --check` | `audit` |
|---------|---------|----------------|---------|
| Missing keys | ✅ | ✅ | ❌ |
| Unused keys | ✅ | ✅ | ❌ |
| Suspicious keys | ✅ | ✅ (with --strict) | ✅ |
| Interpolation validation | ✅ | ✅ | ❌ |
| Quality issues | ❌ | ❌ | ✅ (duplicates, inconsistent) |
| Exit codes | ✅ | ✅ | ✅ (with --strict) |

**Issue:** Three commands with overlapping functionality for CI validation.

**Recommendation:** 🔴 HIGH PRIORITY — Consolidate:
1. Make `check` the canonical CI command
2. Add `check --audit` flag for quality issues currently in `audit`
3. `sync --check` becomes an alias for `check`
4. Deprecate standalone `audit` command over time

**Status (Dec 2025):** ✅ Completed. `sync --check` delegates to `check`, and the legacy `audit` command now proxies to `check --audit` (which also supports `--audit-locales`, `--audit-duplicates|--audit-inconsistent|--audit-orphaned` for feature parity). Users get one path plus stricter exit handling via `--audit-strict`.

---

### 3.3 `scan` vs `transform` Initial Analysis

Both commands analyze source files for translatable strings:
- `scan` — Finds candidates, reports them
- `transform` — Finds candidates, replaces them

**Issue:** `transform` essentially includes `scan` functionality but adds transformation.

**Recommendation:** ✅ Keep separate — different use cases:
- `scan` — Analysis/reporting without changes
- `transform` — Actual extraction workflow

---

## 4. Simplification Opportunities

### 4.1 Extension Controllers Consolidation

**Current structure:**
```
controllers/
├── configuration-controller.ts  — Dynamic whitelist management
├── extraction-controller.ts     — Single key extraction (code action)
├── sync-controller.ts           — Sync/rename operations
└── transform-controller.ts      — Batch extraction
```

**Issue:** `SyncController` and `TransformController` both:
- Build CLI commands with `quoteCliArg`
- Run preview/apply flows
- Parse CLI output
- Show diffs in output channel

**Recommendation:** 🟡 MEDIUM PRIORITY — Extract shared logic:
1. Create `PreviewApplyController` base class or mixin
2. Share command building, output parsing, diff display
3. Controllers focus on their specific UI/UX

**Status (Dec 2025):** ✅ Completed. A new `PreviewApplyController` now wraps preview execution and apply flows, and both `sync-controller.ts` and `transform-controller.ts` extend it so they share progress notifications, CLI invocation, diff preview wiring, and post-apply refresh logic.

---

### 4.2 Preview/Apply Flow Standardization

**Current implementation spans:**
- `preview-manager.ts` — Manages preview temp files
- `preview-intents.ts` — Intent tracking
- `preview-flow.ts` — Flow orchestration
- CLI `utils/preview.ts` — File read/write/apply

**Issue:** Complex multi-file implementation for a conceptually simple flow.

**Recommendation:** 🟡 MEDIUM PRIORITY — Document the architecture clearly (done in `docs/quick-actions-flows.md`) and consider:
1. Moving more logic to `PreviewManager`
2. Reducing state spread across files

**Status (Dec 2025):** ✅ Completed. Preview/apply orchestration now lives in `PreviewPlanService` (instantiated via the service container) plus the new `PreviewApplyController` base class, so sync/transform controllers rely on the same helper for preview execution, plan rendering, and apply commands instead of juggling `preview-manager.ts`, `preview-flow.ts`, and ad-hoc logic in multiple places.

---

### 4.3 Output Channel Management

**Current state:**
- Multiple output channels created (`i18nsmith`, verbose logging)
- `CliService` manages one channel
- Controllers create their own channels

**Recommendation:** 🟢 LOW PRIORITY — Centralize output channel creation in a single service.

**Status (Dec 2025):** ✅ Completed. The VS Code extension now registers a dedicated `OutputChannelService` inside `service-container.ts`, wiring controllers, the CLI integration, and `SmartScanner` to the same primary/CLI/verbose channels so no component creates channels ad hoc.

---

## 5. Architecture Improvements

### 5.1 Dependency Injection

**Current state:** 
- `container.ts` exists but is a simple object holder
- Controllers receive dependencies via constructor but not consistently

**Recommendation:** 🟢 LOW PRIORITY — Consider a lightweight DI container (like `tsyringe`) for:
- Easier testing (mock injection)
- Clearer dependency graph
- Lifecycle management

---

### 5.2 Error Handling Standardization

**Current state:**
- CLI commands have inconsistent error handling
- Some use `process.exitCode`, some throw, some just log

**Recommendation:** 🟡 MEDIUM PRIORITY — Create standard error handling:
```typescript
// packages/cli/src/utils/errors.ts
export class CliError extends Error {
  constructor(message: string, public exitCode: number = 1) {
    super(message);
  }
}

// Wrapper for all command actions
export function withErrorHandling(action: (...args: any[]) => Promise<void>) {
  return async (...args: any[]) => {
    try {
      await action(...args);
    } catch (error) {
      if (error instanceof CliError) {
        console.error(chalk.red(error.message));
        process.exitCode = error.exitCode;
      } else {
        throw error;
      }
    }
  };
}
```

**Status (Dec 2025):** ✅ Completed. `CliError` plus `withErrorHandling` now live under `packages/cli/src/utils/errors.ts`, and every CLI command (check, sync, audit, backup, diagnose, config, debug-patterns, install-hooks, preflight, rename, review, scaffold-adapter, scan, transform, translate, init, etc.) registers via the shared wrapper for consistent logging and exit codes.

---

### 5.3 Test Coverage Gaps

**Areas with limited tests:**
- `packages/vscode-extension/src/controllers/*` — Controller tests missing
- `packages/cli/src/commands/audit.ts` — No dedicated test file
- `packages/cli/src/commands/backup.ts` — No dedicated test file
- `packages/cli/src/commands/diagnose.ts` — No dedicated test file
- Integration between extension and CLI

**Recommendation:** 🟡 MEDIUM PRIORITY — Add integration tests for:
1. Extension quick actions end-to-end
2. CLI command interactions (e.g., sync → transform → sync)
3. Preview/apply flow with various edge cases

---

## 6. Recommendations Priority Matrix

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| 🔴 HIGH | ~~Consolidate CLI execution through `CliService`~~ **✅ (Dec 2025)** | Medium | High — Reduces bugs, centralizes logic |
| 🔴 HIGH | ~~Unify `check`/`sync --check`/`audit`~~ **✅ (Dec 2025)** | Medium | High — Clearer user experience |
| 🟡 MEDIUM | ~~Create `ConfigurationService` for extension~~ **✅ (Dec 2025)** | Low | Medium — Reduces redundant loads |
| 🟡 MEDIUM | Extract shared controller logic | Medium | Medium — Cleaner architecture |
| 🟡 MEDIUM | Standardize error handling | Low | Medium — Better UX |
| 🟡 MEDIUM | Add controller/integration tests | High | High — Reliability |
| 🟢 LOW | Document CLI options groups | Low | Low — Better docs |
| 🟢 LOW | Split core public/internal exports | Medium | Low — API clarity |
| 🟢 LOW | Centralize output channels | Low | Low — Cleaner code |

---

## Summary

The codebase is well-structured but has grown organically, leading to:

1. **Duplication in CLI execution** — Multiple files import and use the same CLI patterns instead of going through `CliService`
2. **Overlapping CLI commands** — `check`, `sync --check`, and `audit` serve similar purposes
3. **Config loading spread** — ✅ Addressed via `ConfigurationService`

**Quick wins:**
1. Route all extension CLI calls through `CliService` — ✅ completed
2. Add `--audit` flag to `check` command and deprecate standalone `audit` — ✅ completed (legacy command now proxies)
3. Create `ConfigurationService` wrapper for cached config access — ✅ completed

**Longer-term improvements:**
1. Standardize error handling across CLI
2. Add integration tests for quick actions
3. Consider DI for extension services
