# i18nsmith

Universal Automated i18n Library.

## Quick start

1. Install pnpm (if you don't have it).
2. Add `@i18nsmith/cli` to your project (once it’s published) or run the CLI from this monorepo.
3. Run `i18nsmith init` in your app to generate an `i18n.config.json`.
4. Run `i18nsmith transform --write` to inject `useTranslation` calls and update locale JSON.
5. Keep locale files clean with `i18nsmith sync --check` (CI) or `i18nsmith sync --write` locally.

See `ARCHITECTURE.md` and `implementation-plan.md` for deeper technical context.

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

> The transformer only injects `useTranslation` calls—it does **not** bootstrap a runtime. You must either use the zero-deps adapter or set up a `react-i18next` runtime.

## Adapter & runtime scaffolding

`i18nsmith scaffold-adapter` offers two guided flows, and the `init` command exposes the same prompts so you can wire everything up in one pass.

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
