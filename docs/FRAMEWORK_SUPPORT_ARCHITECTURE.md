# Framework Support Architecture — i18nsmith

> Supersedes `docs/VUE_PARSER_RECOMMENDATIONS.md`.
> This document is the single source of truth for how i18nsmith handles
> multi-framework scanning, transformation, and code mutation.

---

## 1. Problem Statement

i18nsmith must support an **unbounded set of UI frameworks** (React, Vue, Svelte,
Angular, Solid, Qwik, …) for scanning translatable text and applying AST-safe
code mutations.  The current codebase has several structural issues that make
adding new frameworks painful and error-prone:

| # | Issue | Where |
|---|-------|-------|
| 1 | **`FileParser` is coupled to ts-morph types** (`Node`, `Project`, `SourceFile`). A Vue or Svelte parser should not need ts-morph. | `packages/core/src/parsers/FileParser.ts` |
| 2 | **`Scanner` hardcodes two parsers** (`TypescriptParser`, `VueParser`). Adding a framework means editing `Scanner`. | `packages/core/src/scanner.ts` constructor |
| 3 | **`Transformer` contains two completely separate code-paths** (`processReactFile`, `processVueFile`) with duplicated locale-store logic. Adding Svelte would require a third copy. | `packages/transformer/src/transformer.ts` |
| 4 | **`I18nWriter` interface is inconsistent**: `ReactWriter.transform` takes `(candidate, project)` while `VueWriter.transform` takes `(filePath, content, candidates[])`. The interface in `Writer.ts` doesn't match either. | `packages/transformer/src/writers/` |
| 5 | **React-specific adapter logic** (`react-adapter.ts`: hook injection, scope analysis) lives in the transformer package with no abstraction boundary. | `packages/transformer/src/react-adapter.ts` |
| 6 | **Vue parser is optionally loaded at runtime** via `eval('require')` with a silent lossy fallback. Mutating operations can silently produce incorrect results. | `VueParser.ts`, `key-renamer.ts` |
| 7 | **`ScannerNodeCandidate` embeds ts-morph `Node`/`SourceFile`** as required fields, making the scan result representation framework-specific. | `packages/core/src/scanner.ts` |
| 8 | **No `framework` field in config** — the config has `translationAdapter` but no explicit framework selection, so detection is based on file extension only. | `packages/core/src/config/types.ts` |

---

## 2. Design Goals

1. **Open/Closed Principle** — adding a new framework requires adding a new
   adapter package/module, not modifying core or transformer.
2. **Single Responsibility** — each adapter owns parsing, scanning, and code
   mutation for its framework.  Core owns locale management, key generation,
   diffing, and orchestration.
3. **Dependency Inversion** — core and transformer depend on abstract adapter
   interfaces, never on framework-specific libraries (ts-morph, vue-eslint-parser,
   svelte/compiler).
4. **Explicit over implicit** — no silent fallbacks for mutating operations.
   Read-only scan may degrade gracefully; writes must fail-fast with an
   actionable message when adapter dependencies are missing.
5. **Minimal IR** — the shared representation between adapters and core is a
   thin, JSON-serialisable `ScanCandidate` (no AST node references in the
   public API).

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI / Extension                       │
│            (orchestration, user I/O, progress)               │
└────────────────────────────┬────────────────────────────────┘
                             │
                     ┌───────▼────────┐
                     │   Transformer   │  (framework-agnostic orchestrator)
                     │  @i18nsmith/    │
                     │   transformer   │
                     └──┬──────────┬──┘
                        │          │
          ┌─────────────▼──┐   ┌──▼─────────────┐
          │  FrameworkAdapter│   │  LocaleStore    │
          │  (interface)    │   │  KeyGenerator   │
          └──┬──────┬──────┘   │  Diffing, etc.  │
             │      │          └─────────────────┘
    ┌────────▼┐  ┌──▼───────┐
    │  React  │  │   Vue    │   ← each adapter is a separate module
    │ Adapter │  │  Adapter │      with its own dependencies
    └─────────┘  └──────────┘
```

### 3.1 `FrameworkAdapter` interface (Strategy pattern)

The central abstraction.  Each framework implements this single interface.

```typescript
// packages/core/src/framework/adapter.ts

export interface AdapterCapabilities {
  /** Adapter can scan files to produce candidates */
  scan: boolean;
  /** Adapter can apply AST-safe mutations (transform/rename) */
  mutate: boolean;
  /** Adapter can generate source-level diffs */
  diff: boolean;
}

export interface AdapterDependencyCheck {
  /** Human-readable name of the dependency */
  name: string;
  /** Install command hint */
  installHint: string;
  /** Whether it's available at runtime */
  available: boolean;
}

export interface MutationEdit {
  /** 0-based byte offset — start */
  start: number;
  /** 0-based byte offset — end (exclusive) */
  end: number;
  /** Replacement text */
  replacement: string;
}

export interface MutationResult {
  /** Whether any edits were applied */
  didMutate: boolean;
  /** The resulting file content after all edits */
  content: string;
  /** Individual edits applied (for diff generation) */
  edits: MutationEdit[];
}

export interface FrameworkAdapter {
  /** Unique adapter id, e.g. 'react', 'vue', 'svelte' */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Declare what this adapter can do */
  readonly capabilities: AdapterCapabilities;

  /** File extensions this adapter handles (e.g. ['.tsx','.jsx'] or ['.vue']) */
  readonly extensions: string[];

  /**
   * Check that all runtime dependencies (parsers, compilers) are available.
   * Returns a list of dependency statuses.  Transformer uses this for
   * preflight validation before mutating operations.
   */
  checkDependencies(): AdapterDependencyCheck[];

  /**
   * Scan a single file and return framework-agnostic ScanCandidates.
   * The adapter is responsible for parsing the file using whatever
   * framework-specific tooling it needs.
   */
  scan(filePath: string, content: string, options?: AdapterScanOptions): ScanCandidate[];

  /**
   * Apply a batch of mutations to a single file.
   * The adapter receives the original content and a list of candidates
   * with their suggested keys, and returns the mutated content.
   *
   * The adapter is responsible for:
   * - Locating each candidate in the file
   * - Replacing text with t('key') / $t('key') / equivalent
   * - Inserting imports/bindings as needed by the framework
   * - Returning the full mutated content
   */
  mutate(
    filePath: string,
    content: string,
    candidates: TransformCandidate[],
    options: AdapterMutateOptions
  ): MutationResult;
}

export interface AdapterScanOptions {
  scanCalls?: boolean;
  config: I18nConfig;
  workspaceRoot: string;
}

export interface AdapterMutateOptions {
  config: I18nConfig;
  workspaceRoot: string;
  translationAdapter: { module: string; hookName: string };
  /** When false, adapter must fail-fast if dependencies are missing */
  allowFallback?: boolean;
}
```

### 3.2 Adapter Registry (service locator, open for extension)

```typescript
// packages/core/src/framework/registry.ts

export class AdapterRegistry {
  private adapters = new Map<string, FrameworkAdapter>();

  register(adapter: FrameworkAdapter): void {
    this.adapters.set(adapter.id, adapter);
    // Also register by extension for fast lookup
  }

  getById(id: string): FrameworkAdapter | undefined { ... }

  getForFile(filePath: string): FrameworkAdapter | undefined {
    const ext = path.extname(filePath).toLowerCase();
    for (const adapter of this.adapters.values()) {
      if (adapter.extensions.includes(ext)) return adapter;
    }
    return undefined;
  }

  getAll(): FrameworkAdapter[] {
    return [...this.adapters.values()];
  }

  /**
   * Run preflight checks for all registered adapters.
   * Returns adapters with missing dependencies.
   */
  preflightCheck(): Map<string, AdapterDependencyCheck[]> { ... }
}
```

### 3.3 How `Scanner` changes

```typescript
// packages/core/src/scanner.ts  (simplified)

export class Scanner {
  private registry: AdapterRegistry;

  constructor(config: I18nConfig, options: ScannerOptions & { registry: AdapterRegistry }) {
    this.registry = options.registry;
    // ... rest unchanged
  }

  scan(options?: ScanExecutionOptions): ScanSummary {
    for (const filePath of filePaths) {
      const adapter = this.registry.getForFile(filePath);
      if (!adapter) continue;

      const candidates = adapter.scan(filePath, content, {
        scanCalls: options?.scanCalls,
        config: this.config,
        workspaceRoot: this.workspaceRoot,
      });
      allCandidates.push(...candidates);
    }
    // ... bucketing, deduplication unchanged
  }
}
```

### 3.4 How `Transformer` changes

The two-path `processReactFile` / `processVueFile` collapse into a single
generic loop:

```typescript
// packages/transformer/src/transformer.ts  (simplified)

for (const [filePath, plans] of transformableByFile) {
  const adapter = this.registry.getForFile(filePath);
  if (!adapter) { markAllSkipped(plans, 'No adapter'); continue; }

  if (!adapter.capabilities.mutate) {
    markAllSkipped(plans, `${adapter.name} adapter does not support mutation`);
    continue;
  }

  // Preflight: fail-fast if adapter deps missing
  const depIssues = adapter.checkDependencies().filter(d => !d.available);
  if (depIssues.length && !runOptions.allowFallback) {
    const msg = depIssues.map(d => `${d.name}: ${d.installHint}`).join('; ');
    markAllSkipped(plans, `Missing dependencies: ${msg}`);
    continue;
  }

  const content = await fs.readFile(filePath, 'utf-8');
  const result = adapter.mutate(filePath, content, plans, {
    config: this.config,
    workspaceRoot: this.workspaceRoot,
    translationAdapter: this.translationAdapter,
  });

  if (result.didMutate && write) {
    await fs.writeFile(filePath, result.content, 'utf-8');
    await formatFileWithPrettier(filePath);
    changedFiles.add(filePath);
  }

  // Locale store upserts — identical for all frameworks
  for (const plan of plans) {
    if (plan.status === 'applied') {
      await this.upsertLocales(plan, runOptions);
    }
  }
}
```

**The locale-store logic is no longer duplicated per framework.**

---

## 4. Concrete Adapter Implementations

### 4.1 React adapter  (`packages/core/src/framework/adapters/react.ts`)

- **Dependencies**: `ts-morph` (already a direct dependency of core).
- **scan()**: Reuses existing `TypescriptParser` logic (extract JSX text,
  attributes, expressions).  Returns plain `ScanCandidate[]`.
- **mutate()**: Uses ts-morph to apply edits, insert imports/hooks.
  Encapsulates all of current `react-adapter.ts` and `ReactWriter`.

### 4.2 Vue adapter  (`packages/core/src/framework/adapters/vue.ts`)

- **Dependencies**: `vue-eslint-parser` (peer/optional dependency of core).
- **scan()**: Reuses existing `VueParser` template/script walking.
  Returns plain `ScanCandidate[]`.
- **mutate()**: Uses `MagicString` for template edits.  For TypeScript
  `<script lang="ts">` blocks, can optionally split the script content and
  use ts-morph for precise mutation, then reassemble.
- **checkDependencies()**: Returns `{ name: 'vue-eslint-parser', available: boolean, installHint: 'pnpm add -D vue-eslint-parser' }`.

### 4.3 Future: Svelte adapter

- **Dependencies**: `svelte/compiler` (peer dependency).
- **scan()**: Parse `.svelte` file, walk template and script AST.
- **mutate()**: Use `svelte/compiler`'s AST + MagicString for edits.

---

## 5. What Gets Removed / Refactored

| Current file | Action |
|---|---|
| `packages/core/src/parsers/FileParser.ts` | **Delete** — replaced by `FrameworkAdapter` interface |
| `packages/core/src/parsers/TypescriptParser.ts` | **Move** internals into `ReactAdapter.scan()` |
| `packages/core/src/parsers/VueParser.ts` | **Move** internals into `VueAdapter.scan()` |
| `packages/transformer/src/react-adapter.ts` | **Move** into `ReactAdapter.mutate()` |
| `packages/transformer/src/writers/ReactWriter.ts` | **Delete** — absorbed by `ReactAdapter.mutate()` |
| `packages/transformer/src/writers/VueWriter.ts` | **Delete** — absorbed by `VueAdapter.mutate()` |
| `packages/transformer/src/writers/Writer.ts` | **Delete** — replaced by `FrameworkAdapter` |
| `Scanner` constructor | Remove hardcoded parser list; accept `AdapterRegistry` |
| `Transformer.processReactFile` | **Delete** — replaced by generic loop |
| `Transformer.processVueFile` | **Delete** — replaced by generic loop |
| `ScannerNodeCandidate` (ts-morph fields) | **Remove from public API** — adapter-internal only |

---

## 6. `ScanCandidate` remains the canonical IR

The existing `ScanCandidate` type is already framework-agnostic (file, line,
column, text, kind, context).  It stays as-is.  The `ScannerNodeCandidate`
(with ts-morph `Node`/`SourceFile`) becomes an **adapter-internal** type used
only inside `ReactAdapter`, never exposed to Scanner or Transformer.

```typescript
// Public — unchanged
export interface ScanCandidate {
  id: string;
  filePath: string;
  kind: CandidateKind;
  text: string;
  context?: string;
  position: { line: number; column: number };
  suggestedKey?: string;
  hash?: string;
  forced?: boolean;
}

// Adapter-internal (React only, not exported from core)
interface ReactNodeCandidate extends ScanCandidate {
  _node: Node;          // ts-morph node
  _sourceFile: SourceFile;
}
```

---

## 7. Config Changes

Add an optional `framework` field for explicit framework selection and
auto-detection fallback:

```typescript
export interface I18nConfig {
  // ... existing fields ...

  /**
   * Explicitly declare frameworks used in the project.
   * When omitted, frameworks are auto-detected from file extensions.
   * Examples: ['react'], ['vue'], ['react', 'vue']
   */
  frameworks?: string[];
}
```

This allows:
- Explicit opt-in: `{ "frameworks": ["vue"] }` → only register VueAdapter.
- Auto-detect (default): register all adapters whose extensions match scanned files.

---

## 8. Dependency Strategy

| Adapter | Parser/Compiler | Dependency type | Rationale |
|---------|----------------|-----------------|-----------|
| React | ts-morph | `dependencies` of core | Already required; TS/TSX is the primary use-case |
| Vue | vue-eslint-parser | `peerDependencies` + `peerDependenciesMeta.optional: true` | Users who don't use Vue shouldn't pay the install cost |
| Svelte | svelte/compiler | `peerDependencies` + optional | Same rationale |
| Angular | @angular/compiler | `peerDependencies` + optional | Same rationale |

Each adapter's `checkDependencies()` validates at runtime.  The transformer
runs preflight checks before any mutating operation and fails with:

```
✗ Vue adapter: missing vue-eslint-parser
  Install with: pnpm add -D vue-eslint-parser
  Or pass --allow-fallback for read-only scan mode.
```

---

## 9. Design Patterns Used

| Pattern | Where | Why |
|---------|-------|-----|
| **Strategy** | `FrameworkAdapter` interface | Each framework provides its own scanning/mutation strategy |
| **Registry / Service Locator** | `AdapterRegistry` | Decouples framework discovery from Scanner/Transformer |
| **Template Method** | `Transformer.run()` | Generic orchestration loop with adapter-specific scan/mutate |
| **Fail-Fast** | `checkDependencies()` + preflight | Prevents silent incorrect mutations |
| **Adapter** | Each framework adapter bridges framework-specific AST to `ScanCandidate` | Isolates framework dependencies |
| **Separation of Concerns** | Locale logic in Transformer, AST logic in adapters | No locale/key logic in adapters; no framework logic in Transformer |

---

## 10. Testing Strategy

Each adapter gets its own test suite that validates:

1. **scan()** — correct candidate extraction for framework-specific patterns.
2. **mutate()** — correct code transformation, import injection, formatting.
3. **checkDependencies()** — correct detection of missing/present parsers.
4. **Integration** — Scanner + Adapter + Transformer end-to-end.

CI matrix:
- Base job: runs with React adapter only (always available).
- Vue job: installs `vue-eslint-parser`, runs Vue adapter tests.
- (Future) Svelte job: installs `svelte`, runs Svelte adapter tests.

---

## 11. Migration Path from Current Code

This is not a big-bang rewrite.  The migration is incremental:

**Phase 1** — Define interfaces, extract React adapter (no behavior change).
**Phase 2** — Extract Vue adapter, remove VueParser/VueWriter.
**Phase 3** — Refactor Scanner and Transformer to use registry.
**Phase 4** — Clean up: remove dead code, update tests, add CI matrix.

See `docs/FRAMEWORK_SUPPORT_IMPLEMENTATION_PLAN.yaml` for the detailed
phased implementation plan with file-level tasks.
