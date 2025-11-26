# i18nsmith

Universal Automated i18n Library.

## Quick start

1. Install pnpm (if you don't have it).
2. Add `@i18nsmith/cli` to your project (once it’s published) or run the CLI from this monorepo.
3. Run `i18nsmith diagnose` to detect any existing locale files, runtime adapters, or provider scaffolds. Review the actionable items before continuing (add `--json` for automation or `--report .i18nsmith/diagnostics.json` to persist a report for CI/VS Code tooling).
4. Run `i18nsmith check` for a guided health report that merges diagnostics + a sync dry-run. The command prints actionable items, suggested follow-up commands, and fails CI when blocking issues remain.
5. Run `i18nsmith init` in your app to generate an `i18n.config.json`. If `diagnose` found existing assets, pass `--merge` to opt into the guided merge flow so you don’t overwrite what’s already there.
6. Run `i18nsmith transform --write` to inject `useTranslation` calls and update locale JSON.
7. Keep locale files clean with `i18nsmith sync --check` (CI) or `i18nsmith sync --write` locally.

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
	"include": ["src/**/*.{ts,tsx,js,jsx}"],
	"exclude": ["node_modules/**", "**/*.test.*"],
	"minTextLength": 1,
	"translation": {
		"service": "manual"
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
- `include`: Glob patterns for files to scan (default: `["src/**/*.{ts,tsx,js,jsx}"]`).
- `exclude`: Glob patterns to exclude.
- `minTextLength`: Minimum length for translatable text (default: `1`).
- `translation.service`: Translation service (`"google"`, `"deepl"`, or `"manual"`).
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
- **Unused keys**: Locale entries that are never referenced in your codebase.
- **Placeholder validation**: Add `--validate-interpolations` (or set `sync.validateInterpolations`) to ensure placeholders such as `{{name}}`, `%{count}`, or `%s` appear in every translation for the key.
- **Empty translation policies**: Use `--no-empty-values` (or set `sync.emptyValuePolicy: "fail"`) to treat empty strings, whitespace-only values, and TODO markers as drift.
- **Dynamic key warnings**: Template literals (e.g., ``t(`errors.${code}`)``) are surfaced with file/line references so you can review them. Pass `--assume key1 key2` (or configure `sync.dynamicKeyAssumptions`) to whitelist known runtime-only keys.
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
```

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
