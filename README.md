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
