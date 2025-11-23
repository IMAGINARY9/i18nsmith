PNPM isolated-linker note and quick checks
========================================

When working with this monorepo you may notice that plain Node resolution for workspace packages sometimes fails:

  node -e "console.log(require.resolve('@i18nsmith/core/package.json'))"

This can throw `MODULE_NOT_FOUND` even when the packages are built correctly. The reason is pnpm's `nodeLinker: isolated` (virtual store) layout: pnpm keeps package files in `node_modules/.pnpm` and does not always create top-level `node_modules/@scope/*` folders.

Why this is OK
- Vitest, Vite and TypeScript builds run under pnpm's workspace environment and resolve workspace packages correctly.
- The important guarantees are:
  - `packages/*/dist/index.js` exists (built JS)
  - `packages/*/dist/index.d.ts` exists (TypeScript declarations)
  - each package's `package.json` `main`/`types`/`exports` point to those files

Quick developer workflow

1. Install and build the workspace (ensures dist files exist):

```bash
pnpm install
pnpm -w -r build
pnpm -w -r test
```

2. Use the included check script to validate outputs (doesn't rely on Node module resolution):

```bash
node ./scripts/check-package-resolution.mjs
```

This script verifies `main`/`types`/`exports` entries point to actual files under `dist/` for the primary packages.

If you need to perform ad-hoc resolution checks with plain Node, note that you may need a hoisted layout (not recommended) or run the check under pnpm's exec context. Prefer the build + check script above for determinstic results.

End.
