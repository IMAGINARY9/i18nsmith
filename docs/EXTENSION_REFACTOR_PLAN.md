# Implementation Plan: Extension Quick Actions Redesign

## Objective
Refactor VS Code extension quick actions to use a unified "Preview & Apply" workflow. This ensures all destructive operations (sync, transform, rename) are safe, transparent, and consistent.

## Core Concept
Instead of running commands blindly or relying on simple dry-runs, the extension will:
1.  **Preview**: Run the CLI command with a new `--preview-output <file>` flag.
2.  **Visualize**: Display a structured summary (files changed, keys added/removed) and offer to open diffs.
3.  **Apply**: Execute the change atomically using `--apply-preview <file>` (or a verified re-run).

## 1. CLI Enhancements (Prerequisite)
We need to update the CLI to support the preview/apply protocol.

### 1.1. New Flags
*   `--preview-output <path>`:
    *   Runs the command in dry-run mode.
    *   Generates a JSON report containing:
        *   `command`: The original command string.
        *   `timestamp`: ISO string.
        *   `workingTreeHash`: Git hash (or simple file fingerprint) to ensure safety.
        *   `summary`: Human-readable summary (e.g., "3 keys added").
        *   `diffs`: Map of `filepath` -> `unified diff content`.
        *   `patchesDir`: Path to a directory containing generated `.patch` files (optional, but good for large diffs).
    *   Exits with 0.
*   `--apply-preview <path>`:
    *   Reads the preview JSON.
    *   Verifies the workspace hasn't changed significantly (optional but recommended).
    *   Applies the changes (either by re-running the logic with `--write` or applying patches).
    *   *Note:* For V1, re-running with `--write` is acceptable if we can guarantee deterministic behavior, but applying patches is safer.

### 1.2. Affected Commands
*   `sync`
*   `transform`
*   `rename-key`
*   `translate`

## 2. VS Code Extension Redesign

### 2.1. Unified `PreviewService`
Create a service to handle the preview flow:
```typescript
interface PreviewResult {
  summary: string;
  diffs: Record<string, string>;
  previewFile: string;
}

class PreviewService {
  async runPreview(command: string, args: string[]): Promise<PreviewResult>;
  async showPreview(result: PreviewResult): Promise<'apply' | 'cancel' | 'diff'>;
  async applyPreview(previewFile: string): Promise<void>;
}
```

### 2.2. Quick Actions Refactor (`i18nsmith.actions`)
Update `showQuickActions` to use the `PreviewService`.

*   **Current Flow**:
    *   User selects "Apply local fixes".
    *   Extension runs `i18nsmith sync --write` directly (or dry-run then prompts).
*   **New Flow**:
    *   User selects "Apply local fixes".
    *   Extension runs `i18nsmith sync --preview-output .i18nsmith/preview.json`.
    *   Extension shows: "Preview: 5 keys to add. [Apply] [Show Diffs] [Cancel]".
    *   **Apply**: Runs `i18nsmith sync --apply-preview .i18nsmith/preview.json`.
    *   **Show Diffs**: Opens a diff view (virtual document) of the changes.

### 2.3. Specific Command Updates

| Command | Current Behavior | New Behavior |
| :--- | :--- | :--- |
| `i18nsmith.sync` | Runs dry-run, prints to output. | Runs preview, shows toast with "Apply" button. |
| `i18nsmith.syncFile` | Runs dry-run on file. | Runs preview on file, shows toast with "Apply". |
| `i18nsmith.transformFile` | Runs dry-run on file. | Runs preview on file, shows toast with "Apply". |
| `i18nsmith.renameKey` | Prompts for name, runs `--write`. | Prompts for name, runs preview, confirms rename. |
| `i18nsmith.actions` | Lists commands. | Lists commands; selecting one triggers the preview flow. |

### 2.4. UI/UX Details
*   **Toast Notifications**: Use `vscode.window.showInformationMessage` with custom actions ("Apply", "Review").
*   **Output Channel**: Always log the raw CLI output for debugging.
*   **Diff View**: Use `vscode.commands.executeCommand('vscode.diff', ...)` to show side-by-side diffs for complex changes.

## 3. Implementation Steps

1.  **CLI**: Implement `--preview-output` in `packages/cli/src/commands/sync.ts` (and others).
    *   *Task*: Serialize `SyncSummary` + diffs to JSON.
2.  **CLI**: Implement `--apply-preview` (or just support the flow via re-run for now).
    *   *Decision*: For V1, we will implement "Apply" in the extension by simply re-running the command with `--write`. This avoids complex patch application logic in the CLI for now, while still giving the user a "Preview first" experience.
    *   *Refined Plan*: Extension runs `cmd --preview-output ...`. User confirms. Extension runs `cmd --write`.
3.  **Extension**: Create `PreviewManager` class.
4.  **Extension**: Update `extension.ts` to route commands through `PreviewManager`.
5.  **Extension**: Add "Review" button logic to open a diff.

## 4. Todo List
- [ ] CLI: Add `--preview-output` support to `sync` command.
- [ ] CLI: Add `--preview-output` support to `transform` command.
- [ ] Extension: Implement `PreviewManager`.
- [ ] Extension: Refactor `i18nsmith.sync` to use `PreviewManager`.
- [ ] Extension: Refactor `i18nsmith.actions` to use `PreviewManager`.
