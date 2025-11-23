# Post-Testing Analysis & Implementation Plan (v2)

**Date:** 2025-11-24
**Context:** Analysis of external-project integration reports and manual review feedback.

## 1. Analysis of Testing Reports

### 1.1. Integration Report (external run)
*   **Success:** The tool successfully scanned 105 files and processed 801 candidates in a real-world external project.
*   **Issue (Critical):** The CLI `--json` output crashes with `Converting circular structure to JSON`. This blocks CI/automation integration.
*   **Issue (DX):** Running the tool against external projects requires local stubs/symlinks for `@i18nsmith/*` packages because Node resolution fails in nested environments (related to pnpm isolated linker).
*   **Observation:** The dry-run mode correctly identified candidates without modifying files.

### 1.2. Write-Run Report (external run)
*   **Success:** The transformer modified 44 files and added ~600 keys to `en.json` and `fr.json` in the target repository.
*   **Issue (Runtime):** The transformed code imports `useTranslation` from `react-i18next`, but the tool does not ensure this dependency exists in the target project.
*   **Issue (Content):** Target language files (e.g., `fr.json`) are generated with English content (or keys) as values. Users may prefer not to generate these files if they are just placeholders, or at least have an option to control this behavior.
*   **Issue (Readability):** Generated keys (e.g., `common.auto.page.master-driving-in.934b8878`) are considered too long and complex for manual maintenance.

## 2. User Feedback & Requirements

1.  **Missing Dependency (`react-i18next`):**
    *   *Problem:* Transformed code fails to compile if `react-i18next` is missing.
    *   *Requirement:* The tool should check for the dependency and warn/prompt the user, or the documentation must explicitly state it as a prerequisite. Ideally, the tool could offer to install it.

2.  **Empty/Placeholder Target Files:**
    *   *Problem:* "Adding of empty french file (maybe its not a bug, but if no translations mentioned there should not be added empty (keys only) files)."
    *   *Requirement:* Review the strategy for target languages. If no translation service is connected, maybe only generate `sourceLanguage` file, or allow a config option to skip target generation until translation is requested.

3.  **Key Structure Optimization:**
    *   *Problem:* Keys like `common.auto.availabilitymanagement.day-of-week.1e3b938a` are hard to read.
    *   *Requirement:* Simplify key generation. Options:
        *   Remove `common.auto` prefix (make it configurable).
        *   Shorten the hash (e.g., 4-6 chars).
        *   Use a flatter structure (e.g., `filename.slug`).
        *   Allow custom key generation strategies via config.

## 3. Implementation Plan (Next Steps)

### 3.1. Fix Critical Bugs
*   **Fix JSON Serialization:** Debug `packages/cli` to identify the circular reference in the `--json` output and implement a safe serializer (e.g., using `flatted` or a custom `replacer`).

### 3.2. Improve Developer Experience (DX)
*   **Dependency Check:**
    *   In `transform` command, check the target project's `package.json` for `react-i18next` (or the configured adapter's library).
    *   If missing, print a warning: "Dependency 'react-i18next' is required for transformed code. Please install it."
*   **External Project Runner:**
    *   Improve `scripts/run-external-transform.mjs` or documentation to handle module resolution better without manual stubs (e.g., using `NODE_PATH` or `pnpm exec`). *Note: This is partially addressed by the new `MAINTAINER_FIX_GUIDE.md` and check script, but the runner script itself might need a tweak.*

### 3.3. Refine Key Generation
*   **Configurable Strategies:**
    *   Update `KeyGenerator` to support different strategies.
    *   **Default (Simplified):** `<filename>.<slug>` (if unique), falling back to `<filename>.<slug>.<shortHash>` if collision.
    *   **Config Option:** Add `keyStrategy` to `i18n.config.json` (e.g., `"flat"`, `"nested"`, `"hashed"`).
*   **Action:** Modify `packages/core/src/key-generator.ts` to implement a cleaner default strategy (e.g., remove `common.auto` prefix, use shorter hash).

### 3.4. Target Language Handling
*   **Config Option:** Add `generateTargetLocales` (boolean, default `true`) to `i18n.config.json`.
*   **Logic:**
    *   If `false`, only write to `sourceLanguage` file (e.g., `en.json`).
    *   If `true` (default), keep current behavior (seeding targets with source text/keys) but maybe add a "todo" marker or empty string value based on user preference.
    *   *Refinement:* For now, maybe just default to *not* creating target files if they don't exist, or only creating the source file during `transform`. The `translate` command (Phase 4) is where target files should be populated.
    *   *Decision:* Modify `LocaleStore` or `Transformer` to only write to the source locale by default during `transform`, unless a flag is set.

## 4. Task List

1.  [ ] **Fix CLI JSON Output:** Debug and fix circular structure error.
2.  [ ] **Dependency Check:** Add check for `react-i18next` in `transform` command.
3.  [ ] **Simplify Keys:**
    *   Remove `common.auto` prefix.
    *   Shorten hash to 6 chars.
    *   Update tests to reflect new key structure.
4.  [ ] **Target Locale Logic:**
    *   Update `transform` to only write source locale by default.
    *   (Optional) Add config to enable target seeding.

