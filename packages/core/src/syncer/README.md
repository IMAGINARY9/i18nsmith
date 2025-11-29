# Syncer Module

This module handles locale file synchronization and validation for i18nsmith.

## Structure

```
syncer/
├── index.ts            # Main Syncer class implementation
├── reference-cache.ts  # Translation reference caching
├── sync-validator.ts   # Sync validation logic
├── sync-reporter.ts    # Sync result reporting
├── sync-utils.ts       # Utility functions
└── pattern-matcher.ts  # Glob pattern matching utilities
```

## Public API

### Classes

- `Syncer` — Main synchronization class that orchestrates locale sync operations

### Interfaces

- `SyncSummary` — Summary of sync operation results
- `SyncOptions` — Options for sync operations
- `LocaleDiff` — Diff between source and target locales

### Utility Functions

- `buildPatternMatcher(patterns)` — Create a pattern matcher from glob patterns
- `validateSync(config, locales)` — Validate sync configuration
- `reportSyncResults(summary)` — Format sync results for display

## Usage

```typescript
import { Syncer } from '@i18nsmith/core';

const syncer = new Syncer(config, {
  workspaceRoot: '/path/to/project',
});

const summary = await syncer.sync({
  write: false,  // dry-run
  validateInterpolations: true,
});
```

## Module Responsibilities

| Module | Responsibility |
|--------|----------------|
| `index.ts` | Main Syncer class, orchestrates sync workflow |
| `reference-cache.ts` | Caches translation references for performance |
| `sync-validator.ts` | Validates locale data and detects drift |
| `sync-reporter.ts` | Builds human-readable sync summaries |
| `sync-utils.ts` | Shared utility functions |
| `pattern-matcher.ts` | Dynamic key glob pattern matching |

## Backwards Compatibility

The parent `syncer.ts` file re-exports everything from this module:

```typescript
// Both work:
import { Syncer } from '@i18nsmith/core/syncer.js';
import { Syncer } from '@i18nsmith/core';
```
