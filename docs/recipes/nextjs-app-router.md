# Recipe: Next.js App Router Integration

## Goal
Integrate i18nsmith into a Next.js (App Router) project with zero surprise: scanning, transforming, providing runtime, syncing & translating.

## Prerequisites
- Next.js 13+ with `app/` directory.
- Node LTS + pnpm.
- Source language: `en` (adjust as needed).

## Steps
1. Initialize config:
   ```bash
   npx i18nsmith init
   ```
2. Diagnose existing i18n artifacts (if migrating):
   ```bash
   npx i18nsmith diagnose --json
   ```
3. Scaffold runtime (react-i18next or next-intl):
   ```bash
   npx i18nsmith scaffold-adapter --type react-i18next --dry-run
   npx i18nsmith scaffold-adapter --type react-i18next --write
   ```
4. Provider injection (auto-detected):
   - If `app/layout.tsx` contains a single `{children}` slot, the injector wraps with `<I18nProvider>`.
   - Otherwise follow CLI guidance.
5. Transform sample component:
   ```bash
   npx i18nsmith transform --target app/page.tsx --dry-run
   npx i18nsmith transform --target app/page.tsx --write
   ```
6. Sync locales (add missing keys only):
   ```bash
   npx i18nsmith sync --dry-run
   npx i18nsmith sync --write
   ```
7. Optional prune after review:
   ```bash
   npx i18nsmith sync --write --prune -y
   ```
8. Translation workflows:
   - Manual seeding: `npx i18nsmith sync --write --seed-target-locales`
   - CSV handoff: `npx i18nsmith translate --export missing.csv --locales fr,de`
   - Import result: `npx i18nsmith translate --import missing-filled.csv --write`

## Provider Wrapping Example
Before:
```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
```
After:
```tsx
import { I18nProvider } from './i18n/provider';
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><I18nProvider>{children}</I18nProvider></body></html>;
}
```

## Common Issues & Fixes
| Issue | Cause | Resolution |
|-------|-------|------------|
| No files matched | Glob mismatch | Run `npx i18nsmith check` and inspect zero-match warning |
| Duplicate provider | Already wrapped | Remove manual wrapper or skip scaffold with `--skip-if-detected` |
| Missing adapter deps | Not installed | Re-run scaffold with `--install-deps` |

## Next Steps
- Add CI (see GitHub Actions recipe).
- Explore interactive sync: `npx i18nsmith sync --interactive`.
- Consider dynamic key assumptions via `--assume-globs errors.*`.
