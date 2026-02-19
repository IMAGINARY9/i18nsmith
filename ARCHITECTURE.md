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

## Framework Adapter Architecture

i18nsmith supports multiple frontend frameworks through a pluggable adapter system. Each framework (React, Vue, Svelte, etc.) has its own adapter that implements the `FrameworkAdapter` interface.

### Adapter Registry Pattern

The `AdapterRegistry` in `@i18nsmith/core` acts as a service locator:

- **Registration**: Adapters register themselves at startup
- **Lookup**: Files are matched to adapters by file extension (`.tsx` → ReactAdapter, `.vue` → VueAdapter)
- **Preflight**: Dependencies are checked before operations begin

### FrameworkAdapter Interface

```typescript
interface FrameworkAdapter {
  id: string;                    // 'react', 'vue', etc.
  name: string;                  // Display name
  capabilities: AdapterCapabilities; // scan, mutate, diff
  extensions: string[];          // ['.tsx', '.jsx']
  
  checkDependencies(): AdapterDependencyCheck[];
  scan(options: AdapterScanOptions): ScanSummary;
  mutate(options: AdapterMutateOptions): MutationResult;
}
```

This design allows new frameworks to be added without modifying core logic. See `docs/FRAMEWORK_SUPPORT_ARCHITECTURE.md` for detailed implementation.

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

## Cache System Architecture

i18nsmith implements a dual-cache system to optimize performance across multiple workflow stages:

### Cache Types

| Cache Type | Location (Production) | Location (Test) | Purpose |
|------------|----------------------|-----------------|---------|
| **Extractor Cache** | `node_modules/.cache/i18nsmith/references.json` | `{tmpdir}/i18nsmith-test-cache/{pid}/extractor/` | Caches translation reference extraction from source files |
| **Sync Cache** | `.i18nsmith/cache/sync-references.json` | `{tmpdir}/i18nsmith-test-cache/{pid}/sync/` | Caches sync operation results and locale file analysis |

### Cache Versioning Strategy

The cache system uses **automatic versioning** to invalidate caches when parsers change:

```typescript
// Version = SCHEMA_VERSION * 1,000,000 + (parser_signature_hash % 1,000,000)
// Example: Schema 1, signature hash 0x12345678 → 1,305,416
const cacheVersion = computeCacheVersion(getParsersSignature(), CACHE_SCHEMA_VERSION);
```

**Version Components:**
- **CACHE_SCHEMA_VERSION** (manually bumped): Incremented only when cache structure changes
- **Parser Signature** (automatic): SHA-256 hash of parser implementation code
- **Combined Version**: Encodes both components into single number (schema in millions place)

**Benefits:**
- ✅ No manual version bumps when parser logic changes
- ✅ Automatic cache invalidation on parser updates
- ✅ Clear separation: structure changes vs implementation changes
- ✅ Zero runtime overhead (signature computed at build time)

### Cache Validation Layers

Caches are validated through multiple layers (fast-fail early exit):

1. **Version Check**: `cache.version === currentVersion`
2. **Translation Identifier**: `cache.translationIdentifier === config.translationAdapter.hookName`
3. **Config Hash**: `SHA256(config) === cache.configHash`
4. **Tool Version**: `packageVersion === cache.toolVersion`
5. **Parser Signature**: `getParsersSignature() === cache.parserSignature`
6. **Parser Availability**: `installedParsers === cache.parserAvailability`
7. **File Fingerprints**: Per-file `{mtimeMs, size}` checks

**Validation is unified** through `CacheValidator` class:

```typescript
const validator = new CacheValidator(context);
const { valid, reasons } = validator.validate(cacheData);
if (!valid) {
  console.log(`Cache invalidated: ${CacheValidator.formatReasons(reasons)}`);
}
```

### Test Isolation

Tests use **process-isolated cache paths** to ensure perfect isolation:

```typescript
// Automatically detected in test environment
if (isTestEnvironment()) {
  cachePath = `{tmpdir}/i18nsmith-test-cache/{process.pid}/{cacheType}/`;
}
```

**Benefits:**
- ✅ No `invalidateCache: true` needed in tests
- ✅ Parallel test execution without conflicts
- ✅ Automatic cleanup via `cleanupTestCache()`
- ✅ Production cache paths remain unchanged

### Build-Time Optimization

Parser signatures are computed at **build time** for zero runtime cost:

```javascript
// prebuild.mjs (runs before tsc compilation)
const vueSource = readFileSync('src/parsers/vue-parser.ts');
const tsSource = readFileSync('src/parsers/typescript-parser.ts');
const signature = sha256(vueSource + tsSource);
writeFileSync('src/parser-signature.ts', 
  `export const BUILD_TIME_PARSER_SIGNATURE = '${signature}';`);
```

**Performance Impact:**
- Before: ~5ms runtime introspection per cache operation
- After: ~0.001ms (static import of pre-computed hash)
- **Speedup: 5000x** with graceful fallback for development mode

### Cache Observability

Track cache effectiveness with `CacheStatsCollector`:

```typescript
const extractor = new ReferenceExtractor(config, options);
await extractor.extractReferences(files);

const stats = extractor.getCacheStats();
console.log(stats.format()); 
// Cache hits: 42, misses: 3, invalidations: 1 (hit rate: 93.3%)
// Last invalidation: Cache version mismatch: 4 → 5
```

### Troubleshooting Cache Issues

**Problem: Cache always invalidates**
- Check `getCacheStats()` for invalidation reasons
- Most common: config changes, parser updates, or file modifications

**Problem: Stale cache not invalidating**
- Verify `CACHE_SCHEMA_VERSION` was bumped if cache structure changed
- Ensure `prebuild.mjs` ran to generate new parser signature
- Check that `getParsersSignature()` returns current signature

**Problem: Tests have cache conflicts**
- Verify tests are running in test environment (check `isTestEnvironment()`)
- Ensure cleanup hooks are present: `afterAll(() => cleanupTestCache())`
- Confirm cache paths contain process.pid in tests

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
