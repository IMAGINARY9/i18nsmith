# Recipe: Monorepo / Workspaces Integration

## Goal
Use `i18nsmith` across multiple packages (e.g., apps + libraries) while maintaining a single source of truth for locale files or per-app isolation.

## Strategies
### 1. Centralized locales (recommended for shared UI)
- Single `locales/` directory at repo root (e.g., `./locales/en.json`).
- Root `i18n.config.json` with broad `include` globs spanning packages.
- Run commands from repo root so upward config lookup finds the root file.

Pros: Simplified translation management, avoids duplicate keys across apps.
Cons: Large locale files; per-app diffs noisier.

### 2. Per-app locales (isolation)
- Each app workspace (e.g., `apps/web`, `apps/admin`) has its own `locales/` + `i18n.config.json`.
- Run CLI from each app’s directory or use `--config` pointing at the app config.

Pros: Clean separation, smaller diffs.
Cons: Key duplication risk; harder to batch translate.

### 3. Hybrid
- Shared base locale file (e.g., `locales/en.shared.json`) + per-app overrides in their own locales folder.
- Pre-sync step merges shared + app-specific JSON into ephemeral in-memory structure; write phase preserves split.
- (Planned) Use future `sharedLocalesDir` config.

## Config Patterns
Root config (centralized):
```jsonc
{
  "sourceLanguage": "en",
  "targetLanguages": ["fr","de"],
  "localesDir": "locales",
  "include": [
    "apps/web/src/**/*.{ts,tsx}",
    "apps/admin/src/**/*.{ts,tsx}",
    "packages/ui/src/**/*.{ts,tsx}"
  ],
  "exclude": ["**/*.test.*"],
  "diagnostics": { "include": ["packages/**/*.{ts,tsx}"] }
}
```

Per-app config example (`apps/web/i18n.config.json`):
```jsonc
{
  "sourceLanguage": "en",
  "targetLanguages": ["fr"],
  "localesDir": "apps/web/locales",
  "include": ["apps/web/src/**/*.{ts,tsx}"]
}
```

## Running Commands
Centralized:
```bash
# From repo root
npx i18nsmith check --json --report .i18nsmith/check.json
npx i18nsmith sync --write
```

Per-app:
```bash
(cd apps/web && npx i18nsmith sync --write)
(cd apps/admin && npx i18nsmith sync --write)
```

## Key Naming Recommendations
- Prefix keys with app or library namespace when centralized, e.g., `web.nav.home`, `admin.user.list.title`, `ui.button.save`.
- Use batch rename (`rename-keys --map`) to migrate legacy un-namespaced keys.

## Transformation Scope
- Use `--target` to transform only the package you’re onboarding (e.g., `apps/web/src/pages/**`).
- Avoid cross-package rewrites until each app’s provider is scaffolded.

## Caching & Performance
- Shared reference cache lives under `.i18nsmith/cache` and covers all included files.
- In CI, cache this directory keyed by a hash of include patterns to accelerate subsequent jobs.

## CI Example (matrix)
```yaml
strategy:
  matrix:
    app: [web, admin]
steps:
  - uses: actions/checkout@v4
  - run: pnpm install --frozen-lockfile
  - run: pnpm -r build
  - run: cd apps/${{ matrix.app }} && npx i18nsmith check --fail-on conflicts
```

## Common Pitfalls
| Pitfall | Resolution |
|---------|------------|
| Duplicate keys across apps | Adopt namespacing convention; run `diagnose` to surface collisions. |
| Missing config in sub-folder | Upward search finds root; specify `--config` for per-app runs. |
| Slow full-repo scans | Use `--target` during incremental onboarding; warm cache for CI. |

## Next Steps
- Add shared locale merging helper (future Phase 5 enhancement).
- Document GitLab multi-project pipeline variant.
