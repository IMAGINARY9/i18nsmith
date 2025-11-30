# Recipe: Git Hooks / Husky Integration

## Goal
Prevent committing drift (missing/unused keys) or suspicious key patterns by running lightweight checks in pre-commit / pre-push hooks.

## Installing Husky (if not present)
```bash
pnpm add -D husky
npx husky install
```
Add to `package.json` scripts:
```jsonc
"scripts": { "prepare": "husky install" }
```

## Pre-Commit Hook (fast lint)
Checks for suspicious keys & placeholder mismatches without heavy AST rescans.
```bash
npx husky add .husky/pre-commit "npx i18nsmith check --fail-on conflicts --json --report .i18nsmith/check-precommit.json || exit 1"
```
If performance is a concern, scope with `--target` changed files:
```bash
CHANGED=$(git diff --cached --name-only | tr '\n' ' ')
[ -n "$CHANGED" ] && npx i18nsmith check --target $CHANGED --fail-on conflicts || true
```

## Pre-Push Hook (full drift)
Run a more exhaustive sync dry-run before pushing:
```bash
npx husky add .husky/pre-push "npx i18nsmith sync --dry-run --check || exit 1"
```

## Skipping Hooks
Allow developers to bypass with an environment variable:
```bash
npx husky add .husky/pre-commit "[ -n \"$I18NSMITH_SKIP_HOOKS\" ] || npx i18nsmith check --fail-on conflicts"
```

## Suggested Policy
| Hook | Scope | Fail Condition |
|------|-------|----------------|
| pre-commit | changed files only | blocking conflicts (missing source locale, invalid JSON) |
| pre-push | full repo | any drift (missing/unused keys) |

## Future Helper (Planned)
`i18nsmith install-hooks` will:
- Detect husky presence or offer to install.
- Add curated hook scripts with opt-out variable.
- Respect monorepo (adds under root only or per-app with flags).

## Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|
| Slow commits | Full scan on each commit | Scope via changed files or rely on caching |
| False unused warnings | Dynamic keys not assumed | Add `--assume` or configure `sync.dynamicKeyGlobs` |
| Hook not firing | Husky not initialized | Ensure `npm run prepare` executed after install |

## Next Steps
- Implement `install-hooks` command (Phase 5 backlog).
- Document Git hooks for other managers (lefthook).
