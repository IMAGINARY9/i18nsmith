# Reference Report: Using `ast-i18n` as a Blueprint for `i18nsmith`

**Date:** 2025-11-23
**Status:** Reference Analysis
**Source:** `ast-i18n` (v1.0.1, MIT License)

## 1. Executive Summary

This report analyzes the architecture and implementation of `ast-i18n` to serve as a concrete reference for building `i18nsmith`. While `ast-i18n` provides a solid foundation for AST-based extraction and transformation in React, `i18nsmith` will modernize the stack (TypeScript, Monorepo), expand scope (Multi-framework, JSON/ICU output), and simplify the user experience (Zero-config defaults, optional AI/Translation adapters).

## 2. Key Learnings from `ast-i18n`

### 2.1. Core Architecture (What works well)
*   **Two-Pass Process:**
    1.  **Extraction:** Scans files to build a map of strings -> keys.
    2.  **Transformation:** Rewrites code to use keys.
    *   *Lesson:* Keep these distinct. Extraction generates the "plan" (JSON), transformation executes it.
*   **Stable Key Generation:**
    *   Uses `slugify` + `diacritics.remove` + truncation (40 chars) to create deterministic keys from content.
    *   *Lesson:* This is a perfect default strategy. `i18nsmith` should adopt this as the default "hashed" strategy but allow overrides.
*   **AST Traversal (Babel/Visitor Pattern):**
    *   Effectively targets `JSXText`, `JSXAttribute` (string literals), and `CallExpression` arguments.
    *   *Lesson:* The visitor pattern is robust. We will replicate this using `ts-morph` or Babel for broader compatibility.

### 2.2. Limitations to Improve Upon
*   **Output Format:** `ast-i18n` outputs a JS file (`resource.tsx`). `i18nsmith` must output standard JSON (`en.json`) for compatibility with modern i18n libraries (next-intl, react-i18next).
*   **Configuration:** Relies on `ast.config.js` for blacklists. `i18nsmith` will use a simpler `i18n.config.json` with sensible defaults.
*   **Dependencies:** Heavy reliance on `jscodeshift` for transformation. `i18nsmith` can use `ts-morph` for a more unified read/write API in TypeScript.

## 3. `i18nsmith` Architecture & UX Design

### 3.1. User Experience (The "Zero-Friction" Goal)
*   **Installation:** `npm install -D i18nsmith`
*   **Init:** `npx i18nsmith init` (Creates `i18n.config.json` with defaults)
*   **Run:** `npx i18nsmith scan` (Scans, generates keys, updates JSON)
*   **Translate:** `npx i18nsmith translate --target fr` (Optional, uses configured provider)

### 3.2. Configuration (`i18n.config.json`)
Designed to be temporary/minimal. Defaults should work for 90% of projects.

```json
{
  "sourceLanguage": "en",
  "locales": ["en", "fr", "de"],
  "outputDir": "./locales",
  "framework": "react", // or 'next', 'vue' (auto-detected if possible)
  "translation": {
    "provider": "deepl", // optional: 'google', 'mock'
    "apiKeyEnv": "DEEPL_API_KEY" // Env var name, NOT the key itself
  }
}
```

### 3.3. Module Structure (Monorepo)

To ensure modularity and testability, `i18nsmith` will be structured as a monorepo:

1.  **`packages/core`**:
    *   **Scanner:** AST traversal logic (The "Reader").
    *   **KeyGenerator:** Strategy logic (Slug, Hash, Structural).
    *   **JsonManager:** Read/Write JSON with sorting and drift detection.
2.  **`packages/cli`**:
    *   Command handling (`init`, `scan`, `translate`).
    *   User interaction (prompts, progress bars).
3.  **`packages/transformer`**:
    *   **Injector:** Code rewriting logic (The "Writer").
    *   Framework adapters (React, Vue, etc.).
4.  **`packages/translation`** (Optional):
    *   Adapters for DeepL, Google, etc.
    *   This package is only loaded if translation commands are used.

## 4. Implementation Roadmap (Refined)

### Phase 1: The Scanner (Core)
*   **Goal:** Read code, find strings, generate keys.
*   **Ref:** `ast-i18n/lib/BabelPluginI18n.js`
*   **Task:** Implement `Scanner` class using `ts-morph`.
    *   Input: File paths.
    *   Output: `ExtractionResult[]` ({ file, line, text, suggestedKey }).

### Phase 2: The Manager (JSON)
*   **Goal:** Manage the "Source of Truth" (en.json).
*   **Task:** Implement `JsonManager`.
    *   `load(path)`: Read existing JSON.
    *   `sync(extractions)`: Add new keys, mark unused ones.
    *   `save()`: Write sorted JSON.

### Phase 3: The Transformer (Injector)
*   **Goal:** Rewrite code to use keys.
*   **Ref:** `ast-i18n/lib/i18nTransformerCodemod.js`
*   **Task:** Implement `Injector` class.
    *   `injectImport()`: Add `useTranslation` hook.
    *   `replaceText(node, key)`: Replace text with `t('key')`.

### Phase 4: Translation (Optional Layer)
*   **Goal:** Automate `en.json` -> `fr.json`.
*   **Task:** Implement `Translator` class.
    *   Interface: `translate(text, targetLang)`.
    *   Adapters: `DeepLAdapter`, `GoogleAdapter`, `MockAdapter`.
    *   **Note:** This is strictly optional. The tool works perfectly without it (manual translation).

## 5. Conclusion

`ast-i18n` proves that AST-based extraction is viable and superior to regex. `i18nsmith` will take this concept and wrap it in a modern, developer-friendly CLI that handles the entire lifecycle: from extraction to JSON management to optional automated translation. By keeping the translation layer optional and config-driven, we avoid "interface bloat" and keep the tool lightweight.
