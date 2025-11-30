# i18nsmith VS Code Extension

VS Code integration for [i18nsmith](https://github.com/IMAGINARY9/i18nsmith) - automated i18n tooling.

## Features

- **Inline Diagnostics**: See i18n issues directly in your editor
- **CodeLens Actions**: Quick actions to run i18nsmith commands
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
| `i18nsmith: Refresh Diagnostics` | Manually refresh diagnostics from report |

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
