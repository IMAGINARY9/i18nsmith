# Configuration Module

This module handles all configuration-related functionality for i18nsmith.

## Structure

```
config/
├── index.ts        # Public exports
├── types.ts        # Type definitions (I18nConfig, SyncConfig, etc.)
├── defaults.ts     # Default configuration values
├── normalizer.ts   # Configuration normalization functions
└── loader.ts       # File loading and path resolution
```

## Public API

### Types

- `I18nConfig` — Main configuration interface
- `SyncConfig` — Sync command configuration
- `TranslationConfig` — Translation provider configuration
- `DiagnosticsConfig` — Diagnostics configuration
- `LocalesConfig` — Locale file format configuration
- `KeyGenerationConfig` — Key generation settings
- `TranslationAdapterConfig` — Translation adapter settings
- `PlaceholderFormat` — Placeholder format types
- `EmptyValuePolicy` — Empty value handling policy
- `SuspiciousKeyPolicy` — Suspicious key handling policy
- `LocaleFormat` — Locale file format (flat/nested/auto)

### Functions

- `loadConfig(workspaceRoot?)` — Load configuration from workspace
- `loadConfigWithMeta(workspaceRoot?)` — Load config with source path metadata
- `normalizeConfig(raw)` — Normalize and validate configuration object

### Constants

- `DEFAULT_INCLUDE` — Default file include patterns
- `DEFAULT_EXCLUDE` — Default file exclude patterns
- `DEFAULT_PLACEHOLDER_FORMATS` — Default placeholder format detection
- `DEFAULT_EMPTY_VALUE_MARKERS` — Default empty value markers

## Usage

```typescript
import { loadConfig, I18nConfig } from '@i18nsmith/core';

const config = await loadConfig('/path/to/project');
```

## Backwards Compatibility

The parent `config.ts` file re-exports everything from this module, so existing imports continue to work:

```typescript
// Both work:
import { loadConfig } from '@i18nsmith/core/config.js';
import { loadConfig } from '@i18nsmith/core';
```
