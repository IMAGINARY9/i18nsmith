# CLI UX Polish Backlog (Phase 5)

## Purpose
Track user-facing polish tasks that improve clarity, speed, and consistency without altering core logic.

## High-Priority Items
1. Spinner & Progress Indicators
   - Add `ora` spinners for long phases (diagnostics scan, sync diff generation, transform AST rewrite).
   - Auto-disable in CI / when `--json` passed.
2. Colorized Output
   - Use `chalk` for severity badges (ERROR/WARN/INFO) and diff hunks.
   - Respect `NO_COLOR` env var.
3. Unified Report Schema Doc
   - Generate `docs/schema.md` from TypeScript types (`CheckSummary`, `SyncSummary`, `TranslateSummary`).
   - Include schema version key (e.g., `schemaVersion: 1`).
4. Error Message Style Guide
   - Convert raw thrown errors to structured messages: `[E1001] Missing source locale: en.json`.
   - Map codes to troubleshooting suggestions.
5. Consistent Flag Grouping in Help
   - Reorder `--json`, `--report`, `--diff`, `--patch-dir` under "Output" section in each command help.
   - Introduce `--quiet` to suppress non-essential lines (spinner banners, suggestions).

## Medium-Priority Items
6. Adaptive Column Width
   - Auto-fit tables to terminal width; wrap long key names with ellipsis.
7. Performance Timers
   - Show phase durations (`scan: 1.2s`, `diff: 300ms`) when `--verbose` passed.
8. Config Provenance Display
   - Print resolved config file path & number of overrides from CLI flags.
9. Patch Preview Filtering
   - Allow `--diff-filter added,removed` to limit displayed diff sections.
10. Hook for External Renderers
   - Expose `formatSummary(summary, opts)` for downstream tools to reuse CLI formatting.

## Low-Priority / Exploratory
11. Interactive Transform Preview
   - Confirm each replacement inline (risk: slows large runs).
12. Key Copy Utility
   - Add `--copy-keys` to write new keys list to clipboard (macOS only initial).
13. Automatic Width Detection for JSON
   - Fold large arrays in JSON report unless `--expand-all` passed.

## Completed / Already Shipped
- Deterministic exit codes (diagnostics, sync, check).
- Dry-run banners for destructive commands.
- Backup before write & rollback.
- Incremental reference cache.

## Non-Goals (Phase 5)
- Full TUI interface (defer; complexity vs value).
- Telemetry / usage analytics (privacy-first posture maintained).

## Metrics & Success Criteria
| Metric | Target |
|--------|--------|
| Avg time to identify drift (interactive) | < 5s on medium repo |
| Max noise lines during dry-run | < 25 lines before diffs |
| Color-disabled readability | No loss of severity clarity |

## Implementation Notes
- Introduce a `ui` helper module in CLI (`packages/cli/src/utils/ui.ts`) for spinners, color wrappers, width logic.
- Centralize schemas under `packages/cli/src/schemas/` for doc generation.
- Each backlog item gets an issue with label `phase5-ux` for tracking.

## Next Steps
1. Create `ui.ts` scaffold & replace ad-hoc console.log banners.
2. Add schema doc generation script (`pnpm generate:schemas`).
3. Implement spinner + color integration for `check` command first (baseline).
