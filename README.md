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
pnpm --filter "@i18nsmith/cli" run build
node packages/cli/dist/index.js init
```

See `ARCHITECTURE.md` and `implementation-plan.md` for details.
