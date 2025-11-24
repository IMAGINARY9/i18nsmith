# i18nsmith

Universal Automated i18n Library — monorepo scaffold copied from local workspace.

Quick start

1. Install pnpm (if you don't have it):

```bash
npm install -g pnpm
```

2. Install dependencies:

```bash
pnpm install
```

3. Build packages:

```bash
pnpm -w build
```

4. Run CLI (from repo root):

```bash
pnpm --filter "@i18nsmith/cli" build
node packages/cli/dist/index.js scan --json
node packages/cli/dist/index.js transform --write
```

## Features so far

- **Scanner** – detects JSX text/attribute/expression candidates with configurability.
- **Transformer** – injects `useTranslation` bindings, rewrites JSX, and updates locale JSON with deterministic keys.
- **Locale Store** – writes locale files atomically and seeds placeholders for target languages.
- **CLI commands** – `init`, `scan`, and the new `transform` (dry-run by default, `--write` to apply changes).
- **Tests** – vitest suites for scanner, key generation, locale store, and transformer workflows.

See `ARCHITECTURE.md` and `implementation-plan.md` for deeper technical context.

## Translation adapters & runtime setup

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
