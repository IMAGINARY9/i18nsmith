## Quick Actions: Flow, Behavior and Expected Output

This document summarizes three quick actions exposed by the VS Code extension and their end-to-end flow through the extension and CLI layers:

- Batch extract hardcoded strings
- Rename suspicious keys
- Fix local drift

For each action we describe: purpose, UI flow, controller/CLI interactions, important implementation details, flags, expected outputs for common cases, and troubleshooting notes.

---

### 1) Batch extract hardcoded strings

Purpose
- Find hardcoded strings in source files and extract them into locale files while replacing source calls with t("key") (or equivalent).

Where implemented
- VS Code controller: `packages/vscode-extension/src/controllers/transform-controller.ts` (preview + apply UI flows)
- CLI: `packages/cli/src/commands/transform.ts` and transformer core in `@i18nsmith/transformer`
- Preview plumbing: `packages/vscode-extension/src/preview-manager.ts` and `packages/cli/src/utils/preview.ts`

High-level flow
1. User triggers Batch Extract from quick actions (or runs `i18nsmith transform` via CLI).
2. Extension calls `PreviewManager.run({ kind: 'transform', args: [...] })` which executes `i18nsmith transform --preview-output <tmp.json>` in the project workspace.
3. The CLI writes a preview JSON describing candidates (summary.candidates) and diffs.
4. Extension parses preview payload and shows a short preview summary or a detailed diff preview via `diffPreviewService`.
5. If user chooses Apply, the extension runs the CLI with `i18nsmith transform --apply-preview <tmp.json>` (the extension ensures `--apply-preview` is used so the exact preview is applied).

Important details / flags
- Preview mode: `--preview-output <path>` writes a JSON summary and implies dry-run.
- Apply mode: `--apply-preview <path>` replays the saved preview, and the CLI ensures `--write` is present when applying so changes are written to disk.
- Transform options in CLI: `--target`, `--migrate-text-keys`, `--diff`, `--patch-dir`, `--write`
- The extension also shows counts of pending/duplicate/existing candidates.

Expected outputs / cases
- No candidates found: Preview says 'No transformable strings found.' Extension informs user and offers to adjust include patterns.
- Candidates present but user picks Dry Run: no files modified; preview shown.
- Apply chosen: files are modified according to preview; locale files updated and source files replaced with t("key"). Extension clears caches and refreshes diagnostics.
- Partial filtering/skip: Some candidates may be skipped by safety filters (React scope, duplicate text, too short); CLI summary indicates pending/skipped counts and reasons.

Troubleshooting
- Count mismatch between preview and apply is typically caused by replaying a reconstructed CLI command instead of `--apply-preview`. The extension uses `--apply-preview` to avoid re-scanning discrepancies.

---

### 2) Rename suspicious keys

Purpose
- Normalize suspicious keys (e.g., keys equal to their values or that violate naming conventions) and update code references accordingly.

Where implemented
- VS Code controller: `packages/vscode-extension/src/controllers/sync-controller.ts` (renameSuspiciousKey, renameAllSuspiciousKeys)
- CLI: `packages/cli/src/commands/rename.ts` (and `sync.ts` for the bulk auto-rename path) and core `KeyRenamer` in `@i18nsmith/core`

High-level flow
1. The extension collects suspicious key warnings from the latest diagnostics or a sync preview.
2. Single-key rename: user triggers `renameSuspiciousKey(warning)` which asks for a new key name; the extension then runs `PreviewManager.run({ kind: 'rename-key', args: [from, to, '--diff'] })` to get a preview of source-file changes and locale diffs.
3. Bulk rename (rename all): the extension can call `runSync` with `--auto-rename-suspicious` so the CLI generates a set of rename proposals and corresponding diffs.
4. Preview is shown (source file diffs and locale diffs). If user selects Apply, extension uses either `i18nsmith rename-key --apply-preview <path>` or `i18nsmith sync --apply-preview <path>` depending on how the preview was generated.

Important details / flags
- Single rename uses `rename-key` preview type. Bulk uses sync preview with `--auto-rename-suspicious` and may surface `renameDiffs` in the summary.
- The CLI will write a mapping file when requested (e.g., `--rename-map-file`) to persist proposals.
- Preview JSON payload may include `renameDiffs` and `localeDiffs` (source code patches, locale patches). The extension aggregates these for a combined diff preview.

Expected outputs / cases
- No changes detected: preview may show zero diffs; extension informs user and aborts apply.
- Rename diffs present: the extension displays diffs; when applied the CLI updates source files (symbol references) and locale files accordingly.
- Conflicts (multiple references, ambiguous proposals): CLI will either skip conflicting renames or surface them as actionable items; the extension shows skipped items and reasons.

Troubleshooting
- If apply does nothing, check that (a) the preview file was recorded correctly, (b) the `applyPreviewFile` replay constructs the correct subcommand and includes `--write`, and (c) extension uses `--apply-preview` rather than reconstructing the command. See `packages/cli/src/utils/preview.ts` and the extension's use of preview manager.

---

### 3) Fix local drift (Sync)

Purpose
- Detect missing keys (used in source code but missing from locale files) and unused keys (present in locales but not referenced) and optionally fix them by adding/removing entries.

Where implemented
- VS Code controller: `packages/vscode-extension/src/controllers/sync-controller.ts` (runSync, applySync)
- CLI: `packages/cli/src/commands/sync.ts` and core `Syncer` in `@i18nsmith/core`

High-level flow
1. User triggers 'Fix Locale Drift' quick action or `i18nsmith sync` command.
2. The extension runs a preview: `i18nsmith sync --diff --preview-output <tmp.json>` (additional flags may be passed such as `--assume`, `--target`). The CLI performs analysis and writes a preview JSON including `missingKeys`, `unusedKeys`, `diffs`, `renameDiffs` and other metadata.
3. The extension reads the preview and shows a side-by-side diff preview (via `diffPreviewService`) or a markdown-style summary when diffs are not available.
4. On Apply, extension runs `i18nsmith sync --apply-preview <tmp.json> --yes` (extension includes `--yes` to avoid interactive confirmations for prune) and optionally passes extra args like `--prune`, `--selection-file` or `--seed-target-locales` so the apply step respects the user's choices.

Important details / flags
- `--diff`: request unified diffs for display in the preview
- `--preview-output <path>`: write the JSON preview
- `--apply-preview <path>`: apply a previously saved preview; the CLI will sanitize args and add `--write` if missing
- `--prune`: instructs CLI to remove unused keys when applying (requires `--write`)
- `--seed-target-locales`: copy source locale keys to target locales (optionally with `--seed-value`)
- `--yes`: non-interactive confirmation for destructive ops (extension includes this when applying to avoid blocking the UI)

Expected outputs / cases
- Locales already in sync: preview shows zero missing/unused; extension shows 'Locales are in sync. No changes needed.' and does not present an Apply action.
- Missing keys only: preview lists missing keys and diffs showing insertions; Apply will add keys to locale files. If `--seed-target-locales` is set, target locales receive seeded values.
- Unused keys only: preview shows removals; Apply with `--prune` will remove keys and create backups (unless `--no-backup`).
- Mixed: preview shows both additions and removals; extension offers a combined preview and Apply with `--prune` as requested.

Troubleshooting
- If after Apply the missing keys still aren't present, possible causes:
  - The preview replay added an extra positional token and the CLI interpreted args incorrectly (fixed by ensuring preview replay uses the recorded args without duplicating the subcommand).
  - The extension applied without `--seed-target-locales` when seeding was desired; ensure the extension passes `--seed-target-locales` and (optionally) `--seed-value` when applying.
  - Interactive prompts blocked the apply (extension now passes `--yes` to avoid blocking prompts for prune operations).

---

Shared implementation notes
- Preview JSON: contains { type, version, command, args, timestamp, summary }. The CLI `writePreviewFile` records `args` as captured from process argv; `applyPreviewFile` must sanitize and replay those args correctly. See `packages/cli/src/utils/preview.ts` for replay/sanitization logic.
- The extension uses a `PreviewManager` that runs the CLI with `--preview-output` and then reads the preview file to build UI previews. Always apply via `--apply-preview` to avoid re-scanning and to guarantee atomicity between preview and apply.
- Output channel: The extension shows CLI stdout/stderr in the output channel during preview and apply. For a smoother UX the extension can hide or suppress raw output during non-interactive apply flows (the codebase already supports a `showOutput` option in some callers).

Quick verification steps
1. Run a sync preview from the extension. Inspect generated preview file at `.i18nsmith/previews/*-preview-<ts>.json`.
2. Open the preview JSON and verify `args` does not include duplicated subcommands. The `applyPreviewFile` helper will handle both forms.
3. Apply preview and confirm source & locale files changed as expected.

References (files to inspect)
- Extension controllers: `packages/vscode-extension/src/controllers/sync-controller.ts`, `transform-controller.ts`
- Preview manager: `packages/vscode-extension/src/preview-manager.ts`
- CLI preview helpers: `packages/cli/src/utils/preview.ts`
- CLI commands: `packages/cli/src/commands/sync.ts`, `transform.ts`, `rename.ts`

---

If you want, I can now:

- Recompile the CLI package (`pnpm --filter i18nsmith build`) and the extension, then run the extension dev host and perform a small smoke test (apply a preview with a controlled sample repo).
- Add a short automated integration test that uses the preview apply flow against a temporary fixture repo to cover the full extension → CLI → file changes loop.

Requested by: developer working on quick actions
