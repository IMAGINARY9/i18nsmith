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

---

## 🔄 Potential Future Integrations

### 5. Syncer Integration (Planned)
**Current State**: Extension uses CLI subprocess via `runCliCommand`  
**Opportunity**: Direct core Syncer usage for structured output

**Benefits**:
- Access to diff details (added/removed/changed keys) without JSON parsing
- Richer progress indicators during sync operations
- Ability to show sync preview in extension UI (like Git diff)

**Implementation Strategy**:
```typescript
// Proposed: Direct syncer usage
import { Syncer } from '@i18nsmith/core';

const syncer = new Syncer(config);
const result = await syncer.sync({ dryRun: true });
// result.added: string[], result.removed: string[], result.changed: string[]

// Show structured preview in webview or QuickPick
```

**Files to Modify**:
- `src/extension.ts`: Replace `runSync` CLI exec with direct Syncer call
- Add sync preview Quick Pick showing added/removed keys before write

### 6. Transformer Integration (Planned)
**Current State**: Extension calls CLI for extraction workflow  
**Opportunity**: Direct Transformer usage for extract-to-key workflow

**Benefits**:
- Show live preview of transformed code before writing
- Access to full AST context for better key suggestions
- Ability to offer multiple transformation strategies (inline vs hook vs component)

**Implementation Strategy**:
```typescript
// Proposed: Direct transformer usage
import { transform } from '@i18nsmith/transformer';

const originalCode = editor.document.getText();
const transformed = await transform(originalCode, {
  target: [editor.document.uri.fsPath],
  keyGenerator: generator,
});

// Show diff preview, let user confirm before writing
```

**Files to Modify**:
- `src/extension.ts`: Refactor `extractKeyFromSelection` to use core transformer
- Add preview UI for transformation results

### 7. ReferenceExtractor Integration (Potential)
**Current State**: Scanner runs CLI check, reads JSON report  
**Opportunity**: Direct ReferenceExtractor for inline diagnostics

**Benefits**:
- Real-time diagnostics without CLI subprocess
- Faster background scanning (no process spawn overhead)
- Access to AST node positions for precise diagnostics

**Implementation Strategy**:
```typescript
// Proposed: Direct reference extraction
import { ReferenceExtractor } from '@i18nsmith/core';

const extractor = new ReferenceExtractor(config);
const references = await extractor.extract([filePath]);
// references: Array<{ key: string, filePath: string, line: number, column: number }>

// Convert to VSCode Diagnostics directly
```

**Considerations**:
- Current CLI-based approach handles bundler/transpiler compatibility (TypeScript, JSX, Vue, Svelte)
- Direct AST parsing would require bundling all parsers into extension (bundle size concern)
- **Recommendation**: Keep CLI-based scanning for now; revisit if bundle size allows parser inclusion

### 8. Per-File Onboarding Commands (Planned)
**Current State**: Extension lacks per-file transform/sync commands  
**Opportunity**: Leverage core's `--target` support for incremental i18n adoption

**Benefits**:
- Users can i18n-ify one component at a time without affecting entire workspace
- Safer onboarding flow for large codebases
- Aligns with implementation-plan.md Phase 3.14

**Implementation Strategy**:
```typescript
// Proposed: Per-file transform command
vscode.commands.registerCommand('i18nsmith.transformFile', async () => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  
  const transformer = new Transformer(config);
  const result = await transformer.transform({
    target: [editor.document.uri.fsPath],
    dryRun: true,
  });
  
  // Show preview, confirm, write
});

// Proposed: Per-file sync command
vscode.commands.registerCommand('i18nsmith.syncFile', async () => {
  const summary = await checkIntegration.checkFile(workspaceRoot, filePath);
  // summary already scoped to target file via CheckRunner --target
});
```

**Commands to Add**:
- `i18nsmith.transformFile`: Transform current file to i18n (preview + confirm)
- `i18nsmith.syncFile`: Sync locale keys for current file only (already implemented via `checkFile`)
- Context menu: "i18nsmith: Onboard This File"

**Files to Modify**:
- `src/extension.ts`: Add command registrations
- `package.json`: Add commands to contributes.commands and editor/context menu

---

## 📊 Integration Impact Summary

| Module | Status | Bundle Impact | Maintenance Benefit | User Benefit |
|--------|--------|---------------|---------------------|--------------|
| **KeyGenerator** | ✅ Integrated | +0.2MB | No custom slug logic | Consistent keys with CLI |
| **LocaleStore** | ✅ Integrated | +0.5MB | No custom JSON I/O | Respects format config |
| **CheckRunner** | ✅ Integrated | +2.0MB | No CLI subprocess for checks | Faster per-file diagnostics |
| Syncer | 🔄 Planned | +1.0MB | Structured diff output | Rich sync preview UI |
| Transformer | 🔄 Planned | +1.5MB | No CLI exec for extract | Live transform preview |
| ReferenceExtractor | ⚠️ Defer | +3.0MB (parsers) | Real-time diagnostics | Faster background scan |

**Current Bundle Size**: 12.1MB (with KeyGenerator, LocaleStore, CheckRunner)  
**Expected After All Integrations**: ~15-16MB (Syncer + Transformer added)

**Recommendation**: Proceed with Syncer and Transformer integrations. Defer ReferenceExtractor due to parser bundle size; CLI-based scanning is sufficient for now.

---

## 🎯 Next Steps

### Immediate (This Session)
1. ✅ Wire CheckIntegration into extension.ts (completed)
2. ✅ Add `i18nsmith.checkFile` command (completed)
3. 🔄 Test `checkFile` command in Extension Development Host
4. 📝 Document per-file onboarding workflow in extension README

### Short-Term (Next Session)
1. Integrate Syncer for structured sync output
2. Add sync preview UI (QuickPick showing added/removed keys)
3. Add `i18nsmith.transformFile` command with preview
4. Context menu: "Onboard This File" workflow

### Long-Term (Future)
1. Evaluate ReferenceExtractor integration (monitor bundle size)
2. Consider webview-based UI for complex operations (sync diff, transform preview)
3. Explore Language Server Protocol (LSP) for real-time diagnostics across IDEs

---

## 📝 Notes

- All integrations honor workspace config via `loadConfig(workspaceRoot)`
- Extension now uses `@i18nsmith/core` via `workspace:*` pnpm protocol
- Bundle size increased from ~1MB to 12.1MB after core integrations (expected; core contains full i18n tooling)
- CLI-based workflows still available for commands not yet migrated (transform, sync)
- CheckIntegration wrapper enables gradual migration from CLI to core APIs

---

**Last Updated**: 2025-01-XX  
**Contributors**: GitHub Copilot AI Assistant, i18nsmith maintainer
