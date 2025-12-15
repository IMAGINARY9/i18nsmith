# Post-Testing Analysis 5: Bug Analysis & Improvement Plan

**Date:** 15 December 2025
**Focus:** Bug fixes, UI improvements, and Scanner performance.

## 1. Bug: "Whitelist Dynamic Keys" Persistence

**Issue:**
After running "Whitelist dynamic keys", the action reappears, or the CLI reports "All dynamic key warnings are already whitelisted" while the UI still shows them.

**Analysis:**
- The `whitelistDynamicKeys` command updates `i18n.config.json` and persists the changes.
- However, the `collectDynamicKeyWarnings` function (used by `showQuickActions`) relies on `lastSyncDynamicWarnings` or the `diagnosticsManager` report.
- If the `smartScanner` or `reportWatcher` does not refresh immediately (or fails to refresh), the UI continues to use stale data.
- The CLI check inside `whitelistDynamicKeys` correctly identifies that the keys are now whitelisted (hence the message "All dynamic key warnings are already whitelisted"), but the *entry point* (the Quick Pick item) remains visible because the diagnostics haven't cleared.

**Proposed Fix:**
1.  **Force Diagnostic Invalidation:** Immediately after `persistDynamicKeyAssumptions` succeeds, explicitly clear `lastSyncDynamicWarnings` and force the `diagnosticsManager` to invalidate its cache for dynamic warnings *before* waiting for the background scan.
2.  **Optimistic UI Update:** Manually remove the whitelisted warnings from the current diagnostic collection so the "Whitelist dynamic keys" action disappears instantly.
3.  **Reliable Refresh:** Ensure `smartScanner.scan('whitelist-dynamic')` is awaited and any errors are handled gracefully, potentially falling back to a full `reportWatcher.refresh()`.

## 2. UI Improvement: "Rename Suspicious Keys" Workflow

**Issue:**
The current "Rename suspicious keys" workflow uses a modal dialog (`vscode.window.showInformationMessage`) to show the plan, which is described as a "deprecated preview ui". Users prefer the flow used by "Extract hardcoded text" or "Apply local fixes".

**Analysis:**
- `runSuspiciousRenameFlow` currently builds a text summary and shows it in a modal.
- Users want a non-blocking preview (e.g., a diff view or a document) and a "Apply" action that is easily accessible but not blocking.

**Proposed Fix:**
1.  **Adopt Preview Pattern:** Instead of a modal, generate a **Rename Plan Preview** (Markdown or Diff).
    - **Option A (Diff):** Use `vscode.diff` to show a virtual document representing the "before" and "after" state of the `locales` file (and potentially source files, though that's harder for multiple files).
    - **Option B (Markdown Document):** Open a read-only Markdown document listing the proposed renames (similar to the current modal detail but in a full editor).
2.  **Non-Blocking "Apply":**
    - Show a notification (Toast) with "Apply Renames" and "Cancel" buttons.
    - Or, add a "CodeLens" or "Button" in the preview document itself (if using a Webview or custom provider).
    - The notification approach is consistent with "Apply local fixes".
3.  **Flow:**
    - User clicks "Rename suspicious keys".
    - Extension calculates renames.
    - Extension opens "Rename Preview" editor.
    - Extension shows "Review the plan. Click Apply to proceed." notification.
    - User clicks "Apply".
    - Extension runs the rename command and closes the preview.

## 3. Performance: Preview Stuck & Scanner "Missing Text"

**Issue:**
- **Preview Stuck:** The CLI logs "Applying transforms X/303" line-by-line, creating verbose output that might overwhelm the extension's output parser or UI. The diff often shows few changes despite many "applied" transforms.
- **Missing Text:** The scanner reportedly misses text when a "huge batch" is detected.

**Analysis:**
- **Verbose Logging:** The CLI's `createProgressLogger` writes newlines when not in TTY mode. For 300+ items, this is 300+ lines of log output.
- **False "Applied" Counts:** The `Transformer` counts an item as "applied" even if the transformation resulted in no change (e.g., replacing text with identical key/text). This confuses the user (303 applied vs 1 diff).
- **Memory Pressure (Missing Text):**
    - The `transform` command runs with `collectNodes: true`.
    - `Scanner.scan` loads **all** target files into memory (via `ts-morph` Project) to collect nodes.
    - For large repositories ("huge batch"), this likely causes memory pressure.
    - `ts-morph` keeps full ASTs in memory. If the process hits memory limits, it might behave erratically or fail silently (though usually it crashes).
    - The "missing text" might also be due to the `forEachDescendant` traversal skipping nodes or hitting stack limits in deep trees, or simply the scanner stopping early due to an unhandled exception in a specific file.

**Proposed Fix:**
1.  **Streaming Transformation** *(✅ Done 17 Dec 2025)*
    - `Transformer.run` now executes as a deliberate two-pass stream: the first pass performs a lightweight scan (no AST retention) to prepare candidate metadata and dedupe keys, and the second pass re-hydrates **only** the files that still have pending/existing work, mutates them, saves, formats, and immediately forgets the AST.
    - This "Scan → Transform → Save → Forget" loop keeps a single SourceFile in memory at any time, fixes the "missing text" failure mode in huge batches, and preserves the accurate per-candidate summary via the metadata cache.
2.  **Fix Progress Logging** *(re-reviewed 17 Dec 2025)*
    - The throttled logger from the previous iteration remains unchanged, but the new two-pass streaming approach feeds it an accurate total before the apply stage, so the percentage counter no longer stalls or regresses even for very large projects.
3.  **Accurate Stats** *(✅ Done 17 Dec 2025)*
    - Update `Transformer` to check if a change *actually* happened before incrementing "applied". If no change, increment "skipped" or "no-op".
    - Implemented by normalizing JSX snippets inside `packages/transformer/src/transformer.ts` so that `applyCandidate` now detects whitespace-only or formatting-only rewrites and leaves those candidates marked as skipped. This keeps CLI progress stats aligned with the real diff and avoids reporting hundreds of "applied" transforms when the source already referenced the desired key shape.

## 4. Summary of Action Items

| Priority | Component | Task |
| :--- | :--- | :--- |
| **High** | **Extension** | Fix "Whitelist dynamic keys" state sync (invalidate diagnostics immediately). |
| **High** | **Extension** | Refactor "Rename suspicious keys" to use a non-modal Preview + Apply notification flow. |
| **Medium** | **CLI/Core** | Refactor `Transformer` to support streaming file processing (Scan-Transform-Forget loop) to fix memory issues and "missing text". *(Done)* |
| **Medium** | **CLI** | Throttle progress logging in non-TTY environments to prevent "stuck" UI perception. *(Done)* |
| **Low** | **CLI** | Improve "Applied" stats to reflect actual changes. *(Done)* |

