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
  *   `placeholder="Name"` → `placeholder={t('auto.def456')}`.
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

### 3.11. Provider Injection Robustness
* Objective: Replace string-probing heuristics with AST-aware injection for framework provider files.
* Features:
  - Use `ts-morph` to parse candidate provider/layout files and reliably wrap root children with `I18nProvider` without brittle string replacements.
  - Provide a `--dry-run` preview of injection changes and explicit fallback instructions when it cannot safely transform the file.
* Acceptance criteria: Provider injection succeeds in canonical Next.js layouts and refuses to edit ambiguous constructs.

### 3.12. Machine‑Friendly Outputs & CI Integrations
* Objective: Make `sync` and `rename-key` outputs easy to consume by CI tooling and other automations.
* Features:
  - `--json` already exists — extend the schema to include `localePreview`, `diffs` and `actionableItems`.
  - Provide exit codes for specific classes of problems (e.g., 2 = interpolation mismatch, 3 = empty target values) to simplify automation.
* Acceptance criteria: CI pipelines can parse command output, break builds on chosen policies, and create issues or PR comments.

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

### 3.14. Per‑File Onboarding / New‑Page Integration
* Objective: Support safely adding a new page/component to an existing project with minimal disruption.
* Use cases:
  - Adding a new route or page to a site that already has localized content and providers.
  - Creating a localized content page where only a subset of locales should be seeded initially.
* Feature details:
  - `i18nsmith transform --target <path|glob>` restricts transformation to a specific file or directory (useful when onboarding a single page).
  - `i18nsmith sync --target <path|glob>` restricts sync analysis to references within the target scope but still checks locale-wide unused keys (so you can preview the impact of the new page).
  - `i18nsmith scaffold-adapter --for-file <path>` prints minimal integration snippet (import + provider usage example) tailored to the file's relative path and framework (Next.js vs pages dir).
  - `--seed-locales en,es` allows seeding only a subset of target locales when adding a page.
* Safety rails:
  - When operating on a single file, all writes are atomic and the CLI will produce a preflight `.patch` showing AST-level changes to the file and the locale files it will touch.
  - `--dry-run` is the default for per-file ops.
* Acceptance criteria: Teams can incrementally add localized pages without risking broad changes or accidentally pruning unrelated keys.


## Phase 4: Pluggable Translation Engine (Weeks 11-14)
**Objective:** Integrate optional, pluggable adapters for translation services.

### 4.1. Translator Interface
*   In `@i18nsmith/translation`, define a simple `Translator` interface:
    ```typescript
    interface Translator {
      translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]>;
    }
    ```

### 4.2. Adapter Implementation
*   Create separate, optional packages for each adapter (e.g., `@i18nsmith/translator-deepl`, `@i18nsmith/translator-google`).
*   These packages will be **optional dependencies**. A user installs them only if they need them.
*   The `i18nsmith translate` command will dynamically `import()` the adapter specified in `i18n.config.json`.

### 4.3. Security & Dev Experience
*   API keys must be provided via environment variables (e.g., `DEEPL_API_KEY`). The config will only reference the variable name.
*   Provide a mock local adapter (`@i18nsmith/translator-mock`) that returns pseudo-translations (e.g., `[EN] Hello`) for fast, offline development.

## Phase 5: CI/CD & Workflow (Weeks 15+)
**Objective:** Integrate into the developer lifecycle.

### 5.1. CLI Polish
*   Enhance commands with interactive prompts using `inquirer`.
*   Improve output formatting with `chalk` and add progress indicators.

### 5.2. GitHub Action
*   Create a GitHub Action to run `i18nsmith scan --check` on Pull Requests.
*   This command will fail the build if it finds new, untranslated strings that haven't been extracted.

### 5.3. VS Code Extension (Future)
*   Highlight hardcoded strings directly in the editor.
*   Provide a "Quick Fix" action to run `i18nsmith` on the current file.

### 5.4. Extended Backlog
* Multi-framework adapters (Vue, Solid, Svelte) via unified hook signature.
* Optional Prettier integration with user config detection.
* Performance profiling (cache AST parse results between runs).
* Telemetry opt-in (anonymous stats: candidate kinds, transformation counts).
* Locale splitting strategy (namespace sharding for large apps).

## Completed Summary (Phases & Extra Enhancements)
* Phase 1 foundation (scanner + config + init) ✅
* Transformer end-to-end (scan → key generation → write) ✅
* `--write` and `--check` CLI modes ✅
* Deterministic key generation & locale store with seeding ✅
* Adapter configuration & scaffolding (custom / react-i18next) ✅
* Runtime auto-setup integrated into `init` & `scaffold-adapter` ✅
* Documentation refreshed (README runtime & adapter sections) ✅

## Historical Plans Consolidation
Implementation plans v2 and v3 have been merged here; their future items now live under Backlog sections. Separate files removed.
