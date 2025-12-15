# i18nsmith VS Code Extension

![i18nsmith](https://img.shields.io/badge/i18nsmith-vscode-blue)

TL;DR: Lightweight VS Code integration for i18nsmith — run health checks, sync locales, extract strings, and transform files from inside the editor.

VS Code integration for [i18nsmith](https://github.com/IMAGINARY9/i18nsmith) — automated i18n tooling. Install the VSIX (see "How to test") or use the Marketplace once published.

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
| `i18nsmith: Extract Selection as Translation Key` | Extract selected string as a new key |
| `i18nsmith: Transform Current File` | Run the transformer on the active file with preview + confirmation |
| `i18nsmith: Whitelist Dynamic Keys` | Whitelist dynamic keys found in the last sync |

## Per-file Workflows

### Sync just the active file (`i18nsmith.syncFile`)
1. Open the source file you want to audit in VS Code.
2. Run **Command Palette → "i18nsmith: Sync Current File"** (also available via editor context menu or Quick Actions).
3. The extension runs a **preview sync** scoped to that file and shows a QuickPick grouped by:
  - **Missing keys** (pre-selected for addition): Shows count and sample references
  - **Unused keys** (opt-in by toggling): Shows affected locales
4. Adjust selections as needed, then confirm. The extension shows a **mandatory diff preview** of the locale file changes, then asks for final confirmation before applying.
5. Changes are applied via CLI `--apply-preview`, diagnostics/hover caches refresh automatically.
6. Use the Output channel for verbose logs if you enabled verbose logging.

### Transform the active file (`i18nsmith.transformFile`)
1. Place the cursor in the file you want to migrate and open the **Command Palette → “i18nsmith: Transform Current File.”**
2. The transformer runs in **dry-run mode**, producing a modal summary that lists candidate count and sample snippets.
3. Choose **“Apply”** to write changes or **“Dry Run Only”** to inspect without touching files.
4. When applying, the extension updates the source file (ensuring `useTranslation` wiring), seeds locale entries via `LocaleStore`, formats code, and then refreshes diagnostics/hover caches.
5. If you need to undo, rely on the built-in VS Code undo stack or your VCS.

### Diff Preview

Both **Sync** and **Transform** workflows support inline diff previews:

- **Sync Current File**: After selecting changes in the QuickPick, a diff peek view automatically opens showing the exact locale file changes. Confirm to apply or cancel to abort.
- **Transform Current File**: Shows a diff preview of source code and locale changes before applying.
- **Extract Selection**: Opens diff tabs for every modified file (source + locales) with full context.
- **What it shows**: Unified diffs with syntax highlighting, additions/removals clearly marked.
- **Workflow**: Preview → Confirm → Apply (no "skip preview" option for safety)

## Quick Actions Menu

Press `Cmd+Shift+P` (or `Ctrl+Shift+P` on Windows/Linux) and run **"i18nsmith: Quick Actions"** to access a unified command palette with context-aware actions:

**Drift Statistics**: When locale drift is detected, the Quick Actions menu automatically displays:
- **Placeholder text**: Shows counts like "5 missing keys, 3 unused keys detected — Choose an action"
- **Inline stats**: Sync-related actions show drift counts in their descriptions (e.g., "5 missing, 3 unused — Run i18nsmith sync")
- **Toast notification**: For significant drift (>10 keys), a notification appears before the menu opens

**Available Actions**:
- Extract selection as translation key
- Rename key at cursor
- Apply local fixes (sync with write)
- Export missing translations (CSV handoff)
- Open source locale file
- Sync/transform current file
- Run health check
- Preview sync changes (dry-run)
- Refresh diagnostics
- Show verbose output

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
| `i18nsmith.enableVerboseLogging` | `false` | Enable verbose logging to Output channel for debugging sync/transform operations |

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

Latest dev build (esbuild) recorded a **12.2 MB** `dist/extension.js` when running `pnpm --filter i18nsmith-vscode run compile` on 2025‑12‑11 after embedding Syncer + Transformer integrations.

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

## How to test (Open testing)

Follow these steps to perform a focused open-testing session with the packaged VSIX or a locally built copy:

1. Build and package the extension to a VSIX (from repo root):

```bash
pnpm install --no-frozen-lockfile
pnpm --filter i18nsmith-vscode run compile
cd packages/vscode-extension
npx -y @vscode/vsce package --out ../../i18nsmith-vscode.vsix --no-dependencies
```

2. Install the VSIX in VS Code:

- Open VS Code → Extensions view → … → "Install from VSIX..." → choose `i18nsmith-vscode.vsix`.

3. Prepare a simple workspace for testing:

- Create an `i18n.config.json` in workspace root (example below).
- Add `locales/en.json` and a test source file (see `.github/workflows/test-action.yml` for a minimal fixture).

Example `i18n.config.json`:

```json
{
  "sourceLanguage": "en",
  "targetLanguages": ["es","fr"],
  "localesDir": "./locales",
  "include": ["src/**/*.tsx"]
}
```

4. Generate a report the extension will consume:

```bash
npx i18nsmith check --report .i18nsmith/check-report.json
```

5. Verify extension features in VS Code:

- Open a source file and confirm diagnostics appear (Problems panel + squiggles).
- Test hover preview on `t('key')` calls.
- Use the Command Palette to run: "i18nsmith: Run Health Check", "i18nsmith: Sync Current File", "i18nsmith: Transform Current File", and other commands listed in the Commands section.
- Try the editor context menu actions (Extract selection as translation key) and CodeLens quick actions.

### Quick smoke test checklist

- Install the VSIX or run the extension in the debugger (F5).
- Open a project with `i18n.config.json` and `locales/` present.
- Run `i18nsmith check --report .i18nsmith/check-report.json` and confirm diagnostics appear.
- Run `i18nsmith: Sync Current File` and `i18nsmith: Transform Current File` to exercise UI flows.
- Check the `i18nsmith` Output channel for errors.

6. Smoke checks to perform:

- Confirm diagnostics refresh when `.i18nsmith/check-report.json` is updated.
- Confirm the Sync/Transform dry-run previews show expected diffs and that Apply writes changes and refreshes diagnostics.
- Confirm undo/VS Code's undo stack works after applying transforms.

If you spot runtime errors or missing behavior, capture the Output channel logs (View → Output → select "i18nsmith") and attach them to the GitHub issue.

## Privacy & Telemetry

- Short statement: This extension does not collect or transmit telemetry, usage analytics, or source code to external services by default. All diagnostic data and logs remain local to the user's environment (Output channel and files in the workspace).
- Verbose logging: Enabling `i18nsmith.enableVerboseLogging` only increases local logging to the `i18nsmith` Output channel; it does not send logs to a remote server.
- Opt-in uploads: If future features add optional upload or remote diagnostics, they will be explicitly documented and require opt-in consent. No automatic uploads occur without explicit, documented user action.

If your organization requires a formal privacy policy, link it from the repository `homepage` or add a `PRIVACY.md` with the required legal text.

## Reporting issues & open testing feedback

- Open an issue at: https://github.com/IMAGINARY9/i18nsmith/issues
- When filing issues during open testing, please include:
  - VS Code version and platform
  - Extension version (found in `Help → About` or `Extensions` view)
  - Steps to reproduce
  - Attach `.i18nsmith/check-report.json` (if applicable)
  - The `i18nsmith` Output channel contents (copy/paste)

Label feature requests as `enhancement` and runtime bugs as `bug` to help triage. If you want a dedicated testing/discussion channel, we can add a DISCUSSION template or use GitHub Discussions.

## Publishing to the Visual Studio Marketplace (automation)

An optional workflow (`.github/workflows/publish-to-marketplace.yml`) is included that will publish the extension when a GitHub Release is published.

Requirements:

- A repository secret named `VSCE_TOKEN` that contains a Personal Access Token (PAT) for publishing to the Visual Studio Marketplace. Create the token according to the `@vscode/vsce` documentation and add it to GitHub → Settings → Secrets → Actions.
- Ensure the `publisher` field in `packages/vscode-extension/package.json` matches the Marketplace publisher id that will own the extension.

Workflow behavior and safety:

- The workflow triggers on `release` events (when you publish a GitHub Release). It builds the extension, runs `@vscode/vsce publish` using the token, and uploads a VSIX artifact.
- Publishing from a release reduces accidental publishes; we recommend creating a Draft release and verifying the produced VSIX artifact before publishing it to the Marketplace.

Manual publish alternative:

If you prefer manual publishing, you can publish locally with:

```bash
cd packages/vscode-extension
npx -y @vscode/vsce publish --pat <YOUR_TOKEN>
```

This will package and publish the extension using the token you provide.

## Troubleshooting

- "code: command not found": enable the `code` CLI from VS Code (Cmd+Shift+P → "Shell Command: Install 'code' command in PATH") or create a symlink to the app bundle. See the project root README for exact commands.
- Packaging fails (vsce errors): ensure `packages/vscode-extension/LICENSE` exists and run `pnpm --filter i18nsmith-vscode run compile` before packaging.
- Large bundle size: If runtime errors relate to missing modules, confirm workspace dependencies are built and that `esbuild` bundles required code. Use `pnpm -r build` at repo root to build workspace packages.

If you need help with any of these steps I can update the README further or add scripts to simplify packaging and local testing.


