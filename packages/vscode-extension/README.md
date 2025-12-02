# i18nsmith VS Code Extension

VS Code integration for [i18nsmith](https://github.com/IMAGINARY9/i18nsmith) - automated i18n tooling.

## Features

- **Inline Diagnostics**: See i18n issues directly in your editor (Problems panel + squiggles)
- **Hover Provider**: Hover over `t('key')` to see values across all locales
- **CodeLens Actions**: Quick actions to run i18nsmith commands above files with issues
- **Quick Fixes**: Add missing key placeholders directly from the editor
- **Extract String**: Select a hardcoded string and extract it as a translation key
- **Auto-refresh**: Diagnostics update when the report file changes
- **Status Bar**: Quick access to run health checks

## Setup

1. Install the extension (or run in development mode)
2. Ensure you have `i18n.config.json` in your workspace root
3. Run `npx i18nsmith check --report .i18nsmith/check-report.json` to generate the initial report
4. The extension will automatically pick up the report and show diagnostics

## Commands

| Command | Description |
|---------|-------------|
| `i18nsmith: Run Health Check` | Run `i18nsmith check` and generate report |
| `i18nsmith: Sync Locales (Dry Run)` | Run `i18nsmith sync` dry-run |
| `i18nsmith: Sync Current File` | Analyze only the active file using core Syncer with QuickPick preview |
| `i18nsmith: Refresh Diagnostics` | Manually refresh diagnostics from report |
| `i18nsmith: Add Placeholder Key` | Add a TODO placeholder for a missing key |
| `i18nsmith: Extract Selection as Translation Key` | Extract selected string as a new key |
| `i18nsmith: Transform Current File` | Run the transformer on the active file with preview + confirmation |

## Per-file Workflows

### Sync just the active file (`i18nsmith.syncFile`)
1. Open the source file you want to audit in VS Code.
2. Run **Command Palette → “i18nsmith: Sync Current File”** (also available via editor context menu or Quick Actions).
3. The extension runs a **dry-run Syncer** scoped to that file and shows a QuickPick grouped by:
  - `$(diff-added)` entries for missing keys (pre-selected).
  - `$(diff-removed)` entries for unused keys (opt-in by toggling).
4. Adjust selections as needed, then confirm. The extension re-runs Syncer with `write: true`, applies the chosen additions/removals, and refreshes diagnostics/hover caches automatically.
5. Use the Output channel for verbose logs if you enabled verbose logging.

### Transform the active file (`i18nsmith.transformFile`)
1. Place the cursor in the file you want to migrate and open the **Command Palette → “i18nsmith: Transform Current File.”**
2. The transformer runs in **dry-run mode**, producing a modal summary that lists candidate count and sample snippets.
3. Choose **“Apply”** to write changes or **“Dry Run Only”** to inspect without touching files.
4. When applying, the extension updates the source file (ensuring `useTranslation` wiring), seeds locale entries via `LocaleStore`, formats code, and then refreshes diagnostics/hover caches.
5. If you need to undo, rely on the built-in VS Code undo stack or your VCS.

## Quick Fixes (CodeActions)

When you see an i18nsmith diagnostic, click the lightbulb or press `Cmd+.` to see available fixes:

- **Add placeholder for 'key'**: Adds a `[TODO: key]` entry to your source locale
- **Run i18nsmith sync to fix**: Runs the sync command to fix drift
- **Run i18nsmith check**: Re-runs the health check

## Hover Preview

Hover over any `t('key')` call to see a table of values across all locales:

```
| Locale | Value           |
|--------|-----------------|
| en     | Hello           |
| es     | Hola            |
| fr     | ⚠️ *missing*    |
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `i18nsmith.reportPath` | `.i18nsmith/check-report.json` | Path to the report file |
| `i18nsmith.autoRefresh` | `true` | Auto-refresh when report changes |
| `i18nsmith.showCodeLens` | `true` | Show CodeLens actions |

## Development

```bash
# Install dependencies
cd packages/vscode-extension
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Run in VS Code
# Press F5 or use "Run Extension" launch config
```

## Bundle Size

Latest dev build (esbuild) recorded a **17.6 MB** `dist/extension.js` when running `pnpm --filter i18nsmith-vscode run compile` on 2025‑12‑02 after embedding Syncer + Transformer integrations.

## How It Works

1. The extension activates when `i18n.config.json` or `.i18nsmith/` is detected
2. It watches for changes to the report file (default: `.i18nsmith/check-report.json`)
3. When the report changes, it parses the JSON and creates VS Code diagnostics
4. Diagnostics appear in the Problems panel and as squiggles in the editor
5. CodeLens actions appear above files with issues

## Report Schema

The extension expects a JSON report with this structure:

```json
{
  "actionableItems": [
    {
      "kind": "missing-key",
      "severity": "warn",
      "message": "Key 'common.greeting' is missing in locale 'fr'",
      "filePath": "src/App.tsx",
      "line": 10,
      "column": 5,
      "key": "common.greeting"
    }
  ],
  "hasConflicts": false,
  "hasDrift": true
}
```

## Integration with CI

The extension pairs well with the i18nsmith GitHub Action:

```yaml
- uses: IMAGINARY9/i18nsmith@v1
  with:
    command: check
    report-path: .i18nsmith/check-report.json
```

The generated report artifact can be downloaded and viewed locally with the extension.
