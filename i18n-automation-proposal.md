# Proposal: Universal Automated i18n Library & Workflow

**Date:** 2025-11-22
**Status:** Draft Proposal
**Target Audience:** Developers, Architects, DevOps

## 1. Executive Summary

This document outlines the architecture for a **Universal i18n Automation Library**. The goal is to eliminate the manual toil of internationalization by creating a tool that scans project source code, intelligently identifies static text, replaces it with structured translation keys, and automatically generates context-aware translations for multiple languages using AI.

## 2. Core Philosophy

The solution is built on three pillars:
1.  **AST-Driven Analysis:** Using Abstract Syntax Trees (AST) instead of Regular Expressions for 100% safe and accurate code manipulation.
2.  **Semantic Key Generation:** Keys should reflect the *structure* of the project (e.g., `components.auth.login_button`) rather than the content (e.g., `login_btn_1`).
3.  **AI-Powered Context:** Translations must understand the *context* (e.g., is "Book" a noun or a verb?) by analyzing the surrounding code.

## 3. Architecture Overview

The system is designed as a **modular, CLI-first tool** that can be used progressively. A user can start with simple string extraction and later opt into automated translation.

### Component A: The "Scanner & Transformer" Library (CLI)

This is a Node.js-based CLI tool (`i18nsmith`) that runs locally or in CI. It is built as a monorepo with distinct packages for each responsibility.

#### 1. `@i18nsmith/core`: The Foundation
*   **Function:** Provides shared configuration, types, and the core AST scanning logic.
*   **Logic:**
    *   Defines the `i18n.config.json` structure.
    *   Uses `ts-morph` to parse code (TypeScript, JSX, Vue, Svelte) into an AST.
    *   Traverses the AST to discover static strings, template literals, and JSX text.
    *   Maintains a registry of found strings and their locations.

#### 2. `@i18nsmith/transformer`: The Code Rewriter
*   **Function:** Modifies the source code to use i18n keys.
*   **Logic:**
    *   Receives a list of strings to be replaced from the `core` scanner.
    *   Generates a stable, unique key for each string (e.g., a hash of the content).
    *   Safely modifies the AST to replace the string with a function call (e.g., `t('key_123')`).
    *   Adds necessary imports (`import { t } from '...';`).
    *   Uses `prettier` to format the modified code.

#### 3. `@i18nsmith/cli`: The User Interface
*   **Function:** The main entry point for the user.
*   **Logic:**
    *   Provides commands: `i18nsmith init`, `i18nsmith scan`, `i18nsmith translate`.
    *   Orchestrates the workflow by calling the `core` and `transformer` packages.
    *   Manages file I/O for locale files (e.g., `locales/en.json`).

### Component B: The Translation Adapters (`@i18nsmith/translation`)

This package provides a plugin-based system for connecting to translation services. **It is an optional dependency.**

#### 1. Simple & Pluggable by Design
*   To keep `i18nsmith` lightweight, translation capabilities are not part of the core.
*   Users who only want to extract strings do not need to install or configure any translation-related dependencies.

#### 2. Default Providers: API-based
*   The primary recommended method is to use established translation APIs like **DeepL** or **Google Translate**.
*   These are exposed as optional adapters. To use one, a user would install it: `pnpm add @i18nsmith/translator-deepl`.
*   The user supplies their API key via environment variables.

#### 3. Advanced Providers: LLM-based
*   For more nuanced translations that require deep code context, adapters for **OpenAI** or **Anthropic** can be used.
*   These are also optional plugins and would be used in the same way.

#### 4. Workflow
1.  The `i18nsmith translate` command is run.
2.  The CLI checks the `i18n.config.json` to see which translation service is configured.
3.  It dynamically loads the corresponding translation adapter.
4.  The adapter receives the source `en.json` file, sends the strings to the API, and writes the returned translations to the target locale files (e.g., `fr.json`, `de.json`).

This approach ensures the core tool remains simple and dependency-free, while allowing powerful features to be added on an as-needed basis.
