# VS Code Extension ↔ Core Integration Roadmap

This document tracks the integration of `@i18nsmith/core` modules into the VS Code extension to eliminate code duplication and ensure consistent behavior between CLI and extension.

## ✅ Completed Integrations

### 1. KeyGenerator Integration (codeactions.ts)
**Purpose**: Generate consistent suspicious key suggestions using core's KeyGenerator  
**Benefits**:
- Respects workspace config (namespace, hashLength)
- Eliminates custom slug/hash logic duplication
- Ensures extension suggestions match CLI output

**Implementation**:
```typescript
// Before: Custom slug generation
const slug = text.toLowerCase().replace(/\W+/g, '-').slice(0, 20);

// After: Core KeyGenerator with config
const config = await loadConfig(workspaceRoot);
const generator = new KeyGenerator(config);
const suggestion = generator.generate(text);
```

### 2. LocaleStore Integration (codeactions.ts)
**Purpose**: Add placeholders to locale files using core's LocaleStore  
**Benefits**:
- Respects workspace config (format: flat/nested, delimiter, sortKeys)
- Eliminates custom nested value insertion
- Ensures consistent locale file formatting with CLI

**Implementation**:
```typescript
// Before: Manual JSON read/write with custom setNestedValue
const localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
setNestedValue(localeData, key, '{{PLACEHOLDER}}');
fs.writeFileSync(localePath, JSON.stringify(localeData, null, 2));

// After: LocaleStore handles format, delimiter, sorting
const store = await LocaleStore.fromFile(localePath, config.i18n);
store.upsert(key, '{{PLACEHOLDER}}');
await store.flush();
```

### 3. LocaleStore Integration (hover.ts)
**Purpose**: Load locale values for hover tooltips using core's LocaleStore  
**Benefits**:
- Handles both flat and nested locale formats automatically
- Pre-flattens keys for consistent lookup (no custom traversal)
- Respects delimiter config from workspace

**Implementation**:
```typescript
// Before: Direct fs reads with custom nested value extraction
const localeData = JSON.parse(fs.readFileSync(localePath, 'utf-8'));
const value = getNestedValue(localeData, key, delimiter);

// After: LocaleStore handles flattening and format detection
const store = await LocaleStore.fromFile(localePath, config.i18n);
const flatKeys = store.flatten();
const value = flatKeys[key];
```

### 4. CheckRunner Integration (check-integration.ts)
**Purpose**: Run diagnostics directly through core CheckRunner (no CLI subprocess)  
**Benefits**:
- Enables per-file checks (`checkFile` method with --target semantics)
- Provides structured CheckSummary output for richer UI
- Access to actionable commands without JSON parsing

**Implementation**:
```typescript
// NEW: Direct core integration
import { CheckRunner } from '@i18nsmith/core';

const runner = new CheckRunner(workspaceRoot, config);
const summary = await runner.run({ target: [filePath] });
const issues = summary.actionableItems.filter(item => item.filePath === filePath);
```

**Commands Added**:
- `i18nsmith.checkFile`: Check current file without full workspace scan
- Context menu integration for per-file diagnostics

### 5. Syncer Integration (extension.ts + sync-integration.ts)
**Purpose**: Replace CLI-based `sync` runs with the core `Syncer` and surface an interactive preview before applying locale changes.  
**Benefits**:
- Eliminates shelling out to `npx i18nsmith sync`, reducing latency and noise in the output channel
- Provides structured `SyncSummary` data for the UI (missing keys, unused keys, placeholder issues, backups)
- Adds a QuickPick workflow so users can cherry-pick additions/removals before writing to disk

**Implementation Highlights**:
- New `SyncIntegration` helper wraps `Syncer.run`, normalizes targets for multi-root workspaces, and exposes dry-run/apply variants.
- `runSync` now runs a background preview, opens a QuickPick with all missing/unused keys (pre-selected additions), and then re-runs Syncer with the user’s selections.
- Added `i18nsmith.syncFile` for scoped syncs using `targets`, plus quick-action entries and status notifications.

### 6. Transformer Integration (extension.ts)
**Purpose**: Offer a per-file extract-to-key workflow powered by `@i18nsmith/transformer` without invoking the CLI.  
**Benefits**:
- Shows pending candidates (location, suggested key, snippet) before writing
- Gives authors a modal confirmation flow with optional “dry run only” preview
- Keeps locale updates in lock-step with source edits by reusing the same `Transformer` + `LocaleStore` stack as the CLI

**Implementation Highlights**:
- Added `i18nsmith.transformFile` command (command palette + editor context menu).
- Uses `loadConfigWithMeta` to respect config roots discovered above the workspace folder and instantiates `Transformer` with that root.
- After applying, refreshes diagnostics, hover cache, and background scanner so UX stays in sync.

### 8. Per-File Onboarding Commands (extension.ts + package.json)
**Purpose**: Streamline incremental adoption workflows inside VS Code.  
**Benefits**:
- Dedicated commands + context menu items for “Sync current file” and “Transform current file” lower the barrier for gradual migrations.
- Quick Actions now surface these entries so users can fix issues without leaving the editor.

**Implementation Highlights**:
- New commands registered in `extension.ts` and exposed via `package.json` contributes.
- Quick Actions include onboarding entries alongside existing scan/diagnostic shortcuts.
- Menu contributions ensure the commands appear only for supported language IDs.

---

## 🔄 Potential Future Integrations

### 7. ReferenceExtractor Integration (Potential)
**Current State**: Scanner still shells out to the CLI for report generation.  
**Opportunity**: Move background diagnostics to an in-process `ReferenceExtractor` for faster, more precise feedback.

**Benefits**:
- Real-time diagnostics without CLI subprocess latency
- Access to AST node positions for pinpoint squiggles + code actions
- Enables per-file "live" scans without generating `.i18nsmith/check-report.json`

**Implementation Strategy**:
```typescript
import { ReferenceExtractor } from '@i18nsmith/core';

const extractor = new ReferenceExtractor(config);
const references = await extractor.extract(targetFiles);
diagnosticsManager.applyReferences(references);
```

**Considerations**:
- Requires bundling parser dependencies for TS/JS/JSX/Vue/Svelte; monitor bundle size closely.
- Until parsers are tree-shaken aggressively, keep CLI-based scanning as the default path.

### 9. Verbose Logging Toggle (Completed ✅)
**Purpose**: Enable opt-in verbose logging to diagnose field bugs and capture Syncer/Transformer operations.  
**Benefits**:
- Helps users and maintainers debug sync/transform issues without requiring code changes
- Logs key workflow points: previews, selections, writes, completions
- Controlled via `i18nsmith.enableVerboseLogging` setting (default: false)

**Implementation**:
```typescript
// Extension setting in package.json
"i18nsmith.enableVerboseLogging": {
  "type": "boolean",
  "default": false,
  "description": "Enable verbose logging to the Output channel for debugging sync and transform operations"
}

// Helper function in extension.ts
function logVerbose(message: string) {
  const config = vscode.workspace.getConfiguration('i18nsmith');
  if (config.get<boolean>('enableVerboseLogging')) {
    verboseOutputChannel?.appendLine(`[${new Date().toISOString()}] ${message}`);
  }
}

// Instrumented at key points:
logVerbose('runSync: Starting preview...');
logVerbose('transformCurrentFile: Write complete - 5 applied');
```

**Status**: Completed. Output visible in "i18nsmith (Verbose)" output channel when setting enabled.

### 10. Diff Preview Surfaces (Potential)
**Current State**: QuickPick sync flow lists keys but doesn’t show diffs; transform confirmations only include textual summaries.  
**Opportunity**: Render structured diffs (or inline patches) using existing `SyncSummary.diffs` / `TransformSummary.diffs` data.

**Potential UX**:
- Webview panel or inline preview listing locale patches before apply
- Optional "copy patch" action for PR descriptions
- Extend transform confirmation to show highlighted code change snippets

### 11. Diagnostics Telemetry (Potential)
### 11. Diagnostics Telemetry (Potential)
**Current State**: Console logging is minimal beyond verbose toggle; no persistent performance tracking.  
**Opportunity**: Add opt-in telemetry for perf counters (Syncer/Transformer runtimes, selections, failures) to aid debugging and analysis (no PII).

**Implementation Ideas**:
- Perf counters for Syncer run duration, candidate counts, QuickPick accept rates
- Lightweight telemetry interface that extension tests can hook for assertions
- Export anonymized metrics to local log file or extension-provided dashboard

---

## 📊 Integration Impact Summary

| Module | Status | Bundle Impact | Maintenance Benefit | User Benefit |
|--------|--------|---------------|---------------------|--------------|
| **KeyGenerator** | ✅ Integrated | +0.2MB | No custom slug logic | Consistent keys with CLI |
| **LocaleStore** | ✅ Integrated | +0.5MB | No custom JSON I/O | Respects format config |
| **CheckRunner** | ✅ Integrated | +2.0MB | No CLI subprocess for checks | Faster per-file diagnostics |
| **Syncer** | ✅ Integrated | +1.0MB | Structured diff output, no shell exec | Interactive QuickPick preview + scoped syncs |
| **Transformer** | ✅ Integrated | +1.5MB | No CLI exec for extract | Per-file onboarding with preview/confirm |
| **Verbose Logging** | ✅ Integrated | +0.0MB | Configurable debug output | Easier troubleshooting |
| **ReferenceExtractor** | ⚠️ Defer | +3.0MB (parsers) | Real-time diagnostics | Faster background scan |

**Current Bundle Size**: 17.6 MB (`pnpm --filter i18nsmith-vscode run compile`, 2025‑12‑02) with Syncer + Transformer embedded.  
**Expected After Remaining Integrations**: ~13-14 MB without ReferenceExtractor once dead code pruning + shared parser dedupe is applied; leave ReferenceExtractor deferred unless this budget increases.

**Recommendation**: Focus future work on ReferenceExtractor only if bundle budgets allow; otherwise double down on UX polish/testing for the new commands.

---

## 🎯 Next Steps

### Immediate (This Session)
1. ✅ Flesh out README/docs with step-by-step guides (and gifs/screenshots) for `i18nsmith.syncFile` + `i18nsmith.transformFile` flows.
2. ✅ Implement verbose logging toggle with `enableVerboseLogging` setting.
3. 📈 Enhance Quick Actions to summarize drift counts (missing/unused) before opening the QuickPick.

### Short-Term (Next Session)
1. 🪟 Prototype diff previews (webview or inline) sourced from `SyncSummary.diffs` / `TransformSummary.diffs`.
2. 📊 Implement optional telemetry sink for performance tracking (if needed).
3. 🧪 Dogfood the QuickPick sync workflow in the `i18nsmith-ext-test` multi-root sandbox; capture console logs + friction notes.

### Long-Term (Future)
1. Evaluate ReferenceExtractor integration (monitor bundle size, parser impact, and need for AST fidelity).
2. Explore Language Server Protocol (LSP) support so the same core integrations power other IDEs without duplicating VS Code glue.

---

## 📝 Notes

- All integrations now honor workspace config via `loadConfigWithMeta`, so configs discovered outside the VS Code workspace are handled gracefully.
- Extension consumes `@i18nsmith/core` + `@i18nsmith/transformer` via `workspace:*` for zero-dup builds.
- Bundle size jumped from ~1MB to ~12MB after the early integrations; re-check after bundling the new Syncer/Transformer code paths.
- CLI workflows remain available for power users, but extension features default to in-process integrations for better UX.
- New commands (`i18nsmith.sync`, `i18nsmith.syncFile`, `i18nsmith.transformFile`) refresh diagnostics + caches automatically to keep the UI aligned.

---

**Last Updated**: 2025-01-XX  
**Contributors**: GitHub Copilot AI Assistant, i18nsmith maintainer
