# Editor Integration (VS Code) – Phase 5

## Vision
Provide instantaneous feedback on i18n health directly in the editor using existing CLI JSON outputs (no runtime server).

## MVP Features
1. Inline diagnostics for drift (missing/unused keys).
2. Hover provider for `t('key')` showing source + target values.
3. CodeAction to create missing key placeholders.
4. Command palette actions: i18nsmith: Diagnose, Sync Dry-Run.

## Data Sources
- `i18nsmith check --json --report .i18nsmith/check.json`
- `i18nsmith sync --dry-run --json --report .i18nsmith/sync.json`

## Polling Strategy
- Watch `.i18nsmith/*.json` via `FileSystemWatcher`.
- Debounce reprocessing (250–500ms).

## JSON Schema (Excerpt)
```ts
interface CheckSummary {
  actionableItems: ActionableItem[];
  localePreview: Record<string, LocalePreview>;
}
```

## Extension Architecture
| Module | Responsibility |
|--------|----------------|
| DiagnosticsProvider | Parse JSON & surface VS Code diagnostics |
| HoverProvider | Lookup key, render markdown table |
| CodeActions | Provide quick-fix (Add placeholder) |
| RunnerAPI | Shell out to CLI with cancellation token |

## Performance Notes
- Avoid parsing large locale files repeatedly; cache last mtime hash.
- Use incremental diff to update diagnostics.

## Security & Privacy
- All data local; no external calls.
- Offer setting to disable automatic CLI execution.

## Future Enhancements
- Key rename refactors via CodeAction.
- Pseudo-localization preview toggles.
- Multi-locale hover summary (expandable).

## Getting Started (Future)
Add a `CONTRIBUTING.md` section once prototype exists.
