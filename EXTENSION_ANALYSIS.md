# i18nsmith Extension Analysis Report

## 1. Functional Analysis

### 1.1 Core Logic (`extension.ts`)
- **Monolithic Structure**: `extension.ts` is extremely large (~3600 lines) and handles too many responsibilities:
  - Command registration & handling
  - UI management (Status Bar, Quick Picks)
  - Business logic for Sync, Transform, Extract
  - Configuration management
  - Event handling
- **State Management**: Global variables (`diagnosticsManager`, `reportWatcher`, `smartScanner`, etc.) are used extensively, making the code hard to test and prone to race conditions during activation/deactivation.
- **Race Conditions**:
  - `smartScanner` runs on activation, but `reportWatcher` also refreshes diagnostics. These might conflict or cause double-updates.
  - `checkCurrentFile` and `runHealthCheckWithSummary` might overlap if triggered simultaneously.

### 1.2 Providers
- **Hover Provider (`hover.ts`)**:
  - **Performance**: Loads all locale files on *every* hover if not cached. While there is some caching (`localeData`), the invalidation strategy is simple (`clearCache`).
  - **Logic**: The regex-based key detection (`t('key')`) is fragile. It doesn't support custom t-function names or complex AST structures (though `SmartScanner` does, the Hover provider seems to duplicate this logic poorly).
  - **Fallback**: The fallback mechanism loops through *all* workspace folders, which can be slow in large multi-root workspaces.
- **CodeLens Provider (`codelens.ts`)**:
  - **Good**: It's lightweight, only showing a summary at the top of the file.
  - **Limitation**: It relies on `diagnosticsManager` which might be stale if the report isn't updated.
- **Diagnostics Manager (`diagnostics.ts`)**:
  - **Efficiency**: Replaces the entire diagnostic collection on update. For large projects, incremental updates would be better.

### 1.3 CLI Integration (`cli-runner.ts`, `preview-manager.ts`)
- **Execution**: Uses `spawn` with a timeout. This is good.
- **Output Parsing**: Relies on parsing stdout/stderr. If the CLI output format changes, the extension breaks.
- **Preview Files**: Generates temporary preview files in `.i18nsmith/previews`. These need to be cleaned up reliably (currently relies on `cleanupPreviewArtifacts` which might not run if the extension crashes).

## 2. Security & Error Handling

### 2.1 Command Injection
- **Risk**: `cli-runner.ts` spawns commands. `resolveCliCommand` constructs the command string.
- **Mitigation**: `quoteCliArg` is used in `command-helpers.ts`.
- **Vulnerability**: If `quoteCliArg` is bypassed or flawed, command injection is possible. The current implementation `value.replace(/(["\\])/g, '\\$1')` is decent for basic cases but might not cover all shell edge cases (especially on Windows vs POSIX).
- **Recommendation**: Use `child_process.spawn` with the `args` array directly instead of constructing a shell command string whenever possible. `runResolvedCliCommand` supports this, but `resolveCliCommand` often returns a single string for `npx`.

### 2.2 Path Traversal
- **Risk**: `normalizeTargetForCli` handles relative paths.
- **Check**: It uses `path.relative` and checks for `..`. This seems safe, preventing access outside the workspace.

### 2.3 Error Handling
- **Gaps**:
  - `loadConfigWithMeta` failures in `extension.ts` often result in a generic error message or silent failure.
  - `fs.readFile` in `hover.ts` lacks specific error handling for permission issues.
  - `JSON.parse` in `preview-manager.ts` could throw on malformed JSON, crashing the command.

## 3. UI/UX Inconsistencies

- **Preview Flows**:
  - **Inconsistent**: "Suspicious Rename" uses a nice Markdown preview. "Transform" uses a Diff view. "Sync" uses a Quick Pick + Output Channel flow.
  - **Fix**: The recent refactor to `preview-flow.ts` is a step in the right direction, but `extension.ts` still contains legacy handling for Transform/Sync that should be migrated to the unified flow.
- **Status Bar**:
  - Updates are sometimes flashy or delayed.
- **Notifications**:
  - Too many information messages (e.g., "Applied X changes"). Some could be status bar updates to be less intrusive.

## 4. Refactoring Recommendations

### 4.1 Architecture (SOLID)
- **Single Responsibility**: Break `extension.ts` into feature-specific controllers:
  - `SyncController`
  - `TransformController`
  - `ExtractionController`
  - `ConfigurationController`
- **Dependency Injection**: Pass dependencies (`DiagnosticsManager`, `OutputChannel`) into constructors instead of using global variables.

### 4.2 Code Duplication
- **Key Detection**: Logic for finding keys exists in `hover.ts`, `scanner.ts` (core), and `extension.ts` (regexes). Centralize this in `@i18nsmith/core` and expose it to the extension.
- **Config Loading**: `loadConfigWithMeta` is called in many places. Use a centralized `ConfigurationService` that caches and provides the config.

### 4.3 Performance
- **Caching**: Implement a robust caching layer for `LocaleStore` in the extension, invalidated only when file watchers detect changes to locale files.
- **Debouncing**: Ensure all expensive operations (scanning, diagnostics refresh) are properly debounced.

## 5. Action Plan

1.  **Refactor `extension.ts`**: Split into smaller controllers.
2.  **Secure CLI Execution**: Audit `quoteCliArg` and prefer array-based `spawn` args.
3.  **Unified Preview**: Migrate "Transform" and "Sync" to use the new `executePreviewPlan` Markdown flow.
4.  **Centralize Logic**: Move key detection regexes/logic to `core` or a shared utility.
5.  **Improve Error Handling**: Wrap critical sections (CLI runs, file I/O) in robust try-catch blocks with user-friendly error reporting.
