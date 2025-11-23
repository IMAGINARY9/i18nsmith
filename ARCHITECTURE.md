# i18nsmith Architecture

This document outlines the high-level architecture of `i18nsmith`, a universal automated i18n library. The design prioritizes simplicity, modularity, and extensibility.

## Guiding Principles

1.  **CLI First**: The primary interface is a command-line tool (`i18nsmith`). It's designed to be intuitive and easy to integrate into any build process.
2.  **Simple Configuration**: A single `i18n.config.json` file at the project root drives all behavior.
3.  **Modular & Extensible**: Core logic is decoupled from external services. Translation services are treated as optional plugins, preventing dependency bloat.
4.  **AST-Powered**: Code is analyzed statically using Abstract Syntax Trees (AST), ensuring accuracy without executing the code. `ts-morph` is the chosen library for this task.

## Monorepo Package Structure

The project is a monorepo managed by `pnpm` workspaces. This structure improves maintainability and code sharing.

| Package                 | Description                                                                                                                            | Key Responsibilities                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **`@i18nsmith/core`**   | The heart of the library. Contains shared types, configuration management, and the AST scanner.                                        | - Define `I18nConfig` interface.<br>- Implement the `Scanner` to traverse the AST and identify strings.         |
| **`@i18nsmith/cli`**     | The command-line interface. Provides commands like `init`, `scan`, `translate`.                                                        | - Parse commands and arguments.<br>- Orchestrate calls to other packages.<br>- Handle user interaction and feedback. |
| **`@i18nsmith/transformer`** | Responsible for all code modifications. It replaces extracted strings with i18n key-based function calls.                            | - Receive identified strings from the `Scanner`.<br>- Generate stable keys.<br>- Modify source files to insert i18n calls. |
| **`@i18nsmith/translation`** | A collection of adapters for various translation services. Each service is an optional dependency.                                   | - Define a common `Translator` interface.<br>- Implement adapters for Google Translate, DeepL, etc.<br>- Fetch translations. |

## Core Workflow

The `i18nsmith` process follows these steps:

1.  **Initialization (`i18nsmith init`)**:
    - A user runs the `init` command.
    - The `@i18nsmith/cli` package prompts the user for basic settings (source language, file paths, etc.).
    - An `i18n.config.json` file is generated in the user's project root.

2.  **Extraction & Transformation (`i18nsmith run`)**:
    - The user runs the main command.
    - The `cli` reads `i18n.config.json`.
    - The `core` `Scanner` is invoked to parse the specified source files (`include` glob pattern).
    - The `Scanner` walks the AST of each file, identifying hard-coded strings and template literals that are candidates for translation.
    - For each identified string, the `transformer` package:
        - Generates a stable, unique key (e.g., based on the string content and file path).
        - Replaces the original string in the AST with an i18n function call (e.g., `t('key_123')`).
        - Saves the modified source file.
        - Appends the extracted string and its key to a source language file (e.g., `locales/en.json`).

3.  **Translation (`i18nsmith translate`)**:
    - The user runs the `translate` command.
    - The `cli` reads the source language JSON file (e.g., `en.json`).
    - Based on the `translation.service` setting in the config, the appropriate adapter from the `translation` package is loaded.
    - The adapter sends the source strings to the external API (e.g., Google Translate).
    - The returned translations are used to create or update the target language files (e.g., `es.json`, `fr.json`).

This modular design ensures that a user who only wants to extract strings doesn't need to install or configure any translation-related dependencies.
