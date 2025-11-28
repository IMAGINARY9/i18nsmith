# Implementation Plan: i18nsmith

**Project Name:** `i18nsmith`
**Goal:** Zero-friction internationalization for modern web frameworks.

## Phase 1: Foundation & Scanner (Completed)
**Objective:** Build the core CLI that can parse code and identify translatable strings without modifying files.

### 1.1. Repository Setup
*   **Stack:** TypeScript, Node.js (latest LTS).
*   **Monorepo:** `pnpm` workspaces to separate packages.
*   **Packages:** `@i18nsmith/core`, `@i18nsmith/cli`, `@i18nsmith/transformer`, `@i18nsmith/translation`.
*   **Testing:** `vitest` for unit tests.

### 1.2. Configuration Engine
*   `init` command created to generate `i18n.config.json`.
*   **Config Options:** `sourceLanguage`, `targetLanguages`, `localesDir`, `include`, `exclude`, `translation`.

**Progress notes (2025-11-23):**
- ✅ `init` command implemented in `packages/cli/src/commands/init.ts` and writes `i18n.config.json`.
- ✅ Config normalization and loader added at `packages/cli/src/utils/config.ts` (supports string/array inputs, sensible defaults, helpful errors).


### 1.3. AST Scanner (The "Reader")
*   **Library:** `ts-morph`.
*   **Logic:** A `Scanner` class in `@i18nsmith/core` is responsible for traversing the AST.
*   **Output:** A structured list of "Candidates" to be processed by the transformer.

**Progress notes (2025-11-23):**
- ✅ `Scanner` implemented in `packages/core/src/scanner.ts` using `ts-morph`.
  - Captures JSX text, common translatable JSX attributes (e.g., `placeholder`, `label`, `alt`), and string literals inside JSX expressions.
  - Produces `ScanSummary` with `ScanCandidate[]` entries that include file, position, normalized text, and context.
- ✅ CLI `scan` command wired to the scanner in `packages/cli/src/index.ts` and supports `--json` output and `--config` override.

Run notes:
- Build and run the CLI to scan a project:
  - `pnpm --filter @i18nsmith/cli build`
  - `node packages/cli/dist/index.js scan --json`

These Phase 1 artifacts provide the extraction pipeline required for Phase 2 (key generation + transformer).

## Phase 2: The Transformer (Weeks 5-8)
**Objective:** Safely modify source code to inject i18n keys.

### 2.0. Architecture Snapshot
*   **Packages working together**
  *   `@i18nsmith/core`: still responsible for scanning + shared models. Gains a `KeyGenerator` contract and locale JSON helpers so Phase 3 can reuse them.
  *   `@i18nsmith/transformer`: consumes scanner output, asks the key generator for IDs, mutates the AST, and flushes locale JSON updates.
  *   `@i18nsmith/cli`: orchestrates end-to-end (scan → transform) and handles interactive prompts / dry runs.
*   **Primary data flow**
  1.  `Scanner.scan()` → `ScanSummary`.
  2.  `KeyGenerator.generate(text, ctx)` returns `{ key, hash }` for stable deduplication.
  3.  Transformer maps `ScanCandidate` → `TransformCandidate` (text + key + file + kind).
  4.  Transformer rewrites files via `ts-morph`, persists updated locale JSON through a deterministic `LocaleStore`, and hands back a `TransformSummary` (changed files, new keys, skipped items).

### 2.1. Key Generation
*   **Strategy:** Deterministic hash of normalized text + optional component context, yielding predictable keys.
*   **Implementation:** Create a reusable `KeyGenerator` in `@i18nsmith/core` so both scanner (for previews) and transformer can agree on keys.
*   **Contract:**
  ```ts
  interface KeyGenerationContext {
    filePath: string;
    kind: CandidateKind;
    context?: string;
  }
  interface GeneratedKey { key: string; hash: string; preview: string; }
  interface KeyGenerator {
    generate(text: string, ctx: KeyGenerationContext): GeneratedKey;
  }
  ```
*   **Collision handling:** keep a per-run map `<hash -> key>`; if a duplicate text appears, reuse the existing key and mark the candidate as deduplicated.

### 2.2. Locale Store (JSON manager pulled forward)
*   Build a helper inside `@i18nsmith/core` (reused by Phase 3) to load/update `<localesDir>/<locale>.json` with sorted keys.
*   Responsibilities: lazy loading, ensuring files exist, deterministic ordering, and tracking `{ added: string[]; existing: string[] }` for reports.

### 2.3. Candidate Enrichment
*   Extend `ScanCandidate` downstream with `suggestedKey`, `hash`, and `status`.
  ```ts
  type CandidateStatus = 'pending' | 'duplicate' | 'existing';
  interface TransformCandidate extends ScanCandidate {
    suggestedKey: string;
    hash: string;
    status: CandidateStatus;
  }
  ```
*   Enrichment steps:
  1.  Run `KeyGenerator.generate` per candidate.
  2.  Check `LocaleStore` for an existing translation; mark as `existing` and skip mutation.
  3.  Otherwise leave as `pending` so the transformer replaces text + inserts locale entries.

### 2.4. AST Transformer (The "Writer")
*   **Import Injection:** Ensure `import { useTranslation } from 'react-i18next';` (configurable later). Provide a small adapter interface for future frameworks.
*   **Hook Injection:** Locate the closest function component body and insert `const { t } = useTranslation();` if missing.
*   **Text Replacement:**
  *   `<div>Hello</div>` → `<div>{t('auto.abc123')}</div>`.
  *   `placeholder="Name"` → `placeholder={t('auto.def456'}`.
*   **Safety rails:** dry-run mode, skip files with syntax errors, and surface conflicts in the summary.
*   **Formatting:** Run `prettier` (when available) after writes; fall back to `ts-morph` printer.

### 2.5. CLI Workflow
*   New command: `i18nsmith transform [--write] [--config path] [--json]`.
*   Default run performs dry-run (prints plan). `--write` applies file edits + locale updates.
*   Output summarises: files rewritten, keys added, duplicates skipped, locale files touched. Future enhancement: prompt per candidate/file.

**Progress notes (2025-11-23 → 2025-11-24):**
- ✅ Reusable `KeyGenerator` now produces slug+hash keys for auditability.
- ✅ `LocaleStore` introduced with atomic writes and placeholder seeding across locales.
- ✅ `@i18nsmith/transformer` package implements React writer, plus vitest coverage.
- ✅ CLI `transform` command (dry-run by default, `--write` to apply) wired end-to-end.
- ✅ Added `--check` mode to `transform` for CI failure on pending changes.
- ✅ Added `translationAdapter` config (react-i18next or custom hook) and scaffolding.
- ✅ Implemented `scaffold-adapter` flows: zero-deps context & react-i18next runtime (i18n initializer + provider) to eliminate `NO_I18NEXT_INSTANCE`.
- ✅ Integrated runtime scaffolding into `init` (automatic prompts + dependency warnings).

### 2.A. Multi-Framework Transformer Architecture (Add-on)
**Problem:** The current transformer is tightly coupled to React/`useTranslation` semantics. Even though adapters can change import names, the AST manipulation logic (hook injection, JSX rewrites) cannot be reused for Vue, Solid, Astro, or plain TypeScript modules. This creates a hard ceiling on adoption.

**Goals:**
- Introduce an explicit `Writer` abstraction so framework-specific logic lives in pluggable classes (e.g., `ReactWriter`, `VueWriter`, `SolidWriter`).
- Move hook/component detection, stateful memoization, and import management behind a common interface so future frameworks can be onboarded without forking the transformer.
- Expose adapter metadata in `i18n.config.json` (`translationAdapter.kind`) to select the correct writer at runtime and guide CLI scaffolding.

**Scope & Deliverables:**
1. Refactor `packages/transformer/src/transformer.ts` to delegate AST edits to a `Writer` interface:
   ```ts
   interface Writer {
     ensureImports(file: SourceFile): void;
     ensureBinding(node: Node): WriterContext | null;
     replaceNode(candidate: TransformCandidate, ctx: WriterContext): void;
   }
   ```
2. Implement `ReactWriter` using existing logic but remove hard-coded hook names (pull from adapter config).
3. Provide a `NoopWriter` that simply records candidates without editing files—useful for dry-runs or unsupported frameworks.
4. Update CLI `transform` command to fail fast with an actionable message when no writer supports the chosen adapter (e.g., “Vue writer coming in Phase 4—run `i18nsmith transform --preview` for now”).
5. Document the architecture in `ARCHITECTURE.md` so contributors can add writers for other frameworks.

**Milestones:**
- Week 1: Introduce abstraction, migrate React logic, add tests for writer selection.
- Week 2: Publish contributor guide + create tracking issues for Vue/Solid writers.

**Risks & Mitigations:**
- *Risk:* Regression in existing React behavior during refactor. → Mitigate with snapshot tests covering JSX text/attribute/expression replacements and hook injection cases.
- *Risk:* Explosion of adapter configuration surface area. → Keep schema minimal (`kind`, `module`, `hookName`) until subsequent phases.

## Phase 3: State Management & Sync (Weeks 9-10)
**Objective:** Handle updates, deletions, and synchronization between code and JSON locale files.

### 3.1. JSON Manager
*   Create a utility in `@i18nsmith/core` to read/write locale files.
*   Ensure deterministic key sorting to prevent unnecessary git diffs.

**Progress notes (2025-11-24):**
- ✅ LocaleStore now tracks removals alongside additions/updates and exposes a `remove` helper for sync workflows.
- ✅ `Syncer` introduced in `@i18nsmith/core` to analyze translation hook usage versus locale JSON.
- ✅ `i18nsmith sync` CLI command (dry-run by default, `--write` to fix) reports missing keys, prunes unused entries, and rewrites locale files atomically.

### 3.2. Drift Detection (The "Syncer")
*   **Unused Keys:** Implement logic to report keys in `en.json` that are no longer found in the AST.
*   **Missing Keys:** Report `t('new_key')` calls in code that are missing from `en.json`.
*   **Sync Command:** Create an `i18nsmith sync` command to auto-fix these issues (prune unused, add missing placeholders).

**Progress notes (2025-11-24):**
- ✅ `sync` command now includes `--check` for CI enforcement plus JSON/dry-run previews of pending locale mutations.
- ✅ `Syncer` respects configurable translation identifiers (`sync.translationIdentifier`) and surfaces locale diff previews even when running without `--write`.
- ✅ Auto-fixes add placeholders for missing keys (including seeded targets) and prune unused entries across all locales in one pass.

### 3.3. Backlog / Follow-ups (merged from v2/v3)
* Auto-detect provider/layout files (e.g. Next.js `app/providers.tsx`) and optionally inject generated `I18nProvider`.
* Offer `--install-deps` flag to auto-install `react-i18next` & `i18next` when scaffolding runtime.
* Expose key rename workflow (map old keys to new; update code + locale JSON).
* Dry-run diff summary for locale JSON (added / updated / unchanged counts before write).

**Progress notes (2025-11-24):**
- ✅ `scaffold-adapter --type react-i18next` now detects standard Next.js provider files and injects `<I18nProvider>` automatically when safe; otherwise, it logs actionable guidance.
- ✅ Added `--install-deps` flag (with package-manager auto-detection) to provision `react-i18next` / `i18next` while scaffolding.
- ✅ Introduced `i18nsmith rename-key` powered by a reusable `KeyRenamer` to update code + locale JSON with dry-run previews.
- ✅ `sync` dry-runs now output per-locale add/remove previews before writing.
- ✅ Added `i18nsmith rename-keys --map` for atomic batch renames. Supports JSON map files, consolidated previews, duplicate detection, and shared diff summaries across all locales/files.

### 3.4. Interpolation & Placeholder Validation
* Objective: Detect and report mismatches in interpolation placeholders between the source locale and target locales.
* Checks:
  - Ensure placeholders (e.g., `{{name}}`, `%s`) used in the source string are present in each target translation.
  - Report missing/extra placeholders per-locale with file/key references.
* CLI: `i18nsmith sync --validate-interpolations` (dry-run by default; `--write` will not alter translations but can flag for CI failure with `--check`).
* Acceptance criteria: Tool catches simple interpolation mismatches and produces a machine-friendly JSON output for CI.

### 3.5. Empty / Placeholder Value Detection
* Objective: Treat empty strings or near-empty translations as missing during checks.
* Checks:
  - Flag target locale entries that are `""`, `null`, or contain only whitespace / TODO markers.
  - Optional severity: warn vs fail. Controlled via `i18n.config.json` (e.g., `sync.emptyValuePolicy: 'warn'|'fail'`).
* CLI: `i18nsmith sync --no-empty-values` to treat empty values as drift (useful for CI).
* Acceptance criteria: Empty translations are visible in diffs and can break CI when policy is set to `fail`.

### 3.6. Dynamic Key Handling & Best‑Effort Warnings
* Objective: Improve handling and feedback for dynamic key usage which cannot be statically resolved.
* Behavior:
  - Detect template-literal or concatenated keys (e.g., ``t(`errors.${code}`)``) and emit a concise warning with file/line.
  - Provide an optional `--assume` flag that accepts a small list of runtime keys (e.g., `--assume errors.404,errors.500`) to treat as present.
* Acceptance criteria: Developers are informed where keys cannot be tracked and can supply explicit lists for CI.

### 3.7. Batch Rename & Merge Workflows
* Objective: Support bulk/complex refactors and safe merges across locales.
* Features:
  - `i18nsmith rename-keys --map map.json` to run many renames atomically.
  - Interactive conflict resolution where destination keys already exist: options to merge, skip, or overwrite.
  - Optional `--strategy merge` that detects identical values and removes duplicates automatically.
* Acceptance criteria: Bulk renames complete without corrupting locale files and provide a preview of changes.

### 3.8. Interactive Sync Mode
* Objective: Let maintainers review and accept/reject each pending locale change.
* Behavior:
  - `i18nsmith sync --interactive` prompts for each missing/unused key with a short context (file+line+preview) and options: Add / Skip / Postpone / Edit manually.
  - Useful for small teams that want tight control during cleanup.
* Acceptance criteria: Interactive flow is non-destructive unless `--confirm` is given and respects git workflows.

**Progress notes (2025-11-24):**
- ✅ `sync --interactive` now runs an automatic dry-run, displays the standard drift summary, then launches checkbox prompts so you can pick which missing and unused keys to apply. Selected keys feed back into the Syncer via `selection` filters, so only approved additions/removals are written after a final confirmation step. The flow honors placeholder/empty/dynamic validation flags and refuses to combine with `--json` output to keep prompts clean.

### 3.9. Rich Dry‑Run Diffs & Per‑File Locale Patches
* Objective: Produce compact, git-style diffs for locale files during dry-runs.
* Features:
  - `i18nsmith sync --diff` prints a unified diff for each locale file that would change (or emits JSON with `added`, `updated`, `removed` lists).
  - Optionally write `.patch` files for review or apply via `git apply`.
  - CLI flags: `--diff` prints unified diffs to the console; `--patch-dir <dir>` writes per-locale `.patch` files suitable for `git apply` or CI artifact collection.
  - Add automated tests that validate both behaviors: JSON/diff-injection in `--json` output and creation of `.patch` files when `--patch-dir` is used.
* Acceptance criteria: Diff output is easy to review in PRs and can be stored as artifacts in CI.

### 3.10. Performance & Incremental Scanning
* Objective: Make repeated runs fast for large codebases.
* Features:
  - Implement a simple file-based cache keyed by file mtime / checksum to skip re-parsing unchanged files.
  - Provide `--invalidate-cache` when structural changes occur (e.g., change in `include` globs).
* Acceptance criteria: Re-run times drop substantially on large repos; cache correctness validated by end-to-end tests.

**Progress notes (2025-11-25):**
- ✅ `Syncer` now maintains a per-file reference cache under `.i18nsmith/cache/sync-references.json`, keyed by file size/mtime so unchanged files skip AST parsing on subsequent runs.
- ✅ `i18nsmith sync --invalidate-cache` forces a cold scan when include globs or branch changes invalidate the cache; interactive runs honor the flag for their dry-run stage.
- ✅ New core tests verify cache creation, reuse (no `addSourceFileAtPath` calls on warm runs), and invalidation behavior.

### 3.11. Provider Injection Robustness
* Objective: Replace string-probing heuristics with AST-aware injection for framework provider files.
* Features:
  - Use `ts-morph` to parse candidate provider/layout files and reliably wrap root children with `I18nProvider` without brittle string replacements.
  - Provide a `--dry-run` preview of injection changes and explicit fallback instructions when it cannot safely transform the file.
* Acceptance criteria: Provider injection succeeds in canonical Next.js layouts and refuses to edit ambiguous constructs.

**Progress notes (2025-11-26):**
- ✅ Added a dedicated `provider-injector` utility that loads candidate Next.js provider files with `ts-morph`, confirms exactly one `{children}` slot exists, injects an `I18nProvider` import, and wraps the JSX expression without string replacements.
- ✅ `i18nsmith scaffold-adapter --type react-i18next` now exposes `--dry-run` to print the unified diff of the provider changes and bail without editing when you only want a preview.
- ✅ When the injector encounters multiple `{children}` expressions or files that already use `<I18nProvider>`, the CLI surfaces explicit fallback instructions instead of attempting a risky rewrite.

### 3.12. Machine‑Friendly Outputs & CI Integrations
* Objective: Make `sync` and `rename-key` outputs easy to consume by CI tooling and other automations.
* Features:
  - `--json` already exists — extend the schema to include `localePreview`, `diffs` and `actionableItems`.
  - Provide exit codes for specific classes of problems (e.g., 2 = interpolation mismatch, 3 = empty target values) to simplify automation.
* Acceptance criteria: CI pipelines can parse command output, break builds on chosen policies, and create issues or PR comments.

**Progress notes (2025-11-26):**
- ✅ `SyncSummary`/`KeyRenameSummary` now expose `actionableItems` alongside `localePreview` and diff data so `--json` callers can surface precise issues (missing keys, duplicates, placeholder mismatches, etc.).
- ✅ `i18nsmith sync --json` automatically includes locale previews and unified diffs even without `--diff`, making CI artifacts self-contained.
- ✅ New structured exit codes: `1` for general drift, `2` for interpolation mismatches, `3` for empty locale values when `--no-empty-values` is enforced, enabling targeted CI policies.

These additions map to the real-world cases we reviewed earlier and are prioritized to improve safety first (validation, CI), then developer experience (interactive flows, diffs), then scale/performance.

### 3.13. Existing i18n Detection & Merge Strategy
* Objective: Detect prior i18n attempts in a repository (existing keys, scaffolded files, custom adapters) and provide safe merge or onboarding flows.
* Detection heuristics:
  - Look for `locales` or configured `localesDir` directories and check for JSON bundles (e.g., `en.json`, `fr.json`).
  - Detect common runtime packages in `package.json` (`react-i18next`, `i18next`, `next-i18next`, `lingui`, etc.).
  - Scan source files for `useTranslation` imports, custom translation hooks, or manual `t()` usages.
  - Detect scaffolded runtime files generated by `i18nsmith` (identify by comment marker or export signature) to avoid double-scaffolding.
* Behaviors & CLI flags:
  - `i18nsmith diagnose` (new) runs a repository health-check and prints a machine-readable summary of existing i18n artifacts: detected locales, packages, provider files, custom adapters, and potential conflicts.
  - `i18nsmith init --merge` prompts to merge with existing locales instead of overwriting; shows conflicts and proposed resolution.
  - `i18nsmith scaffold-adapter --skip-if-detected` avoids scaffolding if a runtime already exists; `--force` overrides.
* Merge strategies:
  - `keep-source`: when seeding missing keys, prefer existing source locale values.
  - `overwrite`: write new placeholders regardless and keep a backup of original files.
  - `interactive`: prompt per-conflict.
* Acceptance criteria: Repos with prior i18n work are recognized and not accidentally double-scaffolded; `diagnose` gives clear next steps.

**Progress notes (2025-11-26):**
- ✅ Added a dedicated `@i18nsmith/core/diagnostics` module that inspects locale JSON health, runtime dependencies, provider scaffolds, and translation usage, surfacing actionable items + conflicts.
- ✅ Introduced `i18nsmith diagnose` with `--json` and `--report` outputs; the command exits non-zero on blocking conflicts so CI can halt risky merges.
- ✅ `i18nsmith init --merge` now consumes the diagnostics report, warns about pre-existing runtimes/locales, and walks the user through merge strategy selection instead of blindly scaffolding.
- ✅ `scaffold-adapter` skips regeneration when an adapter/provider already exists (unless `--no-skip-if-detected` or `--force` is passed) and points users back to `diagnose` for remediation guidance.

#### 3.13 Add-on Plan (2025-11-26)
To close this gap we will ship an add-on sprint with the following deliverables:

1. **Core Detection Engine (`@i18nsmith/core/diagnostics`):**
  - Scan `package.json` for known libraries, report versions.
  - Inspect configured `localesDir` for locale files, detect missing default locales, capture stats.
  - Walk source files (reusing `Scanner`) to find `t()` usage, custom hooks, or provider patterns; emit warnings when mismatched identifiers are detected.
2. **CLI Command – `i18nsmith diagnose`:**
  - Accept `--json` and `--config` like other commands.
  - Provide human-readable console output plus machine-friendly JSON with sections: `locales`, `packages`, `providers`, `conflicts`, `recommendations`.
  - Exit with non-zero code when blocking conflicts are detected (e.g., scaffold mismatch) so CI can fail early.
3. **Merge-aware `init --merge`:**
  - When locale files already exist, prompt to merge vs overwrite.
  - Offer strategies (`keep-source`, `overwrite`, `interactive`) and reuse the detection report to pre-fill answers.
4. **Scaffold Guardrails:**
  - `scaffold-adapter` gains `--skip-if-detected` as default behavior; when a runtime exists, it prints instructions referencing the diagnose findings unless `--force` is passed.
5. **Documentation + Examples:**
  - Update README and `docs/onboarding.md` with a “Start with Diagnose” flow, sample outputs, and guidance for teams migrating from `next-i18next` or `lingui`.
6. **Tests:**
  - Core unit tests for detection heuristics (package detection, locale stats, provider markers).
  - CLI integration tests for `diagnose --json` and `init --merge` interactive session (mocked prompts).

**Timeline:** 3–4 days, beginning immediately after this review. Blocking tasks for Phase 4 must wait until this add-on is complete.

### 3.14. Per‑File Onboarding / New‑Page Integration
* Objective: Support safely adding a new page/component to an existing project with minimal disruption.
* Use cases:
  - Adding a new route or page to a site that already has localized content and providers.
  - Creating a localized content page where only a subset of locales should be seeded initially.
* Feature details:
  - `i18nsmith transform --target <path|glob>` restricts transformation to a specific file or directory (useful when onboarding a single page).
  - `i18nsmith sync --target <path|glob>` restricts sync analysis—and resulting fixes/actionable items—to references within the target scope while intentionally skipping unused-key pruning to avoid deleting unrelated locales during incremental onboarding.
  - `i18nsmith scaffold-adapter --for-file <path>` prints minimal integration snippet (import + provider usage example) tailored to the file's relative path and framework (Next.js vs pages dir).
  - `--seed-locales en,es` allows seeding only a subset of target locales when adding a page.
* Safety rails:
  - When operating on a single file, all writes are atomic and the CLI will produce a preflight `.patch` showing AST-level changes to the file and the locale files it will touch.
  - `--dry-run` is the default for per-file ops.
* Acceptance criteria: Teams can incrementally add localized pages without risking broad changes or accidentally pruning unrelated keys.

**Progress notes (2025-11-26):**
- ✅ Added `--target` to both `i18nsmith transform` and `i18nsmith sync`, accepting repeatable file paths or globs to scope scans/writes to a specific feature.
- ✅ Targeted sync runs now filter references, summaries, and actionable diagnostics to the requested files while disabling unused-key pruning; interactive mode honors the same scope.
- ✅ Added automated coverage (`syncer.test.ts`, `transformer.test.ts`) plus README instructions so per-file onboarding is documented end-to-end.

## Phase 3.5: Immediate Refinements
**Objective:** Evolve the developer experience from "safe" to "seamless and intelligent" based on Phase 3.13 findings.

### 3.15. Post-Implementation Review (Phase 3.13)
**Analysis (2025-11-26):**
The `diagnose` command and its integration into `init` and `scaffold-adapter` successfully prevent accidental overwrites in "brownfield" projects. However, the workflow requires manual command chaining (`diagnose` → `init --merge` → `sync`), and CI integration is limited by generic exit codes.

### 3.16. Active Tasks (Backlog-ready)

- [x] **3.16.1 · Guided `i18nsmith check` command**
  - *Problem:* Onboarding requires manual command chaining.
  - *Scope:* CLI command that orchestrates diagnostics + sync dry-run, emits a consolidated action plan, and suggests exact follow-up commands.
  - *Owners:* CLI squad · Est. 2–3 days.

- [x] **3.16.2 · Granular exit codes for diagnostics**
  - *Problem:* `diagnose` returns generic `1`, hindering CI logic.
  - *Scope:* Map conflict classes to deterministic exit codes (e.g., 2=missing locale, 3=invalid JSON).
  - *Owners:* Core + CLI shared · Est. 1 day.

- [x] **3.16.3 · Pluggable detection heuristics**
  - *Problem:* Hardcoded detection blocks unconventional layouts.
  - *Scope:* `diagnostics` config schema for custom globs/packages.
  - *Owners:* Core squad · Est. 2 days.

**Execution Order:** Ship 3.16.1 first for immediate UX impact; 3.16.2 follows for CI; 3.16.3 for extensibility.

#### Implementation Kickoff: Guided Check (3.16.1)
**Contract (v1 draft):**
- *Inputs:* `i18n.config.json`, `--json`, `--report <file>`, `--fail-on warnings|conflicts`.
- *Outputs:* `CheckSummary` (diagnostics + sync + actions) & human-readable table.
- *Error modes:* Non-zero exits aligned with 3.16.2 mapping.

**Plan:**
1. **Core:** `CheckRunner` composes `DiagnosticsService` + `Syncer` (dry-run) and normalizes actionable items.
2. **CLI:** `check` command with shared printers and prompt logic.
3. **Tests:** Unit coverage for runner + CLI snapshots.
4. **Docs:** Update README & `docs/external-testing.md`.

**Progress notes (2025-11-27):**
- ✅ 3.16.1 delivered the guided `check` command with consolidated actionable items, suggested commands, JSON/report outputs, and CI-friendly failure thresholds (`--fail-on`).
- ✅ 3.16.2 introduced deterministic diagnostics exit codes (2=missing source locale, 3=invalid JSON, 4=reserved provider clash, 5=fallback) plus CLI helpers/tests and README documentation so CI can branch on specific failure modes.
- ✅ 3.16.3 added a `diagnostics` config block so teams can plug in custom runtime package detections, provider globs, adapter hints, and translation usage globs/max file overrides—complete with README docs and regression tests.

### 3.17. Reliability & Polish (Post-Testing)
**Objective:** Address critical stability issues and usability friction identified during external testing (e.g., ESM compatibility, inconsistent flags).

- [x] **3.17.1 · Critical: ESM Module Resolution Fix**
  - *Problem:* CLI crashes in Node ESM environments (`ERR_MODULE_NOT_FOUND`) because compiled JS files lack `.js` extensions in relative imports.
  - *Scope:* Update all relative imports in `packages/cli` (and other packages) to include `.js` extensions. Verify with a pure ESM consumer test.
  - *Priority:* **Blocker**.

- [x] **3.17.2 · CLI Flag Consistency**
  - *Problem:* `check` supports `--report`, but `sync`, `transform`, and `rename-key` do not, making it hard to generate artifacts for other workflows.
  - *Scope:* Add `--report <path>` support to `sync`, `transform`, and `rename-key` commands. Ensure consistent JSON output structure.

- [x] **3.17.3 · Config Lookup & Heuristic Refinements**
  - *Problem:* Config is only looked for in CWD (breaks monorepo sub-folder usage). Scanner is too noisy with attributes like `className`.
  - *Scope:*
    - Implement upward config lookup (find `i18n.config.json` in parent dirs).
    - Update default scanner exclusions to ignore `className`, `style`, `id`, `key`, `ref`, `width`, `height`.

### 3.18. Critical Fixes & Enhancements (Post-Analysis)
**Objective:** Address remaining high-priority issues from external testing (Issues 4-10, A-F).

- [x] **3.18.1 · Provider Detection Noise Reduction**
  - *Problem:* `diagnose` reports internal `node_modules` paths (e.g., `next/dist/...`) as provider candidates.
  - *Scope:* Update `DiagnosticsService` or `ProviderInjector` to exclude `node_modules` from default globs.

- [x] **3.18.2 · Diff/Patch UX Consistency**
  - *Problem:* `--patch-dir` is only available when writing, but is needed for dry-run CI workflows.
  - *Scope:* Enable `--patch-dir` in dry-run mode for `sync` and `transform`. Ensure patches are generated without writing to disk.

- [x] **3.18.3 · Key/Value Integrity Safeguards**
  - *Problem:* Deprecated keys rewritten as text-as-value; literal text used as keys; source values overwritten.
  - *Scope:*
    - Implement validation in `KeyGenerator` to reject text-as-key patterns.
    - Update `Syncer` to prefer existing source values over key names when seeding.
    - Add safeguards to prevent overwriting existing source values with key names.

- [x] **3.18.4 · Locale Retention & Pruning Control**
  - *Problem:* Non-English locales are pruned too aggressively.
  - *Scope:* Add `sync.retainLocales` config option to prevent deletion of specific locales or groups.

## Phase 4: Pluggable Translation Engine (Weeks 11-14)
**Objective:** Integrate optional, pluggable adapters for automated machine translation, enabling `i18nsmith translate` to fill missing locale keys.

### 4.1. Architecture & Interface
*   **Core Abstraction:** `TranslationService` in `@i18nsmith/core` manages the translation pipeline (batching, caching, retries).
*   **Adapter Contract:** Define `Translator` interface in `@i18nsmith/translation`:
    ```typescript
    interface Translator {
      /**
       * Translate a batch of strings.
       * @param texts - Array of source strings to translate.
       * @param sourceLang - Source language code (e.g., 'en').
       * @param targetLang - Target language code (e.g., 'es').
       * @returns Promise resolving to an array of translated strings in the same order.
       */
      translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]>;
      
      /** Optional: Estimate cost for a batch of characters. */
      estimateCost?(characterCount: number): string;
    }
    ```
*   **Plugin Loading:** The CLI dynamically imports adapters based on `i18n.config.json`.
    *   Convention: `@i18nsmith/translator-<provider>` (e.g., `deepl`, `google`, `openai`).

### 4.2. Configuration & Security
*   **Config Schema:**
    ```json
    {
      "translation": {
        "provider": "deepl",
        "secretEnvVar": "DEEPL_API_KEY",
        "concurrency": 5
      }
    }
    ```
*   **Security:** API keys are **never** stored in config files. The config only references the *name* of the environment variable (e.g., `DEEPL_API_KEY`). The CLI reads this variable at runtime.

### 4.3. CLI Command: `translate`
*   **Workflow:**
    1.  **Scan:** Identify keys in `sourceLanguage` that are missing in `targetLanguages`.
    2.  **Plan:** Calculate total characters and (optionally) estimate cost.
    3.  **Prompt:** "Translating 50 keys to 'es' (~500 chars). Proceed? [y/N]"
    4.  **Execute:** Batch requests to the provider (respecting rate limits).
    5.  **Write:** Update locale JSON files atomically.
*   **Flags:**
    *   `--dry-run`: Show what would be translated and estimated cost.
    *   `--locales <list>`: Limit to specific target locales.
    *   `--force`: Overwrite existing translations (default is skip existing).

### 4.4. Official Adapters
*   **`@i18nsmith/translator-mock`:** Local-only adapter for testing/dev. Returns pseudo-localization (e.g., `[es] Hello` -> `¡Hello!`).
*   **`@i18nsmith/translator-deepl`:** Production-ready adapter for DeepL API.
*   **`@i18nsmith/translator-google`:** Production-ready adapter for Google Cloud Translation.

**Progress notes (2025-11-27):**
- ✅ Added reusable translation suggestions from sibling locales plus placeholder preservation enforced at translate-time (missing placeholders fall back to source text with warnings).
- ✅ Introduced interactive confirmation (skippable via `--yes`) before invoking paid providers, matching Phase 4 safety requirements.
- ⚠️ Outstanding: publish official production adapters (`translator-deepl`, `translator-google`) and document their setup guidance.

## Phase 4.5: Translation Workflows (Weeks 14-15)
**Objective:** Provide a tiered translation workflow: Manual (default) → External (CSV handoff) → Automated (API). Reduce emphasis on requiring paid API keys by supporting offline and manual workflows.

### 4.5.1. Manual Entry (Scaffold Empty Keys)
*   **Feature:** `sync --write --seed-target-locales` flag
    *   Adds missing keys to target locale JSON files with empty strings (or configurable TODO markers).
    *   Allows developers to fill translations in VS Code without copy-pasting key names.
*   **Config:** `sync.seedValue` — custom placeholder (default: `""`, can be set to `"[TODO]"`).
*   **Acceptance:** `sync --write --seed-target-locales` populates target files with correct key structure; empty values are distinguishable from real translations.

### 4.5.2. UI Stress Testing (Mock Adapter)
*   **Feature:** Built-in `mock` provider for pseudo-localization.
    *   Generates values like `[fr] Héllo Wörld` (accented characters + locale prefix).
    *   No configuration or API key required.
*   **Command:** `translate --provider mock --write`
*   **Use Case:** UI layout testing (long text expansion, special characters) before real translations.
*   **Acceptance:** Mock provider returns pseudo-localized strings with locale prefix; generated values are distinguishable from real translations.

### 4.5.3. CSV Handoff (For Non-Technical Translators)
*   **Export Command:** `translate --export <path.csv> [--locales fr de]`
    *   Generates a CSV with columns: `key`, `sourceValue`, `targetLocale`, `translatedValue` (empty).
    *   Contains only missing keys for the requested locales.
*   **Import Command:** `translate --import <path.csv> --write`
    *   Parses filled CSV and merges translated values into locale JSON files.
    *   Matches by key (not by line number) to ensure safety even if rows reordered.
    *   Validates placeholder consistency before applying.
*   **Acceptance:**
    *   `translate --export missing.csv --locales fr de` produces a well-formed CSV.
    *   Filling the CSV and running `translate --import filled.csv --write` updates locale files correctly.

### 4.5.4. Documentation Update
*   **README Section:** Replace or supplement "Automated translations" with "Translation Workflows" covering the tiered approach (Manual → External → Automated).
*   **Recipes:** Add examples for each workflow tier.

**Implementation Checklist:**
- [x] 4.5.1 · `sync --seed-target-locales` flag and `sync.seedValue` config option.
- [x] 4.5.2 · Ensure `mock` provider works as documented (pseudo-localization with accents + prefix).
- [x] 4.5.3 · `translate --export` (generate CSV) and `translate --import` (merge CSV) commands.
- [x] 4.5.4 · Update README and add docs/recipes for translation workflows.

## Phase 5: CI/CD, Workflow & Adoption (Weeks 15+)
**Objective:** Make i18nsmith frictionless to adopt — integrate into editor workflows, CI, and team processes, and improve discoverability with docs, recipes and visuals.

### 5.1. Documentation & Recipes (high priority)
*  **Recipes section:** Add targeted guides for common setups:
   - "Next.js App Router" setup (app/, layout.tsx providers),
   - Monorepo (workspaces) configuration,
   - CI/CD example: GitHub Actions and GitLab CI snippets that run `scan --check` / `sync --check` and post diagnostics.
*  **Before / After snippets:** For `transform`, show real React component examples (pre/post), and short examples for Vue/Svelte where applicable.
*  **Visuals & GIFs:** Animated GIFs/screenshots for interactive flows: `sync --interactive`, `init` wizard, and `diagnose` report output. Place them in README and docs/.

### 5.2. CLI Polish & UX
*  **Interactive UX:** Continue enhancing `init`, `sync`, and `translate` with `inquirer` prompts, multi-selects, and clear previews of matched files.
*  **Readable UX:** Use spinners (`ora`) and colorized diffs (`chalk`) for long operations.
*  **Consistent machine output:** Ensure `--json`/`--report` schemas are stable across commands and documented in Recipes.

### 5.3. Editor Integration (VS Code) — deliverable + docs
*  **Lightweight extension MVP:** Use the CLI's JSON outputs as the data source. Start with:
  - Inline diagnostics (watch `.i18nsmith/diagnostics.json`),
  - CodeLens to extract strings, and
  - Hover showing locale values.
*  **Docs & API:** Publish a short "How to wire VS Code" guide that explains how the extension consumes CLI JSON and how to map project adapters.

### 5.4. CI / Git Integration
*  **`i18nsmith-action`:** GitHub Action that runs `scan --check` or `sync --check` on PRs.
  - Fail PR builds on untranslated-drift (configurable threshold).
  - Optionally post a diagnostics summary as a comment or check annotation.
*  **Husky / Git hooks helper:** `i18nsmith install-hooks` — installs pre-commit/pre-push hooks that run `i18nsmith sync --check` (opt-out via env var). Document how to integrate with existing Husky setups.

### 5.5. Adapter & Extensibility Documentation
*  **Custom adapter recipe:** Add a concrete example and minimal interface/contract for adapters (Translator, Provider, and Transformer adapter). Show TypeScript snippets for:
  - the translator contract (methods: estimate, translate, placeholders-check),
  - registering an adapter in config,
  - scaffold-adapter example template.
*  **Clarify "Universal" claim:** Explicitly document supported frameworks and the adapter model. Add a short table: React (react-i18next), Vue (vue-i18n), Svelte, and "vanilla" JS, marking which are production-ready vs. experimental.

### 5.6. Higher-value Features (proposal & low-risk prototypes)
*  **Context-aware LLM translation (experimental):** Add an optional adapter that accepts surrounding code or developer-provided context to LLMs (OpenAI, Claude). Start as opt-in; document privacy/cost tradeoffs.
*  **Unused-key deprecation TTL:** Implement a `deprecateUntil` lifecycle instead of immediate deletion (configurable days). `sync` reports keys in deprecation window and garbage-collects after TTL.
*  **Patch export & preview:** `--patch-dir` support for `sync`/`transform` and `--diff` for rename operations so teams can review changes before `--write`.

### 5.7. Quality & Performance
*  **AST caching & incremental scan:** Prototype a cache keyed by file content hash to speed up repeated scans in CI and local dev.
*  **Telemetry-free heuristics:** Add heuristics and diagnostics to detect zero-match globs and suggest fixes (and surface them in `debug-patterns`).

---

## Phase 6: Real-World Onboarding Fixes (External Testing Feedback)
**Objective:** Address adoption blockers identified during external project testing. Prioritized by impact.

### 6.1. P0 — Critical Onboarding Blockers

#### 6.1.1. Fix Init Glob Parsing
*   **Problem:** The `init` wizard splits brace-expanded globs (e.g., `src/**/*.{ts,tsx,js,jsx}`) into malformed tokens, causing the scanner to match 0 files.
*   **Solution:**
    - Treat brace-expanded globs as atomic tokens; do not split on commas inside braces.
    - Validate patterns and show a preview of matched files before writing config.
*   **Acceptance:** `init --merge` accepts `src/**/*.{ts,tsx,js,jsx}` as a single entry.

#### 6.1.2. CLI Include/Exclude Overrides
*   **Problem:** Users must edit config to test different patterns; no one-off CLI support.
*   **Solution:** Add `--include` and `--exclude` flags to `scan`, `sync`, `transform` commands.
*   **Acceptance:** `scan --include "components/**/*.tsx"` works without config changes.

#### 6.1.3. Zero-Match Warning
*   **Problem:** When include patterns match 0 files, commands silently proceed, confusing users.
*   **Solution:** `diagnose`/`check` warn explicitly when patterns match 0 files and suggest fixes.
*   **Acceptance:** `check` outputs actionable warning with suggested patterns.

#### 6.1.4. Broaden Default Include Globs
*   **Problem:** Default patterns miss common Next.js structures (`app/`, `pages/`, `components/`).
*   **Solution:** Expand defaults to include `app/**/*.{ts,tsx,js,jsx}`, `pages/**/*.{ts,tsx,js,jsx}`, `components/**/*.{ts,tsx,js,jsx}`.
*   **Acceptance:** Fresh `init` in Next.js project matches relevant files.

### 6.2. P1 — Key Refactoring & Detection

#### 6.2.1. Suspicious Key Auto-Rename
*   **Problem:** Sentence-like or space-containing keys are flagged but no low-friction path to normalize them.
*   **Solution:**
    - `sync --auto-rename-suspicious`: propose normalized key names, print changes, apply with `--write`.
    - Persist a mapping JSON for audit and batch renames.
*   **Acceptance:** `sync --auto-rename-suspicious --write` normalizes keys and produces rename map.

#### 6.2.2. Batch Rename Diffs
*   **Problem:** `rename-keys --map` lacks visibility into changes before applying.
*   **Solution:** Add `--diff` and `--report` to surface unified diffs and conflicts across locales.
*   **Acceptance:** `rename-keys --map map.json --diff` shows preview without writing.

#### 6.2.3. Dynamic Key Globs UX
*   **Problem:** Template-literal keys (e.g., ``t(`errors.${code}`)``) generate false unused warnings.
*   **Solution:**
    - Improve AST scanning to surface template-literal usage in reports.
    - Allow `sync.dynamicKeyGlobs` to suppress warnings for runtime namespaces.
    - Add `--assume-globs` CLI flag.
*   **Acceptance:** Dynamic keys in declared namespaces don't trigger unused warnings.

### 6.3. P2 — Locale Management & Translation UX

#### 6.3.1. Locale Shape Normalization
*   **Problem:** Mixed shapes (dotted keys + nested JSON) cause inconsistent writes.
*   **Solution:** `sync --rewrite-shape nested|flat --delimiter "."` to rewrite locales deterministically.
*   **Acceptance:** `sync --rewrite-shape nested` rewrites locales; subsequent `sync --check` reports no drift.

#### 6.3.2. Interactive Sync
*   **Problem:** Teams want to confirm changes before applying across locales.
*   **Solution:** `sync --interactive`: dry-run, present changes, allow toggle, apply atomically with patch export.
*   **Acceptance:** Interactive flow supports selection and atomic writes.

#### 6.3.3. Translate Strict Placeholder Validation
*   **Problem:** Placeholder mismatches in translated output can cause runtime errors.
*   **Solution:**
    - Default to strict validation; fallback to source text on mismatch.
    - Add `--strict-placeholders` to fail CI on mismatches.
*   **Acceptance:** `translate --strict-placeholders` fails CI when placeholders are missing.

#### 6.3.4. Translate Cost Estimation
*   **Problem:** No clear cost/impact estimate before translation.
*   **Solution:** Enhance dry-run with per-locale counts, total characters, estimated cost. Add `--estimate` flag.
*   **Acceptance:** `translate --estimate` prints cost when adapter supports it.

### 6.4. P3 — Polish & Integration

#### 6.4.1. Provider Detection Improvements
*   **Problem:** Custom adapters and Next.js shells sometimes not detected.
*   **Solution:**
    - Extend detection for `app/providers.tsx`, `src/app/layout.tsx`, `<I18nProvider>` wrappers.
    - `check` suggests exact file and insertion point when adapter exists but provider not wired.
*   **Acceptance:** Provider detection finds common Next.js patterns.

#### 6.4.2. External Project Runner Polish
*   **Problem:** `pnpm external:transform` lacks feedback and convenience.
*   **Solution:** Detect missing config, offer `init`, show matched files, persist patches for review.
*   **Acceptance:** External runner provides actionable guidance.

#### 6.4.3. Normalized Reporting & Patch Export
*   **Problem:** Inconsistent `--json`/`--report` across commands.
*   **Solution:**
    - Normalize flags across `init`, `diagnose`, `check`, `scan`, `sync`, `transform`, `translate`.
    - Support `--patch-dir` for `sync` and `transform`.
*   **Acceptance:** All commands support consistent `--json` and `--report` with stable schemas.

#### 6.4.4. Cache Invalidation
*   **Problem:** Stale caches reduce accuracy after config or branch changes.
*   **Solution:** Add `--invalidate-cache` to `scan` and `sync` for clean runs.
*   **Acceptance:** `sync --invalidate-cache` forces fresh AST parsing.

**Progress notes:**
- ⏳ Phase 6 initiated based on external testing feedback (2025-11-28).
- ✅ 6.1.1: Fixed `init` glob parsing with `parseGlobList()` that respects braces; exported for testing.
- ✅ 6.1.2: Added `--include` and `--exclude` flags to `scan` and `sync` commands.
- ✅ 6.1.3: Added `diagnostics-zero-source-files` actionable warning when patterns match 0 files.
- ✅ 6.1.4: Broadened default include globs to `src/`, `app/`, `pages/`, `components/`.
- ✅ 6.2.1: Implemented `--auto-rename-suspicious` with `normalizeToKey()`, `generateRenameProposals()`, and `--rename-map-file` for mapping export.
- ✅ 6.2.2: Added `--diff` to `rename-keys --map` with `createUnifiedDiff()` and `SourceFileDiffEntry`.
- ✅ 6.2.3: Added `--assume-globs` to `sync` and `check` commands; merged with `config.sync.dynamicKeyGlobs`.
- ✅ 6.3.1: Added `rewriteShape()` to LocaleStore with `--rewrite-shape` and `--shape-delimiter` in sync command.
- ✅ 6.3.2: Interactive sync already implemented with checkbox selection (P2.2 complete).
- ✅ 6.3.3: Added `--strict-placeholders` to translate command for CI-mode failure on placeholder mismatch; tracks `placeholderIssues` per locale.
- ✅ 6.3.4: Enhanced `--estimate` with detailed formatting, provider info, generic fallback cost estimation.
- ✅ 6.4.1: Extended provider detection to include `app/layout.tsx`, `src/app/layout.tsx`; added `detectExistingProvider()` and common i18n provider patterns (IntlProvider, NextIntlClientProvider, I18nextProvider, etc.).
- ✅ 6.4.2: Enhanced external runner with file preview, better config warnings, and next-steps guidance.
- ✅ 6.4.3: Added `--report` to `scan` command for consistent reporting across all commands.
- ✅ 6.4.4: `--invalidate-cache` already implemented for sync (P3.4 complete).

---

## Phase 7: Reliability & Safety (Based on External Testing Failures)

This phase addresses systemic issues discovered during three external testing sessions that prevented real-world adoption. See `docs/post-testing-analysis-4.md` for detailed root cause analysis.

### 7.1. Safety Guards

#### 7.1.1. Backup Before Write
*   **Problem:** Target locales were cleared during sync, causing data loss.
*   **Solution:**
    - Auto-create `.i18nsmith-backup/<timestamp>/` before any `--write` operation.
    - Copy all locale files that will be modified.
    - Add `safety.backupBeforeWrite` config option (default: true).
    - Add `safety.backupRetention` to limit stored backups (default: 5).
*   **Acceptance:** Running `sync --write` creates backup; can be disabled via config.

#### 7.1.2. Explicit Prune Mode
*   **Problem:** `sync --write` adds AND removes keys, surprising users.
*   **Solution:**
    - `sync --write` only adds missing keys.
    - `sync --write --prune` removes unused keys (explicit opt-in).
    - Print warning if unused keys exist but `--prune` not specified.
*   **Acceptance:** Default sync never deletes; deletion requires explicit flag.

#### 7.1.3. Dry-Run Mandate
*   **Problem:** Users run `--write` without previewing changes.
*   **Solution:**
    - First-time `--write` in session prompts: "Run without --write first to preview. Continue? [y/N]"
    - Skip prompt with `--yes` flag.
    - Track session state to avoid repeated prompts.
*   **Acceptance:** Interactive warning shown; `--yes` bypasses.

### 7.2. Pre-Flight Validation

#### 7.2.1. Config Validation
*   **Problem:** Commands fail late with confusing errors.
*   **Solution:** Before any operation, validate:
    - Config file exists and is valid JSON
    - `include` patterns match at least 1 file
    - `localesDir` exists or can be created
    - Write permissions on locale files (if `--write`)
*   **Acceptance:** Clear error messages for each validation failure.

#### 7.2.2. Dependency Check
*   **Problem:** Transformed code fails to compile due to missing adapter library.
*   **Solution:**
    - Check package.json for adapter dependency (react-i18next, vue-i18n, etc.).
    - Print warning with install command if missing.
    - Add `--skip-dep-check` to bypass.
*   **Acceptance:** Transform warns if adapter dependency missing.

#### 7.2.3. Existing Setup Detection
*   **Problem:** Tool overwrites existing i18n setup without warning.
*   **Solution:**
    - Detect existing locale files and i18n providers before `init`/`transform`.
    - Show summary: "Detected: 3 locales (en, fr, de), react-i18next provider".
    - Prompt for merge strategy or abort.
*   **Acceptance:** `init` on existing project shows detection summary.

### 7.3. Key Quality Improvements

#### 7.3.1. Cleaner Default Key Format
*   **Problem:** Keys like `common.auto.page.slug.abc12345` are verbose and ugly.
*   **Solution:**
    - Default format: `<filename>.<slug>` without prefix or hash.
    - Add hash suffix only on collision: `<filename>.<slug>.<hash4>`.
    - Config option: `keyGeneration.format` = `"minimal"` | `"hashed"` | `"namespaced"`.
*   **Acceptance:** Generated keys are readable; no hash when unnecessary.

#### 7.3.2. Text-as-Key Migration Command
*   **Problem:** Existing `t("Long English text")` patterns not converted to semantic keys.
*   **Solution:**
    - `i18nsmith migrate-keys --strategy=semantic` command.
    - Converts `"Save Changes"` → `"actions.saveChanges"`.
    - Updates source files and all locale files atomically.
    - Collision detection with interactive resolution.
*   **Acceptance:** Bulk migration of text-as-keys to semantic keys.

#### 7.3.3. Key Linting
*   **Problem:** Bad keys slip into codebase (spaces, no namespace, too long).
*   **Solution:**
    - `i18nsmith lint-keys` command with configurable rules.
    - Rules: `no-spaces`, `has-namespace`, `max-length`, `no-numbers-prefix`.
    - CI-friendly exit codes.
*   **Acceptance:** `lint-keys` catches and reports bad patterns.

### 7.4. Scanner Completeness

#### 7.4.1. Coverage Report
*   **Problem:** Users don't know if all files were scanned.
*   **Solution:**
    - `i18nsmith scan --coverage` shows:
      ```
      Files matched:     289/312 (92%)
      Files skipped:      23 (see --verbose)
      Keys found:        1,245
      Dynamic patterns:    47
      ```
    - Include skip reasons (syntax error, excluded, etc.).
*   **Acceptance:** Coverage report shows completeness percentage.

#### 7.4.2. Pattern Debugging
*   **Problem:** Users can't figure out why files aren't matched.
*   **Solution:**
    - `i18nsmith debug-patterns` command.
    - Shows each include/exclude pattern and what it matches.
    - Highlights unmatched files with suggested pattern fixes.
*   **Acceptance:** Pattern debugger helps fix glob issues.

### 7.5. Error Recovery

#### 7.5.1. Rollback Command
*   **Problem:** No recovery path after accidental data loss.
*   **Solution:**
    - `i18nsmith rollback` restores from latest backup.
    - `i18nsmith rollback --list` shows available backups.
    - `i18nsmith rollback <timestamp>` restores specific backup.
*   **Acceptance:** Rollback restores locale files from backup.

#### 7.5.2. Diff Review Before Write
*   **Problem:** Bulk changes applied without review.
*   **Solution:**
    - Enhance `sync --write --interactive` with per-change confirmation.
    - Show diff for each file, ask Y/N/skip-all/apply-all.
*   **Acceptance:** Interactive mode allows granular approval.

**Progress notes:**
- ✅ **7.1.2 Explicit Prune Mode** (2025-11-28): Added `--prune` flag to sync command. Key deletion now requires explicit `--write --prune`. Without `--prune`, sync only adds missing keys.
- ✅ **7.1.1 Backup Before Write** (2025-11-28): Implemented auto-backup to `.i18nsmith-backup/<timestamp>/`. Backups created automatically before `--write --prune`. Added `backup-list` and `backup-restore` commands. `--no-backup` flag to disable.
- ✅ **7.2.1 Config Upward Search** (2025-11-28): Added `loadConfigWithMeta()` that traverses up directories to find `i18n.config.json`. CLI commands now use project root from config location.
- ✅ **7.3.1 Dry-run Default** (2025-11-28): All `--write` options default to `false`. Added clear "📋 DRY RUN - No files were modified" indicators across sync, transform, and rename commands.
- ✅ **7.3.2 Confirmation Prompts** (2025-11-28): Added confirmation prompt before pruning ≥10 keys. Shows sample of keys to be removed. Use `-y` / `--yes` to skip prompt (for CI).
- ⏳ Phase 7 initiated based on external testing failure analysis (2025-11-28).

---

## Phase 4.6: Post-Testing Improvements (Based on Comprehensive Test Report)
**Objective:** Address issues discovered during comprehensive functional testing against a real production project (Next.js + next-intl, 289 files, 1,678 locale keys).

**Test Report Reference:** `docs/testing/i18nsmith-complete-test-report.md`

### 4.6.1. Critical Safety Fixes

#### 4.6.1.1. scaffold-adapter --dry-run Safety ✅ FIXED
*   **Problem:** `--dry-run` flag was ignored; files were written to disk despite the flag being set.
*   **Impact:** CI/CD safety violation, potential unintended file overwrites.
*   **Solution:**
    - Updated `scaffold.ts` to accept `dryRun` option and return `ScaffoldResult` with `written` flag.
    - Updated `scaffold-adapter.ts` to show preview content without writing when `--dry-run` is used.
    - Skip dependency installation in dry-run mode.
*   **Status:** ✅ Fixed (2025-11-28)

### 4.6.2. Major Usability Improvements

#### 4.6.2.1. Transform Import Detection ✅ FIXED
*   **Problem:** Transform hardcoded `react-i18next` import regardless of project's actual runtime (e.g., `next-intl`).
*   **Impact:** Creates duplicate/incorrect imports, requires manual cleanup.
*   **Solution:**
    - Added `detectExistingTranslationImport()` to `react-adapter.ts`.
    - Detects existing translation imports in target files (useTranslation, useTranslations, useT, t).
    - Recognizes known modules (react-i18next, next-intl, vue-i18n, @lingui/react).
    - Detects custom translation contexts via path heuristics.
    - Transformer now checks each file for existing imports and reuses them.
*   **Status:** ✅ Fixed (2025-11-28)

#### 4.6.2.2. JSON Reformatting Behavior (Documented)
*   **Problem:** Adding 4 keys results in 3,585 lines changed (entire file reformatted).
*   **Impact:** Noisy git diffs, harder to review changes.
*   **Root Cause:** LocaleStore uses deterministic formatting:
    - Keys are always sorted alphabetically.
    - Uses consistent 2-space indentation.
    - Ensures reproducible output across runs.
*   **Current Behavior:** By design for consistency; enables reliable diffs between runs.
*   **Future Enhancement:** Consider adding `--preserve-format` flag for minimal edits.
*   **Status:** 📝 Documented (expected behavior)

### 4.6.3. Minor Improvements (Backlog)

#### 4.6.3.1. Exit Code Documentation
*   **Problem:** Exit code 11 observed but not documented.
*   **Observation:** `check --json` returns exit code 11 when drift + warnings detected.
*   **Proposed Fix:** Document all exit codes (0/1/2/11) in CLI help and testing plan.
*   **Status:** ⏳ Backlog

#### 4.6.3.2. Mock Translator Bundling
*   **Problem:** Mock adapter not resolvable in target projects.
*   **Impact:** Translation write-path testing blocked without manual installation.
*   **Proposed Solutions:**
    - Bundle mock adapter with CLI.
    - Support `--module-root` to load adapters from tool monorepo.
    - Provide clear installation instructions in error message.
*   **Status:** ⏳ Backlog

#### 4.6.3.3. False Dependency Warnings
*   **Problem:** Warns about missing `react-i18next` when project uses `next-intl`.
*   **Root Cause:** `checkDependencies()` in transformer only checks for react-i18next.
*   **Proposed Fix:** Consult `runtimePackages` from diagnose output before warnings.
*   **Status:** ⏳ Backlog

### 4.6.4. Test Coverage Gaps Identified

The following features were not explicitly tested and should be added to E2E fixtures:

- [ ] `rename-keys` bulk operation with mapping file
- [ ] `--invalidate-cache` flag verification
- [ ] `--assume` flag for dynamic keys
- [ ] Provider dependency checks
- [ ] Isolated E2E fixtures (tested on real project instead)

### 4.6.5. Verified Functionality (Test Results)

The following features were verified working correctly:

- ✅ All core workflows: diagnose → scan → check → sync (dry/write/prune) → translate export/import
- ✅ Transform --write: extracts hardcoded strings, transforms source code, adds keys to locale files
- ✅ Safety rails: backups created automatically, prune requires confirmation, rollback restores state
- ✅ Machine outputs: JSON/reports generated for all tested commands with well-formed schemas
- ✅ Performance: 2x speed-up on warm cache runs (target met)
- ✅ Unit tests: 192 tests passed across 17 test files (4.82s execution)
- ✅ CLI integration: 78 tests passed (6.42s execution)

**Progress notes (2025-11-28):**
- ✅ Fixed scaffold-adapter --dry-run safety violation.
- ✅ Fixed transform import detection to reuse existing imports.
- ✅ Documented JSON reformatting behavior as expected (deterministic output).
- ✅ Build passes, all 288 tests pass.
