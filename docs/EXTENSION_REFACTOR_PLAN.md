# Extension Refactoring Master Plan

## Objective
Modernize the `i18nsmith-vscode` extension to improve maintainability, security, performance, and user experience. This plan addresses findings from the [Extension Analysis](../EXTENSION_ANALYSIS.md).

## Phase 1: Architecture & Decoupling (Foundation)
**Goal:** Break the monolithic `extension.ts` into manageable, single-responsibility controllers.

### 1.1. Dependency Injection Setup
- Create a `ServiceContainer` or simple DI pattern to manage singletons (`DiagnosticsManager`, `OutputChannel`, `ConfigurationService`).
- Remove global variables in `extension.ts`.

### 1.2. Controller Extraction
Extract logic from `extension.ts` into dedicated classes:
- **`SyncController`**: Handles `i18nsmith.sync`, `syncFile`, and related commands.
- **`TransformController`**: Handles `i18nsmith.transformFile` and candidate detection.
- **`ExtractionController`**: Handles `extractKey`, `extractSelection`.
- **`ConfigurationController`**: Manages `i18n.config.json` watching, loading, and caching.
- **`QuickActionsController`**: Manages the `i18nsmith.actions` menu.

### 1.3. Centralized Configuration
- Create `ConfigurationService` to wrap `loadConfigWithMeta`.
- Implement caching with proper invalidation (file watcher).

## Phase 2: Unified Preview Flow (UX)
**Goal:** Standardize all destructive actions on the "Preview & Apply" pattern using the new `preview-flow.ts`.

### 2.1. Migrate Legacy Previews
- **Sync**: Convert `runSync` to use `executePreviewPlan` (Markdown report) instead of the current custom flow.
- **Transform**: Convert `runTransformCommand` to use `executePreviewPlan`.
- **Rename**: Ensure `SuspiciousRenamePreviewProvider` aligns with the unified flow or is subsumed by it.

### 2.2. Retire Legacy Code
- Remove `preview-manager.ts` (the old stdout-parsing version) once all commands use the new flow.
- Remove ad-hoc diff logic in `extension.ts`.

## Phase 3: Security & Robustness (Safety)
**Goal:** Eliminate command injection risks and improve error resilience.

### 3.1. Secure CLI Execution
- Refactor `cli-runner.ts` to strictly enforce `string[]` arguments for `spawn`.
- Remove `resolveCliCommand`'s string-returning signature in favor of `{ command: string, args: string[] }`.
- Audit and replace all usages of `quoteCliArg` with direct array arguments where possible.

### 3.2. Robust Error Handling
- Implement a `ErrorHandler` service to standardize error reporting (Toast vs Output Channel).
- Wrap critical paths (CLI execution, File I/O) in try-catch blocks that use `ErrorHandler`.

## Phase 4: Performance & Providers (Polish)
**Goal:** Make the extension feel snappy and lightweight.

### 4.1. Optimize Hover Provider
- **Caching**: Implement a robust `LocaleCache` that persists across hovers and invalidates only on file changes.
- **Logic**: Replace regex-based `findKeyAtPosition` with a shared AST-based or smarter regex utility from `@i18nsmith/core`.

### 4.2. Optimize Diagnostics
- **Incremental Updates**: Update `DiagnosticsManager` to handle per-file updates instead of full-workspace clears where possible.

### 4.3. Centralize Key Detection
- Move key detection logic (used by Hover, Definition, and Scanner) to a shared `KeyDetector` utility in `@i18nsmith/core` or `packages/vscode-extension/src/utils`.

## Execution Order
1.  **Phase 1.1 & 1.2**: Critical for code health.
2.  **Phase 3.1**: Critical for security.
3.  **Phase 2**: High impact on UX.
4.  **Phase 4**: Optimization.
