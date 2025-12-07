# i18nsmith Architecture

This document outlines the high-level architecture of `i18nsmith`, a universal automated i18n library. The design prioritizes simplicity, modularity, and extensibility.

## Guiding Principles

1.  **CLI First**: The primary interface is a command-line tool (`i18nsmith`). It's designed to be intuitive and easy to integrate into any build process.
2.  **Simple Configuration**: A single, versioned `i18n.config.json` file at the project root drives all behavior.
3.  **Modular & Extensible**: Core logic is decoupled from external services. Translation services are treated as optional plugins, preventing dependency bloat.
4.  **AST-Powered**: Code is analyzed statically using Abstract Syntax Trees (AST), ensuring accuracy without executing the code. `ts-morph` is the chosen library for this task.

## Monorepo Package Structure

The project is a monorepo managed by `pnpm` workspaces. This structure improves maintainability and code sharing.

| Package                      | Description                                                                        | Key Responsibilities                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **`@i18nsmith/core`**        | The heart of the library. Contains shared types, configuration management, scanner | - Define `I18nConfig` interface<br>- Implement the `Scanner` to traverse AST<br>- Syncer for locale management        |
| **`i18nsmith`**         | The command-line interface. Provides commands like `init`, `scan`, `translate`     | - Parse commands and arguments<br>- Orchestrate calls to other packages<br>- Handle user interaction and feedback     |
| **`@i18nsmith/transformer`** | Responsible for all code modifications. Replaces strings with i18n function calls  | - Receive identified strings from `Scanner`<br>- Generate stable keys<br>- Modify source files to insert i18n calls   |
| **`@i18nsmith/translation`** | A collection of adapters for various translation services                          | - Define a common `Translator` interface<br>- Implement adapters for Google Translate, DeepL, etc.<br>- Fetch translations |

---

## Detailed Module Structure

### `i18nsmith` — Command-Line Interface

The CLI is decomposed into focused command modules:

```
packages/cli/src/
├── index.ts                  # Entry point (39 lines) - command registration
├── commands/
│   ├── init.ts               # Project initialization
│   ├── scan.ts               # Source file scanning
│   ├── sync.ts               # Locale synchronization
│   ├── check.ts              # Validation checks
│   ├── transform.ts          # AST transformation
│   ├── rename.ts             # Key renaming
│   ├── diagnose.ts           # Diagnostics reporting
│   ├── preflight.ts          # Pre-operation validation
│   ├── audit.ts              # Locale auditing
│   ├── backup.ts             # Backup management
│   ├── debug-patterns.ts     # Pattern debugging
│   ├── scaffold-adapter.ts   # Adapter scaffolding
│   └── translate/            # Translation command module
│       ├── index.ts          # Main translate command
│       ├── types.ts          # Type definitions
│       ├── reporter.ts       # Progress/result reporting
│       ├── executor.ts       # Translation execution
│       └── csv-handler.ts    # CSV import/export
└── utils/
    ├── diagnostics-exit.ts   # Exit code handling
    ├── diff-utils.ts         # Diff generation
    ├── package-manager.ts    # Package manager detection
    ├── provider-injector.ts  # Provider component injection
    ├── scaffold.ts           # Scaffolding utilities
    └── pkg.ts                # Package.json utilities
```

### `@i18nsmith/core` — Core Library

The core package contains configuration, scanning, and synchronization logic:

```
packages/core/src/
├── index.ts                  # Public API exports
├── config.ts                 # Re-export shim (backwards compat)
├── config/                   # Configuration module
│   ├── index.ts              # Module exports
│   ├── types.ts              # I18nConfig, SyncConfig, etc.
│   ├── defaults.ts           # DEFAULT_INCLUDE, DEFAULT_EXCLUDE
│   ├── normalizer.ts         # Config normalization functions
│   └── loader.ts             # loadConfig, findUp utilities
├── syncer.ts                 # Main syncer (re-exports module)
├── syncer/                   # Syncer module
│   ├── index.ts              # Syncer class implementation
│   ├── reference-cache.ts    # Reference caching
│   ├── sync-validator.ts     # Validation logic
│   ├── sync-reporter.ts      # Sync result reporting
│   ├── sync-utils.ts         # Utility functions
│   └── pattern-matcher.ts    # Glob pattern matching
├── scanner.ts                # AST scanner
├── diagnostics.ts            # Diagnostic reporting
├── key-generator.ts          # Translation key generation
├── key-validator.ts          # Key validation rules
├── key-renamer.ts            # Key renaming logic
├── locale-store.ts           # Locale file I/O
├── locale-validator.ts       # Locale validation
├── placeholders.ts           # Placeholder extraction
├── reference-extractor.ts    # Reference extraction
├── check-runner.ts           # Check execution
├── actionable.ts             # Actionable diagnostics
├── value-generator.ts        # Value generation
└── utils/
    └── locale-shape.ts       # Locale shape utilities
```

### `@i18nsmith/transformer` — Code Transformation

```
packages/transformer/src/
├── index.ts                  # Public exports
├── transformer.ts            # Main transformation logic
├── react-adapter.ts          # React-specific transformations
├── formatting.ts             # Code formatting utilities
└── types.ts                  # Type definitions
```

### `@i18nsmith/translation` — Translation Services

```
packages/translation/src/
├── index.ts                  # Public exports & adapter registry
└── placeholder.ts            # Placeholder handling for APIs
```

---

## Core Workflow

The `i18nsmith` process follows these steps:

1.  **Initialization (`i18nsmith init`)**:
    - A user runs the `init` command.
    - The `i18nsmith` package prompts the user for basic settings (source language, file paths, adapter, etc.).
    - A versioned `i18n.config.json` file (currently `version: 1`) is generated in the user's project root.

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

---

## Refactoring History

The codebase underwent a comprehensive refactoring in November 2025 to improve maintainability and reduce file sizes:

| Phase | Target                 | Before    | After    | Reduction  | Modules Created |
| ----- | ---------------------- | --------- | -------- | ---------- | --------------- |
| 1     | CLI `index.ts`         | 1,793 LOC | 39 LOC   | **-97.8%** | 8 commands      |
| 2     | Core `syncer.ts`       | 1,248 LOC | 877 LOC  | **-30%**   | 6 modules       |
| 3     | CLI `translate.ts`     | 789 LOC   | 6 LOC    | **-99.2%** | 5 modules       |
| 4     | Core `config.ts`       | 550 LOC   | 8 LOC    | **-98.5%** | 5 modules       |

**Key improvements:**
- Single-responsibility modules with clear boundaries
- Improved testability through smaller, focused units
- Backwards-compatible re-export shims for existing imports
- Consistent module structure across packages
