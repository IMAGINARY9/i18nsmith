# i18nsmith

Universal Automated i18n Library.

## Quick start

1. Install pnpm (if you don't have it).
2. Add `@i18nsmith/cli` to your project (once it’s published) or run the CLI from this monorepo.
3. Run `i18nsmith init` in your app to generate an `i18n.config.json`.
4. Run `i18nsmith transform --write` to inject `useTranslation` calls and update locale JSON.

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
i18nsmith scaffold-adapter --type react-i18next --source-language en --i18n-path src/lib/i18n.ts --provider-path src/components/i18n-provider.tsx
```

Both flows respect `--locales-dir`, refuse to overwrite existing files unless you confirm `--force`, and warn if `react-i18next` / `i18next` are missing from `package.json`.

Regardless of the path you choose, if you stick with `react-i18next` you still need to install the dependencies and initialize them early in your app shell (the scaffolded files already do this for you, but you can roll your own):

1. Install and configure the dependencies:

	 ```bash
	 pnpm add react-i18next i18next
	 ```

2. Initialize `i18next` once in your application's entry point (e.g., `app/providers.tsx`). The `scaffold-adapter` command can generate a production-ready initializer and provider for you.
