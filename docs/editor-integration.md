# Editor Integration (VS Code) – Phase 5

## Vision
Provide instantaneous feedback on i18n health directly in the editor using existing CLI JSON outputs (no runtime server).

## Implementation Status

**MVP now available at `packages/vscode-extension/`**

### Implemented Features
- ✅ Inline diagnostics for actionable items (missing keys, conflicts, warnings)
- ✅ CodeLens showing issue count and quick actions per file
- ✅ File watcher for automatic refresh when report changes
- ✅ Command palette actions: Check, Sync, Refresh Diagnostics
- ✅ Status bar item for quick access
- ✅ Configurable report path and auto-refresh settings

### Planned Features
- 🔲 Hover provider for `t('key')` showing source + target values
- 🔲 CodeAction to create missing key placeholders
- 🔲 Key rename refactors via CodeAction

## Quick Start

```bash
# 1. Install extension dependencies
cd packages/vscode-extension
pnpm install

# 2. Compile
pnpm run compile

# 3. Open VS Code and press F5 to launch Extension Development Host
# Or use the "Run Extension" launch configuration
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nsmith.reportPath` | `.i18nsmith/check-report.json` | Path to the report file |
| `i18nsmith.autoRefresh` | `true` | Auto-refresh when report changes |
| `i18nsmith.showCodeLens` | `true` | Show CodeLens actions |

## Data Sources
- `i18nsmith check --json --report .i18nsmith/check-report.json`
- `i18nsmith sync --json --report .i18nsmith/sync.json`

## Polling Strategy
- Watch `.i18nsmith/*.json` via `FileSystemWatcher`.
- Debounce reprocessing on file change events.
- Manual refresh via command palette.

## JSON Schema (Excerpt)
```ts
interface CheckSummary {
  actionableItems: ActionableItem[];
  diagnostics: { actionableItems: ActionableItem[] };
  sync: { actionableItems: ActionableItem[] };
  hasConflicts: boolean;
  hasDrift: boolean;
}

interface ActionableItem {
  kind: string;
  severity: 'error' | 'warn' | 'info';
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  key?: string;
}
```

## Extension Architecture
| Module | File | Responsibility |
|--------|------|----------------|
| Extension | `extension.ts` | Entry point, command registration |
| DiagnosticsManager | `diagnostics.ts` | Parse JSON & surface VS Code diagnostics |
| CodeLensProvider | `codelens.ts` | Show quick actions above files |
| ReportWatcher | `watcher.ts` | Watch report file, trigger refresh |

## Performance Notes
- Uses esbuild for fast bundling (~4ms compile)
- Diagnostics grouped by file to minimize VS Code API calls
- File watcher debounced to avoid excessive refreshes

## Security & Privacy
- All data local; no external calls.
- CLI execution happens in visible terminal (user can see commands)
- No telemetry or analytics

## Integration with CI

The extension pairs well with the i18nsmith GitHub Action:

```yaml
- uses: IMAGINARY9/i18nsmith@v1
  with:
    command: check
    report-path: .i18nsmith/check-report.json
```

Download the report artifact and the extension will pick it up automatically.

## Future Enhancements
- Key rename refactors via CodeAction.
- Pseudo-localization preview toggles.
- Multi-locale hover summary (expandable).
- Inline key extraction from selected text.

