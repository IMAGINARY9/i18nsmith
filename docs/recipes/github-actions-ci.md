# Recipe: GitHub Actions CI Integration

## Goal
Automate i18n drift detection & safety checks in pull requests.

## Quick Start: Using the i18nsmith Action

The easiest way to add i18n checks to your CI is with the reusable action:

```yaml
name: i18n Check
on: [pull_request]

jobs:
  i18n:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run i18nsmith check
        uses: IMAGINARY9/i18nsmith@v1
        with:
          command: check
          fail-on: conflicts
          report-path: i18n-report.json
```

## Action Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `command` | `check` | Command to run: `check`, `sync`, `scan`, `diagnose` |
| `fail-on` | `conflicts` | Failure threshold: `none`, `warnings`, `conflicts`, `drift` |
| `args` | `''` | Additional CLI arguments |
| `working-directory` | `.` | Working directory for the command |
| `report-path` | `''` | Path to write JSON report (enables artifact upload) |
| `node-version` | `20` | Node.js version |
| `package-manager` | `npm` | Package manager: `npm`, `pnpm`, `yarn` |

## Action Outputs

| Output | Description |
|--------|-------------|
| `exit-code` | Exit code from i18nsmith command |
| `report-path` | Path to the generated report |
| `summary` | Brief summary of check results |

## Example: Full CI Pipeline

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
  i18n-checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      # Health check with conflict detection
      - name: i18n Health Check
        uses: IMAGINARY9/i18nsmith@v1
        id: check
        with:
          command: check
          fail-on: conflicts
          report-path: i18n-check.json
          package-manager: pnpm
      
      # Sync analysis (dry-run)
      - name: i18n Sync Analysis
        uses: IMAGINARY9/i18nsmith@v1
        with:
          command: sync
          args: '--check'
          report-path: i18n-sync.json
          package-manager: pnpm
        continue-on-error: true
      
      # Use outputs in subsequent steps
      - name: Check Results
        if: always()
        run: |
          echo "Check exit code: ${{ steps.check.outputs.exit-code }}"
          echo "Summary: ${{ steps.check.outputs.summary }}"
```

## Alternative: Direct CLI Usage

For monorepos or when you need full control:

```yaml
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
        run: npx i18nsmith sync --json --report i18n-sync.json
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
