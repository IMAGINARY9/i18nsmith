# i18nsmith

Universal Automated i18n Library.

## Quick start

1. Install pnpm (if you don't have it).
2. Add `i18nsmith` to your project (once it’s published) or run the CLI from this monorepo.
3. Run `i18nsmith diagnose` to detect any existing locale files, runtime adapters, or provider scaffolds. Review the actionable items before continuing (add `--json` for automation or `--report .i18nsmith/diagnostics.json` to persist a report for CI/VS Code tooling).
4. Run `i18nsmith check` for a guided health report that merges diagnostics + a sync dry-run. The command prints actionable items, suggested follow-up commands, and fails CI when blocking issues remain.
5. Run `i18nsmith init` in your app to generate an `i18n.config.json`. If `diagnose` found existing assets, pass `--merge` to opt into the guided merge flow so you don’t overwrite what’s already there.
6. Run `i18nsmith transform --write` to inject `useTranslation` calls and update locale JSON.
7. Keep locale files clean with `i18nsmith sync --check` (CI) or `i18nsmith sync --write` locally.
8. Fill missing locale values automatically with `i18nsmith translate` (dry-run by default, pass `--write` to apply results).

See `ARCHITECTURE.md` and `implementation-plan.md` for deeper technical context.

## Diagnose existing i18n assets

Before you scaffold anything new, run the new repository health check:

```bash
i18nsmith diagnose --json --report .i18nsmith/diagnostics.json
```

The command inspects `package.json`, your configured `localesDir`, and up to 200 source files to surface:

- Locale coverage (missing/invalid locales, key counts, file sizes).
- Installed runtimes (`react-i18next`, `next-intl`, `lingui`, etc.).
- Provider candidates (e.g., `app/providers.tsx`) annotated with whether they already wrap `<I18nProvider>`.
- Translation usage statistics (how often `useTranslation` / `t()` appears, sample files).
- Adapter/runtime files that `i18nsmith scaffold-adapter` would normally create.
- Actionable items & merge recommendations, plus conflicts that should block onboarding (invalid JSON, missing source locale, etc.).

Use `--report` to persist the JSON output for CI or editors, and rely on deterministic exit codes to fail automation when blocking conflicts exist:

- `0`: no blocking conflicts detected
- `2`: configured source locale file is missing
- `3`: locale JSON file could not be parsed
- `4`: unsafe provider/adapter clash detected (reserved for future heuristics)
- `5`: generic/unknown diagnostics conflict

Pair this with `i18nsmith init --merge` to reuse existing locales instead of overwriting them.

## Source scanning & diagnostics

Need to double-check which files the tooling will touch? Run the standalone scanner to preview coverage without mutating anything:

```bash
i18nsmith scan --list-files
```

- The command respects the `include`/`exclude` globs from `i18n.config.json` (defaulting to `src/`, `app/`, and `pages/` while skipping `node_modules/`, `.next/`, and `dist/`).
- `--list-files` prints up to 200 matched files so you can spot gaps quickly—handy when onboarding Next.js layouts or monorepo packages that sit outside `src/`.
- Combine with `--json` to feed the summary (including `filesExamined`) into CI or editor tooling.
- Pass extra `--include` / `--exclude` globs on the CLI for one-off runs without touching your config.

This makes it easy to verify scanner coverage before running heavier workflows like `transform` or `sync`.

## Guided repository health check

When you want a single command that answers “Can I safely run init/transform/sync right now?”, use `i18nsmith check`. It combines `diagnose` with a `sync` dry-run, aggregates actionable items, and prints copy-pasteable follow-up commands.

```bash
i18nsmith check --json --report .i18nsmith/check-report.json
```

Highlights:

- Runs diagnostics + sync dry-run in one pass (always non-destructive).
- Produces a consolidated summary with severity badges, so you can spot blocking errors vs. warnings quickly.
- Suggests exact CLI commands (e.g., `i18nsmith sync --write`, `i18nsmith scaffold-adapter --type react-i18next`) tailored to the issues it found.
- Accepts the same targeting flags as `sync` (`--assume`, `--target`, `--diff`, `--validate-interpolations`, `--no-empty-values`).
- Supports `--fail-on conflicts` (default) or `--fail-on warnings` so CI can enforce whatever bar you choose.
- Use `--prefer-diagnostics-exit` to prefer deterministic diagnostics exit codes (e.g., 2 for missing source locale) when `--fail-on=conflicts` and blocking conflicts exist, mirroring `diagnose` behavior for CI consistency.
- Use `--report` to persist the JSON output for the VS Code extension or other tooling.

Pair `check` with `diagnose` when onboarding a brownfield repo: run `diagnose` first to understand existing assets, then `check` to see exactly which commands to run next.

## Configuration

Run `i18nsmith init` to generate an `i18n.config.json` file interactively. A typical config looks like this:

```json
{
	"version": 1,
	"sourceLanguage": "en",
	"targetLanguages": ["fr", "de"],
	"localesDir": "locales",
	"include": [
		"src/**/*.{ts,tsx,js,jsx}",
		"app/**/*.{ts,tsx,js,jsx}",
		"pages/**/*.{ts,tsx,js,jsx}"
	],
	"exclude": ["node_modules/**", ".next/**", "dist/**", "**/*.test.*"],
	"minTextLength": 1,
	"translation": {
		"provider": "deepl",
		"secretEnvVar": "DEEPL_API_KEY",
		"concurrency": 5,
		"batchSize": 25
	},
	"translationAdapter": {
		"module": "react-i18next",
		"hookName": "useTranslation"
	},
	"keyGeneration": {
		"namespace": "common",
		"shortHashLen": 6
	},
	"seedTargetLocales": false
}
```

### Configuration options

- `version` (optional): Config schema version. Currently only `1` is supported; omitted values default to `1`.
- `sourceLanguage`: Source language code (default: `"en"`).
- `targetLanguages`: Array of target language codes.
- `localesDir`: Directory for locale JSON files (default: `"locales"`).
- `locales.format`: Controls how locale JSON is stored. Use `"auto"` (default) to preserve the existing shape (flat vs nested), `"nested"` to always write tree-structured JSON, or `"flat"` to emit dotted keys everywhere.
- `locales.delimiter`: Delimiter used when flattening/expanding nested keys (default: `"."`).
- `include`: Glob patterns for files to scan (default: `src/`, `app/`, and `pages/` trees with TS/JS extensions).
- `exclude`: Glob patterns to exclude (default: `node_modules/**`, `.next/**`, and `dist/**`; add your own such as `**/*.test.*`).
- `minTextLength`: Minimum length for translatable text (default: `1`).
- `translation.provider`: Name of the translation provider/adapter (e.g., `"deepl"`, `"google"`, `"mock"`, or `"manual"` to disable automated translations).
- `translation.module`: Optional module specifier to load instead of the default `@i18nsmith/translator-${provider}` package.
- `translation.secretEnvVar`: Name of the environment variable that stores your API key (recommended so secrets never hit config files). Use `translation.apiKey` only for local experimentation.
- `translation.concurrency` / `translation.batchSize`: Tune request parallelism and batch size when invoking adapters.
- `translation.locales`: Optional default list of locales to translate when `i18nsmith translate` runs without `--locales`.
- `translationAdapter.module`: Module to import the translation hook from (default: `"react-i18next"`).
- `translationAdapter.hookName`: Name of the hook to import (default: `"useTranslation"`).
- `keyGeneration.namespace`: Prefix for generated keys (default: `"common"`).
- `keyGeneration.shortHashLen`: Length of hash suffix (default: `6`).
- `seedTargetLocales`: Whether to create empty entries in target locale files (default: `false`).
- `sync.translationIdentifier`: Name of the translation helper function used in your code (default: `"t"`). Update this if you alias the hook (e.g., `const { translate } = useTranslation()`).
- `sync.validateInterpolations`: When `true`, `i18nsmith sync` compares interpolation placeholders (e.g., `{{name}}`, `%{count}`) between the source locale and every target locale and reports mismatches (default: `false`).
- `sync.placeholderFormats`: Optional list describing which placeholder syntaxes to look for. Supported values: `"doubleCurly"` (`{{name}}`), `"percentCurly"` (`%{name}`), and `"percentSymbol"` (`%s`). Defaults to all three.
- `sync.emptyValuePolicy`: Controls how empty/placeholder translations are treated. Use `"warn"` (default), `"fail"`, or `"ignore"`.
- `sync.emptyValueMarkers`: Extra sentinel values that should be treated as “empty” (defaults to `todo`, `tbd`, `fixme`, `pending`, `???`).
- `sync.dynamicKeyAssumptions`: List of translation keys that are only referenced dynamically (e.g., via template literals) so the syncer can treat them as in-use.
- `sync.dynamicKeyGlobs`: Glob patterns (e.g., `relativeTime.*`, `navigation.**`) that mark entire namespaces as runtime-only so `sync` skips unused warnings for those keys.
- `sync.suspiciousKeyPolicy`: Controls how `sync` handles keys that look like raw sentences (contain spaces). Defaults to `"skip"`, which surfaces the warning but refuses to auto-write the key; set to `"allow"` to keep the legacy behavior or `"error"` to fail CI when such keys are detected.
- `diagnostics.runtimePackages`: Extra package names to treat as i18n runtimes when scanning `package.json` (e.g., `"@acme/i18n-runtime"`).
- `diagnostics.providerGlobs`: Additional glob patterns for detecting provider files (relative to the repo root).
- `diagnostics.adapterHints`: Explicit file paths that should be treated as pre-existing adapters. Each entry accepts `{ "path": "src/i18n/provider.tsx", "type": "custom" }`.
- `diagnostics.include` / `diagnostics.exclude`: Globs that augment the default translation-usage scan (useful when your source lives outside `src/`).
- `diagnostics.maxSourceFiles`: Override the number of files sampled when estimating translation usage (default: 200).

Example diagnostics override:

```jsonc
{
	"diagnostics": {
		"runtimePackages": ["@acme/i18n-runtime"],
		"providerGlobs": ["apps/**/*providers.{ts,tsx}"],
		"adapterHints": [{ "path": "libs/i18n/provider.tsx", "type": "custom" }],
		"include": ["packages/**/*.tsx"],
		"maxSourceFiles": 400
	}
}
```

### Locale shape controls

Legacy repositories often store locale JSON as deeply nested trees while newer ones flatten everything into dotted keys. `i18nsmith` now detects the format per locale file automatically and preserves it on write (`locales.format: "auto"`). Override this behavior if you want to migrate everything to one style: set `"nested"` to emit tree-structured JSON or `"flat"` to coerce dotted keys. When using nested mode you can also change the delimiter via `locales.delimiter` if your runtime prefers something other than `.`.

> The transformer only injects `useTranslation` calls—it does **not** bootstrap a runtime. You must either use the zero-deps adapter or set up a `react-i18next` runtime.

### Merge-aware `init`

If `diagnose` detected existing locales or runtime files, rerun `i18nsmith init --merge`. The CLI will reuse the detection report to:

- Highlight the locales/providers already present.
- Prompt you to choose a merge strategy (`keep-source`, `overwrite`, or `interactive`) instead of blindly scaffolding.
- Skip scaffolding if you decline, so your current adapter stays untouched. You can still force a scaffold with `--force` if you deliberately want to overwrite.

## Adapter & runtime scaffolding

`i18nsmith scaffold-adapter` offers two guided flows, and the `init` command exposes the same prompts so you can wire everything up in one pass. The CLI now auto-skips scaffolding when it detects an existing runtime (to avoid overwriting your provider); pass `--no-skip-if-detected` or `--force` if you really do want to regenerate the files.

### Custom context (zero dependencies)

Generates a `'use client'` React context (`TranslationProvider` + `useTranslation`) backed by your locale JSON. Ideal when you don't want to add `react-i18next`.

Steps:

1. Run `i18nsmith init` and choose **Custom hook/module** when prompted for the adapter.
2. Accept the prompt to **Scaffold a lightweight translation context** (or run separately):

	 ```bash
	 i18nsmith scaffold-adapter --type custom --source-language en --path src/contexts/translation-context.tsx
	 ```

3. The generated `i18n.config.json` will point `translationAdapter.module` at your scaffolded module.
4. Wrap your app with the generated `TranslationProvider`.

Any module that exports a hook returning `{ t: (key: string) => string }` will work. For a complete, production-ready example, run the `scaffold-adapter` command.

### react-i18next runtime

Generates `src/lib/i18n.ts` (initializer) and `src/components/i18n-provider.tsx` (provider that waits for `initI18next()`). Perfect when you want to keep the standard `react-i18next` API but avoid boilerplate bugs like `NO_I18NEXT_INSTANCE`.

Run:

```bash
i18nsmith scaffold-adapter --type react-i18next --source-language en --i18n-path src/lib/i18n.ts --provider-path src/components/i18n-provider.tsx --install-deps
```

Both flows respect `--locales-dir`, refuse to overwrite existing files unless you confirm `--force`, and warn if `react-i18next` / `i18next` are missing from `package.json`. Pass `--install-deps` to let the CLI install any missing runtime dependencies using your detected package manager. If a Next.js `app/providers.(ts|tsx)` file exists, the scaffold command will also attempt to inject the generated `I18nProvider` automatically using `ts-morph` so only the `{children}` expression is wrapped. Ambiguous layouts (multiple `{children}` slots) are skipped with explicit guidance, and `--dry-run` shows the exact patch without editing files so you can review the changes in CI before applying them locally.

Regardless of the path you choose, if you stick with `react-i18next` you still need to install the dependencies and initialize them early in your app shell (the scaffolded files already do this for you, but you can roll your own):

1. Install and configure the dependencies:

	 ```bash
	 pnpm add react-i18next i18next
	 ```

2. Initialize `i18next` once in your application's entry point (e.g., `app/providers.tsx`). The `scaffold-adapter` command can generate a production-ready initializer and provider for you.

## Locale sync & drift detection

`i18nsmith sync` compares every translation helper call with your locale JSON:

- **Missing keys**: Calls like `t('dialog.ok')` that are absent from `en.json`.
- **Suspicious keys are safe by default**: Keys containing spaces are flagged and skipped during auto-write so accidental "key-as-value" pairs can’t sneak into your locales. Override via `sync.suspiciousKeyPolicy` if you intentionally use free-form keys.
- **Auto-normalize suspicious keys on demand**: Add `--auto-rename-suspicious` to print normalized proposals (using your chosen naming convention) and `--write` to apply them instantly across source files + locale JSON. Pass `--rename-map-file` to export the mapping (or let the CLI drop one under `.i18nsmith/auto-rename-map.json`).
- **Unused keys**: Locale entries that are never referenced in your codebase.
- **Placeholder validation**: Add `--validate-interpolations` (or set `sync.validateInterpolations`) to ensure placeholders such as `{{name}}`, `%{count}`, or `%s` appear in every translation for the key.
- **Empty translation policies**: Use `--no-empty-values` (or set `sync.emptyValuePolicy: "fail"`) to treat empty strings, whitespace-only values, and TODO markers as drift.
- **Dynamic key warnings**: Template literals (e.g., ``t(`errors.${code}`)``) are surfaced with file/line references so you can review them. Pass `--assume key1 key2` (or configure `sync.dynamicKeyAssumptions`/`sync.dynamicKeyGlobs`) to whitelist known runtime-only keys or entire namespaces.
- **Dry-run previews**: Before writing, you’ll see per-locale counts of additions/removals so you can review changes in CI.
- **Auto-fixes**: Run with `--write` to add placeholders for missing keys (and seed targets when `seedTargetLocales` is true) and prune unused entries.
- **Unified diffs & patch exports**: Use `i18nsmith sync --diff` to print git-style unified diffs for each locale JSON file that would change. To persist per-locale patches for review or CI artifacts, use `i18nsmith sync --patch-dir ./artifacts` which writes `.patch` files (one per locale) suitable for `git apply` or upload.
- **Machine-friendly JSON**: `i18nsmith sync --json` now includes `localePreview`, `diffs`, and `actionableItems` so CI steps or bots can render previews, annotate PRs, or open issues with full context.
- **Incremental caching**: Repeated runs reuse a per-file reference cache so unchanged files are skipped. Pass `i18nsmith sync --invalidate-cache` after changing include globs or branching to force a clean re-scan.
- **Per-file onboarding**: `i18nsmith sync --target src/pages/About.tsx --target "src/features/profile/**/*.tsx"` limits analysis to the specified files/globs. Missing keys, placeholder checks, and actionable items are scoped to that feature, and unused-key pruning is disabled to avoid touching unrelated locales while you onboard incrementally.
- **Interactive approvals**: Add `--interactive` to run a dry-run, then select which missing keys to add and which unused keys to prune before a final confirmation. This mode can’t be combined with `--json`.
- **CI enforcement**: Add `--check` to fail the build whenever drift is detected.
	- Exit code `1` covers general drift (missing/unused keys), `2` flags interpolation/placeholder mismatches, and `3` marks empty locale values when the `--no-empty-values` policy is enforced—perfect for wiring custom gates in CI.

Examples:

```bash
# Inspect drift without writing (default)
i18nsmith sync

# Fail CI when locales/code diverge
i18nsmith sync --check

# Apply fixes and rewrite locale files atomically
i18nsmith sync --write

# Step through each change interactively (writes after confirmation)
i18nsmith sync --interactive

# Validate placeholders + fail on empty translations
i18nsmith sync --validate-interpolations --no-empty-values --check

# Suppress warnings for known runtime-only keys
i18nsmith sync --assume errors.404 errors.500

# Normalize suspicious keys, apply changes, and export a rename map
i18nsmith sync --auto-rename-suspicious --write --rename-map-file rename-map.txt
```

## Automated translations (`i18nsmith translate`)

Use `i18nsmith translate` to fill missing locale entries using pluggable translation adapters. The command inspects your locale files, builds a translation plan via the new `TranslationService`, and (optionally) writes the translated strings back through the same atomic JSON pipeline used by `sync`.

Highlights:

- Dry-run by default: prints how many keys per locale need translations, total character counts, and (optionally) cost estimates without touching the filesystem.
- `--write` applies translations per-locale and rewrites JSON via `LocaleStore`, preserving deterministic sorting and nested vs. flat shapes.
- `--locales <codes...>` scopes the run to a subset of locales. When omitted, the command uses `translation.locales` from config or all configured targets.
- `--provider <name>` overrides `translation.provider` at runtime. By default, providers are resolved to `@i18nsmith/translator-${provider}`; set `translation.module` if you host adapters elsewhere.
- `--force` retranslates keys that already have values (useful when revisiting machine translations later).
- `--estimate` attempts to call the adapter’s optional `estimateCost` hook, so CI can display approximate spend before running a write.
- `--no-skip-empty` writes translator results even when they’re blank (the default skips empty/placeholder values so the sync policy stays consistent).
- `--json`/`--report` emit the same `TranslateSummary` as the CLI output, making it easy to archive artifacts or feed data into editor tooling.

Examples:

```bash
# Preview missing translations across all locales
i18nsmith translate

# Estimate and then apply translations for Spanish + French only
i18nsmith translate --locales es fr --estimate
i18nsmith translate --locales es fr --write

# Force retranslation for every locale using the mock adapter (handy for demos/tests)
i18nsmith translate --provider mock --write --force
```

### Mock adapter for local/dev workflows

This repo ships `@i18nsmith/translator-mock`, a zero-cost adapter that performs pseudo-localization (vowel accenting + locale prefixing). The adapter implements the shared `Translator` contract exported by `@i18nsmith/translation`, so you can point `translation.module` at it for smoke tests or demos without calling a real API:

```jsonc
{
	"translation": {
		"provider": "mock",
		"module": "@i18nsmith/translator-mock"
	}
}
```

Under the hood, all adapters receive the normalized config (API key env vars, concurrency hints, locale subsets) and return arrays of translated strings. Production adapters (DeepL, Google, etc.) live in their own packages but share the same interface, so teams can build custom adapters—for instance, to proxy internal MT services or wrap vendor-specific SDKs.

## Features

*   **Framework-agnostic**: Works with any library that uses JSON for locales.
*   **TypeScript-aware**: Deeply understands your codebase for accurate key detection.
*   **Fast**: Caches unchanged files for rapid re-scans.
*   **Flexible**: Supports JSX text, attributes, and string literals in code.
*   **Configurable**: Fine-tune key generation, placeholder formats, and more.
*   **Scoped Onboarding**: Use the `--target` flag to transform and sync one file or feature at a time.

### Scoped onboarding with `--target`

Both `i18nsmith transform` and `i18nsmith sync` accept `--target <pattern...>` so you can migrate one route or feature at a time. Repeat the flag or pass multiple paths/globs (space- or comma-separated) to build a focused set. When targeting a subset:

- The transformer only rewrites/prints candidates from the specified files, letting you adopt i18n incrementally without touching the rest of the repo.
- Sync runs constrain missing-key/placeholder diagnostics to those files and skip unused-key pruning, preventing unrelated locales from being deleted while onboarding.

Examples:

```bash
# Transform just the marketing page (dry-run by default)
pnpm i18nsmith transform --target "src/app/marketing/page.tsx"

# Apply locale fixes for the same feature without touching the rest of the app
pnpm i18nsmith sync --write --target "src/app/settings/**"
```

## Key rename workflow

Need to refactor a key across the codebase and locale files? Use `i18nsmith rename-key <oldKey> <newKey>`:

```bash
# Preview the impact
i18nsmith rename-key auth.login.title auth.signin.heading

# Apply edits to source + locale JSON
i18nsmith rename-key auth.login.title auth.signin.heading --write
```

The command reuses the same AST traversal as `sync`, respects custom translation identifiers, and updates source + seeded locale files in one pass. Dry-runs highlight locales that are missing the original key or already contain the destination so you can reconcile edge cases manually before writing.

### Batch rename multiple keys

For larger refactors, supply a JSON map (either an object or an array of `{ "from": string, "to": string }`) to `i18nsmith rename-keys`:

```jsonc
// rename-map.json
[
	{ "from": "auth.login.title", "to": "auth.signin.title" },
	{ "from": "profile.greeting", "to": "profile.salutation" }
]
```

```bash
# Dry-run: view per-mapping occurrences, missing locales, and duplicates
i18nsmith rename-keys --map rename-map.json

# Apply all renames atomically across source files + every locale JSON
i18nsmith rename-keys --map rename-map.json --write
```

The batch command reuses the same safety rails as `rename-key`: duplicate destinations are surfaced per-locale, missing source locales are highlighted, and `--write` performs all mutations in a single pass so updates stay in sync across code and locales.

## Translation Workflows (Manual → External → Automated)

We recommend a tiered approach to translating strings so teams can adopt i18n without handing over sensitive API keys or paying for machine translation prematurely.

- Manual (seed & edit):
	- Use `i18nsmith sync --write --seed-target-locales` to create missing keys in target locale files with empty values or a configurable placeholder (see `sync.seedValue` in `i18n.config.json`). This lets translators edit JSON or use editor patches without dealing with key names.

- External (CSV handoff):
	- Export missing keys to a CSV translators can work with: `i18nsmith translate --export missing.csv --locales fr de`
	- CSV format: `key,sourceLocale,sourceValue,targetLocale,translatedValue`
	- After translators fill `translatedValue`, import back with: `i18nsmith translate --import filled.csv --write` which validates placeholders and merges by key.

- Automated (pluggable adapters):
	- Configure a provider in `i18n.config.json` (e.g., `translation.provider: "deepl"`) and estimate costs with `i18nsmith translate --estimate` before applying translation via `i18nsmith translate --write`.
	- Use the `mock` adapter for UI/pseudo-localization tests without external APIs: `i18nsmith translate --provider mock --write`.

Where to put docs
 - The full guide and recipes live in `docs/recipes/translation-workflows.md` in this repo. It contains CSV examples, placeholder validation notes, and recommended CLI sequences for each workflow tier.

Why this helps
 - Reduces risk by providing an offline handoff path for non-technical translators.
 - Lets teams preview and estimate translation costs before spending on paid providers.
 - Ensures placeholder safety and deterministic locale writes across all workflows.

## Recipes

Curated, task-focused guides live under `docs/recipes/`:

| Recipe | Purpose |
|--------|---------|
| [`nextjs-app-router.md`](./docs/recipes/nextjs-app-router.md) | Onboard i18nsmith in a Next.js App Router project (provider injection, scoped transform). |
| [`before-after-transform.md`](./docs/recipes/before-after-transform.md) | Show concrete pre/post transform code examples & key generation modes. |
| [`translation-workflows.md`](./docs/recipes/translation-workflows.md) | Tiered workflows: manual seeding, CSV handoff, automated adapters. |
| [`github-actions-ci.md`](./docs/recipes/github-actions-ci.md) | **GitHub Action** for drift detection, includes reusable action & direct CLI examples. |
| [`gitlab-ci.md`](./docs/recipes/gitlab-ci.md) | GitLab CI pipeline configuration for i18n checks. |
| [`monorepo-workspaces.md`](./docs/recipes/monorepo-workspaces.md) | Multi-package monorepo configuration with per-package i18n. |
| [`husky-hooks.md`](./docs/recipes/husky-hooks.md) | Pre-commit/pre-push hooks with Husky & lint-staged. |

### GitHub Action Quick Start

Add i18n checks to your PRs in seconds:

```yaml
- uses: IMAGINARY9/i18nsmith@v1
  with:
    command: check
    fail-on: conflicts
    report-path: i18n-report.json
```

See [`github-actions-ci.md`](./docs/recipes/github-actions-ci.md) for full input/output reference.

Additional docs:

- Editor integration concept: [`docs/editor-integration.md`](./docs/editor-integration.md)
- Adapter & extensibility guide: [`docs/adapter-extensibility.md`](./docs/adapter-extensibility.md)
- Visual assets plan: [`docs/visual-assets-plan.md`](./docs/visual-assets-plan.md)

Use these recipes to copy/paste minimal setups rather than reverse-engineering long-form docs.

## Adapter / Framework Support Matrix

| Framework / Runtime | Adapter Kind | Writer | Status | Notes |
|---------------------|--------------|--------|--------|-------|
| React + react-i18next | `react-i18next` | ReactWriter | Stable | Full transform + provider injection |
| Next.js + next-intl | `next-intl` | ReactWriter (shared) | Beta | Import reuse & provider detection; verify placeholders |
| React + lingui | `lingui` | ReactWriter (extended) | Planned | Key/message extraction alignment needed |
| Vue + vue-i18n | `vue-i18n` | VueWriter | Planned | Writer abstraction in roadmap (Phase 4 follow-up) |
| Svelte (svelte-i18n) | `svelte-i18n` | NoopWriter (initial) | Experimental | Transform disabled until Writer implemented |
| Custom zero-deps context | `custom` | ReactWriter / NoopWriter | Stable | Generated via scaffold-adapter; no external deps |
| Mock pseudo-localization | `mock` | NoopWriter | Stable | For layout & overflow stress testing |

For adapter contract details and how to add new ones see [`adapter-extensibility.md`](./docs/adapter-extensibility.md).

## Locale quality auditing

Need to scan your locale files for suspicious patterns or quality issues? Use `i18nsmith audit`:

```bash
# Audit all locale files
i18nsmith audit

# Audit a specific locale
i18nsmith audit --locale en

# Show JSON output
i18nsmith audit --json
```

The audit command detects:
- **Suspicious keys**: Keys containing spaces, trailing punctuation, or sentence-like patterns
- **Key-equals-value patterns**: Where the key name matches the translation value
- **Duplicate values**: Multiple keys with identical translations (potential consolidation)
- **Orphaned namespaces**: Namespaces with very few keys (candidates for reorganization)
- **Key inconsistencies**: Similar but inconsistent key patterns across locales

Audit results include actionable suggestions for fixing detected issues.

## Backup & restore

i18nsmith automatically backs up locale files before destructive operations (sync, rename, translate with `--write`). Manage backups with:

```bash
# List all available backups
i18nsmith backup-list

# Restore from a specific backup
i18nsmith backup-restore <timestamp>

# Skip backup creation during sync/translate
i18nsmith sync --write --no-backup
```

Backups are stored in `node_modules/.cache/i18nsmith/backups/` by default and are timestamped for easy identification.

---

## Developer Documentation

### Architecture & Module Structure

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for detailed package structure and refactoring history.

**Module-Level Documentation:**
- **Config Module:** [`packages/core/src/config/README.md`](./packages/core/src/config/README.md) — Configuration types, loading, and normalization
- **Syncer Module:** [`packages/core/src/syncer/README.md`](./packages/core/src/syncer/README.md) — Locale synchronization and validation
- **Translate Command:** [`packages/cli/src/commands/translate/README.md`](./packages/cli/src/commands/translate/README.md) — Translation command implementation

### Additional Documentation

- **Refactoring History:** [`docs/REFACTORING_PLAN.md`](./docs/REFACTORING_PLAN.md) — Quality improvements and edge case coverage
- **Troubleshooting:** [`docs/troubleshooting.md`](./docs/troubleshooting.md) — Common issues and solutions
- **Best Practices:** [`docs/best-practices.md`](./docs/best-practices.md) — Key naming conventions and CI/CD integration
- **Translation Workflows:** [`docs/recipes/translation-workflows.md`](./docs/recipes/translation-workflows.md) — CSV handoff and manual translation patterns
