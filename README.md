# i18nsmith

Universal Automated i18n Library — monorepo scaffold copied from local workspace.

Quick start

1. Install pnpm (if you don't have it):

### Scaffold Adapter & Runtime

`i18nsmith scaffold-adapter` now offers two guided flows, and the `init` command exposes the same prompts so you can wire everything up in one pass.

#### Custom context (zero dependencies)

Generates a `'use client'` React context (`TranslationProvider` + `useTranslation`) backed by your locale JSON. Ideal when you don't want to add `react-i18next`.

```bash
- **Tests** – vitest suites for scanner, key generation, locale store, and transformer workflows.
2. Initialize `i18next` once (the scaffolded files already do this, but you can also roll your own):
See `ARCHITECTURE.md` and `implementation-plan.md` for deeper technical context.

```

#### react-i18next runtime

Generates `src/lib/i18n.ts` (initializer) and `src/components/i18n-provider.tsx` (provider that waits for `initI18next()`). Perfect when you want to keep the standard `react-i18next` API but avoid boilerplate bugs like `NO_I18NEXT_INSTANCE`.

```bash
## Configuration

Run `i18nsmith init` to generate an `i18n.config.json` file interactively. The config includes all available options:

```

Both flows respect `--locales-dir`, refuse to overwrite existing files unless you confirm `--force`, and warn if `react-i18next` / `i18next` are missing from `package.json`. During `i18nsmith init`, choosing **Custom hook/module** or **react-i18next** surfaces the same scaffolding choices, so your adapter, runtime, and config stay in sync.

Regardless of the path you choose, the transformer only injects `useTranslation` calls—it does **not** bootstrap a runtime. If you stick with `react-i18next`, you still need to install the dependencies and initialize them early in your app shell (the scaffolded files already do this for you, but you can roll your own):

1. Install and configure the dependencies:

	 ```bash
	 pnpm add react-i18next i18next
	 ```

2. Initialize `i18next` once (for example in `app/providers.tsx`):

	 ```tsx
	 'use client';

	 import { useEffect } from 'react';
	 import i18next from 'i18next';
	 import { initReactI18next } from 'react-i18next';
	 import en from './locales/en.json';

	 export function I18nsmithProvider({ children }: { children: React.ReactNode }) {
		 useEffect(() => {
			 if (!i18next.isInitialized) {
				 i18next
					 .use(initReactI18next)
					 .init({
						 lng: 'en',
						 fallbackLng: 'en',
						 resources: { en: { translation: en } },
					 })
					 .catch(console.error);
			 }
		 }, []);

		 return children;
	 }
	 ```
```json
{
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

### Configuration Options

- `sourceLanguage`: Source language code (default: "en")
- `targetLanguages`: Array of target language codes
- `localesDir`: Directory for locale JSON files (default: "locales")
- `include`: Glob patterns for files to scan (default: ["src/**/*.{ts,tsx,js,jsx}"])
- `exclude`: Glob patterns to exclude
- `minTextLength`: Minimum length for translatable text (default: 1)
- `translation.service`: Translation service ("google", "deepl", or "manual")
- `translationAdapter.module`: Module to import the translation hook from (default: "react-i18next")
- `translationAdapter.hookName`: Name of the hook to import (default: "useTranslation")
- `keyGeneration.namespace`: Prefix for generated keys (default: "common")
- `keyGeneration.shortHashLen`: Length of hash suffix (default: 6)
- `seedTargetLocales`: Whether to create empty entries in target locale files (default: false)

### Scaffold Adapter

When choosing a custom translation adapter during `init`, you can opt to scaffold a lightweight `translation-context.tsx` file. This creates a simple React context provider that implements the `useTranslation` hook interface, eliminating the need for `react-i18next` dependencies.

The scaffolded file will be placed at the path you specify (default: `src/contexts/translation-context.tsx`) and the config will be updated to point to it.

Alternatively, you can run the scaffold command separately:

```bash
i18nsmith scaffold-adapter --source-language en --path src/contexts/translation-context.tsx
```

This will create the context file and print the config snippet to update your `i18n.config.json`.

The transformer injects `useTranslation` calls but it does **not** magically boot a translation runtime for you. By default we import `useTranslation` from `react-i18next`, so you must:

1. Install and configure the dependencies in your app shell:

	 ```bash
	 pnpm add react-i18next i18next
	 ```

2. Initialize `i18next` once (for example in `app/providers.tsx`):

	 ```tsx
	 'use client';

	 import { useEffect } from 'react';
	 import i18next from 'i18next';
	 import { initReactI18next } from 'react-i18next';
	 import en from './locales/en.json';

	 export function I18nsmithProvider({ children }: { children: React.ReactNode }) {
		 useEffect(() => {
			 if (!i18next.isInitialized) {
				 i18next
					 .use(initReactI18next)
					 .init({
						 lng: 'en',
						 fallbackLng: 'en',
						 resources: { en: { translation: en } },
					 })
					 .catch(console.error);
			 }
		 }, []);

		 return children;
	 }
	 ```

If you already have a bespoke translation context (for example `import { useTranslation } from '@/contexts/translation-context'`), point i18nsmith at it through `i18n.config.json`:

```json
{
	"translationAdapter": {
		"module": "@/contexts/translation-context",
		"hookName": "useTranslation"
	}
}
```

Any module that exports a hook returning `{ t: (key: string) => string }` will work. A lightweight example:

```tsx
'use client';

import { createContext, useContext, useState } from 'react';
import enMessages from '../locales/en.json';

const messages = { en: enMessages };
const TranslationContext = createContext({ t: (key: string) => key });

export function TranslationProvider({ children }: { children: React.ReactNode }) {
	const [language, setLanguage] = useState<'en'>('en');

	const t = (key: string) => messages[language]?.[key] ?? key;

	return (
		<TranslationContext.Provider value={{ language, setLanguage, t }}>
			{children}
		</TranslationContext.Provider>
	);
}

export function useTranslation() {
	return useContext(TranslationContext);
}
```

Hooking the adapter into config removes the `react-i18next` dependency, which is useful for projects that already ship their own translation layer.

## Quick Start (Zero-Dependency Adapter)

If you don't want to pull in `react-i18next`, the CLI can scaffold a lightweight adapter that works out of the box:

1. Run `i18nsmith init` and choose **Custom hook/module** when prompted for the adapter.
2. Accept the prompt to **Scaffold a lightweight translation context** (or run `i18nsmith scaffold-adapter --type custom --source-language en --path src/contexts/translation-context.tsx`).
3. Point the generated `i18n.config.json` at your scaffolded module (the init command does this automatically).
4. Wrap your app with the generated `TranslationProvider`.

No additional packages are required—the scaffolded file uses React state plus the generated locale JSON.

### Next.js App Router Example

Add the provider to your `app/providers.tsx` (or root layout):

```tsx
'use client';

import { TranslationProvider } from '@/contexts/translation-context';

export function Providers({ children }: { children: React.ReactNode }) {
	return <TranslationProvider>{children}</TranslationProvider>;
}
```

Because the scaffolded file already includes `'use client'`, the provider is fully compatible with Next.js App Router. The transformer-injected `useTranslation` calls will now read from your context without any external runtime.
