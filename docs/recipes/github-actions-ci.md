# Recipe: GitHub Actions CI Integration

## Goal
Automate i18n drift detection & safety checks in pull requests.

## Workflow Summary
1. Install dependencies & build.
2. Run `i18nsmith check --fail-on conflicts`.
3. Run `i18nsmith sync --dry-run --json` to produce artifact.
4. Optionally comment summary on PR.

## Example Workflow (.github/workflows/i18nsmith-check.yml)
```yaml
name: i18nsmith
on:
  pull_request:
    paths:
      - 'app/**'
      - 'src/**'
      - 'i18n.config.json'
      - 'locales/**'
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - name: Use Node LTS
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm -r build
      - name: i18n check
        run: npx i18nsmith check --fail-on conflicts --json --report i18n-check.json
      - name: i18n sync dry-run
        run: npx i18nsmith sync --dry-run --json --report i18n-sync.json
      - name: Upload reports
        uses: actions/upload-artifact@v4
        with:
          name: i18n-reports
          path: |
            i18n-check.json
            i18n-sync.json
```

## Exit Codes Reference
| Code | Meaning |
|------|---------|
| 0 | OK / no actionable issues |
| 1 | General drift detected |
| 2 | Interpolation mismatch |
| 3 | Empty values violation |
| 11 | Drift + warnings (non-blocking) |

## PR Comment (Optional)
Use a marketplace action or custom script to parse `i18n-check.json` and post a summary.

## Caching Tips
- Cache build + `node_modules` via setup-node `cache: pnpm`.
- For large repos add a step caching `.i18nsmith/cache` keyed by hash of include patterns.

## Fail Policy Patterns
- Strict CI: fail on any drift (`sync --check`).
- Lenient: warn on unused keys but fail on missing or placeholder issues.

## Next Steps
- Add translation cost estimation step: `npx i18nsmith translate --estimate --json`.
- Integrate with reviewdog for inline JSON diagnostics.
