# Implementation Plan: i18nsmith

**Project Name:** `i18nsmith`
**Goal:** Zero-friction internationalization for modern web frameworks.

## Phase 1: Foundation & Scanner (Completed)
**Objective:** Build the core CLI that can parse code and identify translatable strings without modifying files.

### 1.1. Repository Setup
*   **Stack:** TypeScript, Node.js (latest LTS).
*   **Monorepo:** `pnpm` workspaces to separate packages.
*   **Packages:** `@i18nsmith/core`, `@i18nsmith/cli`, `@i18nsmith/transformer`, `@i18nsmith/translation`.
*   **Testing:** `vitest` for unit tests.

### 1.2. Configuration Engine
*   `init` command created to generate `i18n.config.json`.
*   **Config Options:** `sourceLanguage`, `targetLanguages`, `localesDir`, `include`, `exclude`, `translation`.

**Progress notes (2025-11-23):**
- ✅ `init` command implemented in `packages/cli/src/commands/init.ts` and writes `i18n.config.json`.
- ✅ Config normalization and loader added at `packages/cli/src/utils/config.ts` (supports string/array inputs, sensible defaults, helpful errors).


### 1.3. AST Scanner (The "Reader")
*   **Library:** `ts-morph`.
*   **Logic:** A `Scanner` class in `@i18nsmith/core` is responsible for traversing the AST.
*   **Output:** A structured list of "Candidates" to be processed by the transformer.

**Progress notes (2025-11-23):**
- ✅ `Scanner` implemented in `packages/core/src/scanner.ts` using `ts-morph`.
  - Captures JSX text, common translatable JSX attributes (e.g., `placeholder`, `label`, `alt`), and string literals inside JSX expressions.
  - Produces `ScanSummary` with `ScanCandidate[]` entries that include file, position, normalized text, and context.
- ✅ CLI `scan` command wired to the scanner in `packages/cli/src/index.ts` and supports `--json` output and `--config` override.

Run notes:
- Build and run the CLI to scan a project:
  - `pnpm --filter @i18nsmith/cli build`
  - `node packages/cli/dist/index.js scan --json`

These Phase 1 artifacts provide the extraction pipeline required for Phase 2 (key generation + transformer).

## Phase 2: The Transformer (Weeks 5-8)
**Objective:** Safely modify source code to inject i18n keys.

### 2.1. Key Generation
*   **Strategy:** Start with a simple, deterministic hash of the string content. This ensures stability and deduplication.
*   **Implementation:** Create a `KeyGenerator` utility within `@i18nsmith/transformer`.

### 2.2. AST Transformer (The "Writer")
*   **Import Injection:** Check if a `t` function is imported; if not, add a placeholder import.
*   **Hook Injection:** For React/Vue, identify the component body and insert a `const { t } = useTranslation()` hook.
*   **Text Replacement:**
    *   Replace `<div>Hello</div>` with `<div>{t('key_abc123')}</div>`.
    *   Replace `placeholder="Name"` with `placeholder={t('key_def456')}`.
*   **Formatting:** Run `prettier` on modified files to ensure code style consistency.

## Phase 3: State Management & Sync (Weeks 9-10)
**Objective:** Handle updates, deletions, and synchronization between code and JSON locale files.

### 3.1. JSON Manager
*   Create a utility in `@i18nsmith/core` to read/write locale files.
*   Ensure deterministic key sorting to prevent unnecessary git diffs.

### 3.2. Drift Detection (The "Syncer")
*   **Unused Keys:** Implement logic to report keys in `en.json` that are no longer found in the AST.
*   **Missing Keys:** Report `t('new_key')` calls in code that are missing from `en.json`.
*   **Sync Command:** Create an `i18nsmith sync` command to auto-fix these issues (prune unused, add missing placeholders).

## Phase 4: Pluggable Translation Engine (Weeks 11-14)
**Objective:** Integrate optional, pluggable adapters for translation services.

### 4.1. Translator Interface
*   In `@i18nsmith/translation`, define a simple `Translator` interface:
    ```typescript
    interface Translator {
      translate(texts: string[], sourceLang: string, targetLang: string): Promise<string[]>;
    }
    ```

### 4.2. Adapter Implementation
*   Create separate, optional packages for each adapter (e.g., `@i18nsmith/translator-deepl`, `@i18nsmith/translator-google`).
*   These packages will be **optional dependencies**. A user installs them only if they need them.
*   The `i18nsmith translate` command will dynamically `import()` the adapter specified in `i18n.config.json`.

### 4.3. Security & Dev Experience
*   API keys must be provided via environment variables (e.g., `DEEPL_API_KEY`). The config will only reference the variable name.
*   Provide a mock local adapter (`@i18nsmith/translator-mock`) that returns pseudo-translations (e.g., `[EN] Hello`) for fast, offline development.

## Phase 5: CI/CD & Workflow (Weeks 15+)
**Objective:** Integrate into the developer lifecycle.

### 5.1. CLI Polish
*   Enhance commands with interactive prompts using `inquirer`.
*   Improve output formatting with `chalk` and add progress indicators.

### 5.2. GitHub Action
*   Create a GitHub Action to run `i18nsmith scan --check` on Pull Requests.
*   This command will fail the build if it finds new, untranslated strings that haven't been extracted.

### 5.3. VS Code Extension (Future)
*   Highlight hardcoded strings directly in the editor.
*   Provide a "Quick Fix" action to run `i18nsmith` on the current file.
