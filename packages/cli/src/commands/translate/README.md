# Translate Command Module

This module handles the `i18nsmith translate` command for automated translations.

## Structure

```
translate/
├── index.ts        # Main command registration and orchestration
├── types.ts        # Type definitions (TranslateOptions, TranslateSummary, etc.)
├── reporter.ts     # Progress and result reporting
├── executor.ts     # Translation execution logic
└── csv-handler.ts  # CSV import/export functionality
```

## Public API

### Functions

- `registerTranslate(program)` — Register the translate command with Commander

### Types

- `TranslateOptions` — Command-line options
- `TranslateSummary` — Translation operation summary
- `TranslationPlan` — Plan for translation operations
- `TranslationResult` — Result of translation operations

## Usage

The module is registered automatically by the CLI entry point:

```typescript
import { program } from 'commander';
import { registerTranslate } from './commands/translate/index.js';

registerTranslate(program);
```

## Module Responsibilities

| Module | Responsibility |
|--------|----------------|
| `index.ts` | Command registration, option parsing, workflow orchestration |
| `types.ts` | TypeScript type definitions |
| `reporter.ts` | Console output formatting, progress indicators |
| `executor.ts` | Translation API calls, batch processing |
| `csv-handler.ts` | CSV export/import for manual translation workflows |

## CLI Usage

```bash
# Preview missing translations (dry-run)
i18nsmith translate

# Translate and write results
i18nsmith translate --write

# Translate specific locales
i18nsmith translate --locales fr de --write

# Export to CSV for manual translation
i18nsmith translate --export missing.csv

# Import translated CSV
i18nsmith translate --import filled.csv --write
```

## Backwards Compatibility

The parent `translate.ts` file re-exports from this module:

```typescript
import { registerTranslate } from './translate/index.js';
```
