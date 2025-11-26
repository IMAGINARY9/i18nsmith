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

## Phase 5: CI/CD & Workflow (Weeks 15+)
**Objective:** Deeply integrate i18nsmith into the developer's daily workflow (Editor, CI, Git).

### 5.1. CLI Polish & Interactivity
*   **Interactive Mode:** Enhance `init`, `sync`, and `translate` with rich `inquirer` prompts (checkboxes for selecting keys, confirmation steps).
*   **Visual Feedback:** Use `ora` spinners for long-running tasks (scanning, translating) and `chalk` for readable diffs.

### 5.2. GitHub Action / CI Integration
*   **Action:** `i18nsmith-action` to run `scan --check` or `sync --check` on Pull Requests.
*   **Behavior:**
    *   Fails the build if new untranslated strings are found (drift detection).
    *   Optionally posts a PR comment with the `diagnose` report summary.

### 5.3. VS Code Extension
**Goal:** Bring CLI insights directly into the editor to reduce context switching.
*   **Architecture:** The extension acts as a UI layer over the CLI. It spawns `i18nsmith` commands in the background and parses their JSON output.
*   **Feature Set:**
    1.  **Inline Diagnostics:**
        *   Watch `.i18nsmith/diagnostics.json` (generated by `check`).
        *   Underline keys in source code that are missing translations or have type mismatches.
        *   *Quick Fix:* "Add missing translation" (prompts for value).
    2.  **Extraction Assistant:**
        *   **CodeLens:** "Extract to i18n" appears above hardcoded strings detected by the scanner.
        *   **Action:** Clicking it opens a prompt for the key name, then runs `transform --target <file> --write`.
    3.  **Hover Information:**
        *   Hovering over `t('key')` shows the actual text values for configured locales (e.g., `en: "Hello"`, `es: "Hola"`).
    4.  **Command Palette:**
        *   `I18nsmith: Run Health Check` (runs `check`).
        *   `I18nsmith: Translate Missing Keys` (runs `translate`).

### 5.4. Extended Ecosystem & Future Roadmap
*   **Customizable Key Generation:**
    *   Allow teams to define key patterns in config (e.g., `"{filePath}.{textHash}"` or `"{context}.{slug}"`) to match legacy conventions.
*   **Multi-Framework Support:**
    *   Expand `scaffold-adapter` and `transformer` to support Vue (`vue-i18n`), Svelte (`svelte-i18n`), and SolidJS.
*   **Performance Profiling:**
    *   Implement AST caching (content-addressable store) to make `scan`/`sync` instant for large monorepos.
*   **Locale Splitting:**
    *   Support splitting translations into multiple files (namespaces) per locale (e.g., `common.json`, `auth.json`) for lazy-loading in large apps.
