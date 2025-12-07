# Phase 5 Readiness — Strict Testing Plan

This document describes a strict, reproducible testing plan to validate that Phases 1–4 and the reliability/safety Phase 6/7 features are functioning correctly and efficiently before starting Phase 5 (CI/CD & Adoption). The plan covers unit, integration, CLI, E2E, performance, and regression checks and specifies acceptance criteria, run commands, expected outcomes, and how to record/triage failures.

Target audience: maintainers, QA engineers, and contributors responsible for release gates.

Goals
- Verify that all commands work as intended: `init`, `diagnose`, `check`, `scan`, `transform`, `sync`, `translate`, `rename-key(s)`, `scaffold-adapter`, `diagnose`, `rollback`, `backup-list`/`backup-restore`, `debug-patterns`.
- Validate safety rails: dry-run defaults, backups before writes, explicit `--prune` for deletions, `--yes` confirmation, `--json`/`--report` machine outputs, exit codes.
- Confirm translation workflows (Phase 4.5) are reliable: seeding, mock adapter, CSV export/import, automated providers (mock + adapters present), placeholder validation.
- Ensure performance and caching behave (incremental scans, cache invalidation).
- Provide deterministic steps for CI gating and local verification.

Test matrix & environments
- OS: macOS (primary), Linux (Ubuntu latest), Windows (GitHub Actions matrix) — run CI matrix across these OSes.
- Node versions: supported LTSs (e.g., 18, 20, 22) — run matrix in CI. Locally test with Node used by developers.
- Package manager: pnpm (document pnpm version used in CI)
- Shell: zsh for local reproduction notes (CI uses actions/checkout & node setup)

High-level acceptance criteria
- All unit tests pass (vitest) across packages.
- All CLI integration tests and E2E fixtures pass in a clean environment (no workspace artifacts). Tests must be non-flaky or have known flake mitigations.
- Manual command smoke runs show correct outputs and safe behavior (dry-run default; no unexpected file mutations).
- Exports/imports (CSV) produce reproducible results; placeholder mismatches are flagged.
- Backups are created for write operations that could be destructive and `rollback` restores previous state.
- Performance: repeated `sync`/`scan` runs show substantial benefit from cache (wall-clock times logged; target: >= 3x speed-up on warm runs for large fixture — baseline measured once).

Repository preparation
1. Clean working tree: ensure no uncommitted changes. If there are, create a branch and stash or commit them.
2. Install dependencies and build the monorepo:

```bash
pnpm install
pnpm -w -C . build
```

Core test phases and detailed steps

Phase A — Unit & package tests (fast, local)
Purpose: catch regressions in core logic and translators.

Steps:
1. Run all tests for core packages in parallel (vitest):

```bash
pnpm -w test --filter @i18nsmith/core
pnpm -w test --filter @i18nsmith/transformer
pnpm -w test --filter @i18nsmith/translation
pnpm -w test --filter @i18nsmith/translator-mock
pnpm -w test --filter i18nsmith
```

2. Acceptance:
   - Exit code 0. No test marked as skipped that indicates missing infrastructure (e.g., real API keys) unless explicitly intended.
   - Coverage: ensure critical modules (Syncer, LocaleStore, Transformer, TranslationService, Translator mock, CSV handlers) have unit tests covering edge cases (placeholders, empty strings, nested keys).

Phase B — CLI integration tests (compiled CLI)
Purpose: verify the actual CLI entrypoint and end-to-end command wiring, including `--json` & `--report` outputs and `--write` safety behavior.

Prereqs: build compiled CLI under `packages/cli/dist`.

Steps:
1. Run CLI integration test suite (existing vitest files that shell out to `dist/index.js`).

```bash
pnpm -w test --filter i18nsmith
```

2. Manually smoke test the primary commands (dry-run) in an isolated temp dir (use the included E2E fixture `basic-react`):

```bash
# from repo root
E2E_DIR=$(mktemp -d)
cp -R packages/cli/test/fixtures/basic-react "$E2E_DIR"
cd "$E2E_DIR"
node $(pwd)/../../packages/cli/dist/index.js diagnose --json --report ./diag.json
node $(pwd)/../../packages/cli/dist/index.js check --report ./check.json
node $(pwd)/../../packages/cli/dist/index.js scan --list-files --json > scan.json
node $(pwd)/../../packages/cli/dist/index.js sync --check
node $(pwd)/../../packages/cli/dist/index.js translate --export missing.csv
node $(pwd)/../../packages/cli/dist/index.js translate --import missing.csv
```

3. Acceptance:
   - Commands exit with appropriate codes (0 on no issues; non-zero for expected failure modes). The JSON files are well-formed and conform to the documented schema (spot-check keys like `localePreview`, `diffs`, `actionableItems`).
   - `sync --check` must not write files. `sync --write` must create backups (verify `.i18nsmith-backup/<timestamp>` exists) and not remove keys unless `--prune` is passed.

Phase C — E2E fixtures (full workflows)
Purpose: exercise realistic repository layouts and the full end-to-end workflows (transform → sync → translate → scaffold-adapter / provider injection). This is the pre-Phase-5 gate.

Fixtures to exercise (examples):
- basic-react (simple app)
- nested-locales (mixed nested and flat shape)
- suspicious-keys (keys that look like sentences)

For each fixture run the following pipeline (dry-run then write where indicated):
1. `diagnose --report diag.json`
2. `check --report check.json` (dry-run)
3. `transform --write --target <small subset>` (on a copy of fixture; ensure provider dependency checks are surfaced)
4. `sync --check` then `sync --write --seed-target-locales --seed-value "[TODO]"`
5. `translate --export missing.csv --locales fr,de`
6. Have a prepared filled CSV (fixture or generate using mock adapter) and run `translate --import filled.csv --write`.
7. `sync --check` final; `diff` + `--patch-dir` to persist patches.
8. **NEW:** Test auto-rename on suspicious-keys fixture: `sync --auto-rename-suspicious --write` and verify source + locale updates.
9. **NEW:** Test sortKeys with different modes and verify key ordering behavior.

Acceptance:
- No data loss: backups exist for destructive writes, and `rollback` restores the pre-write state. Verify by making a deliberate change, running `sync --write --prune` with a small set, and calling `rollback` to restore.
- Provider scaffolding does not overwrite existing providers unless `--force` is passed.
- Auto-rename applies safe proposals and skips conflicting ones.
- sortKeys modes produce expected key ordering in locale files.

Phase D — Translation provider tests
Purpose: validate adapters and safety around paid providers; ensure `mock` behaves and `--estimate` works.

Steps:
1. Use `translation.provider: "mock"` in a test fixture config and run `translate --write --provider mock` and verify pseudo-localized outputs are applied.
2. For adapters that support `estimateCost`, run `translate --estimate` and verify output contains an estimated cost and does not call the write path.
3. For any real adapters (if integration keys available), run in a gated environment with `--estimate` first and then `--write` using a non-production key and an isolated fixture.

Acceptance:
- Mock adapter outputs prefix `[locale]` and accenting of vowels for sample strings.
- Placeholder mismatches are detected and flagged; `--strict-placeholders` fails with non-zero exit code when issues exist.

Phase E — Performance & caching
Purpose: quantify benefits of file reference cache and ensure correctness of `--invalidate-cache`.

Benchmark steps:
1. On a larger fixture, run `time node packages/cli/dist/index.js sync --check` (cold run).
2. Repeat same command (warm run) and record wall-clock times.
3. Run with `--invalidate-cache` and confirm time reverts to near cold-run.

Acceptance:
- Warm run should be significantly faster (suggested target: >= 2–3x speed improvement on large fixtures). If not, profile and identify hotspots.

Phase F — Machine outputs, exit codes & CI gating
Purpose: validate `--json` and `--report` outputs for automation and confirm deterministic exit codes for key failure classes.

Steps:
1. Run `diagnose --json --report diag.json` and validate JSON schema keys like `locales`, `packages`, `providers`, `conflicts`.
2. Trigger conditions for known exit codes (e.g., temporarily remove source locale `en.json` and run `diagnose` to get exit code `2`).

Acceptance:
- JSON outputs are machine-parseable and include required fields; exit codes match documentation.

Phase G — Regression & fuzzing checks
Purpose: exercise various edge cases for placeholders, nested vs flat locales, dynamic keys, template literal key calls.

Tests to include:
- Interpolation formats (`{{name}}`, `%{count}`, `%s`)
- Empty/placeholder markers (`todo`,`TBD`) detection
- Dynamic key expressions warnings and `--assume` behavior
- `rewrite-shape` command correctness (convert between nested and flat)

Acceptance:
- No crashes; clear actionable items emitted; conversions preserve values where possible.

Phase H — Key normalization & sorting (Latest features)
Purpose: validate `sortKeys` configuration and `--auto-rename-suspicious` workflow for normalizing problematic keys.

**H.1 — sortKeys option tests**

Steps:
1. Create a test fixture with unsorted locale keys:

```bash
TEST_DIR=$(mktemp -d)
mkdir -p "$TEST_DIR/locales"
cat > "$TEST_DIR/i18n.config.json" << 'EOF'
{
  "sourceLanguage": "en",
  "targetLanguages": ["fr"],
  "localesDir": "locales",
  "include": ["src/**/*.tsx"],
  "locales": {
    "sortKeys": "preserve"
  }
}
EOF

cat > "$TEST_DIR/locales/en.json" << 'EOF'
{
  "zebra": "Zebra",
  "apple": "Apple",
  "mango": "Mango"
}
EOF
```

2. Add a new key via sync and verify original order is preserved:

```bash
cd "$TEST_DIR"
mkdir -p src
cat > src/App.tsx << 'EOF'
import { useTranslation } from 'react-i18next';
export function App() {
  const { t } = useTranslation();
  return <div>{t('banana')}</div>;
}
EOF

node /path/to/cli/dist/index.js sync --write
```

3. Verify locale file has keys in order: `zebra`, `apple`, `mango`, `banana` (original order preserved, new key appended).

4. Repeat test with `"sortKeys": "alphabetical"` and verify keys are sorted: `apple`, `banana`, `mango`, `zebra`.

5. Repeat test with `"sortKeys": "insertion"` and verify keys maintain insertion order.

Acceptance:
- `preserve` mode maintains original key order from disk and appends new keys at end (sorted alphabetically among new keys).
- `alphabetical` mode (default) sorts all keys alphabetically every write.
- `insertion` mode maintains object insertion order without re-sorting.
- No locale file diffs when re-running sync without changes (deterministic output).

**H.2 — Auto-rename suspicious keys workflow**

Steps:
1. Use the `suspicious-keys` E2E fixture (already contains keys like `"Hello World"`, `"Click Here"`, `"Save"`).

2. Run auto-rename analysis (dry-run):

```bash
cd packages/cli/test/fixtures/suspicious-keys
node $(pwd)/../../../dist/index.js sync --auto-rename-suspicious --rename-map-file proposals.txt
```

3. Verify:
   - Console output shows safe proposals with transformations (e.g., `"Hello World" → "common.hello-world"`).
   - Conflict proposals are flagged when destination keys already exist.
   - `proposals.txt` is created with mapping in commented format.
   - No files are modified (dry-run).

4. Run with `--write` to apply proposals:

```bash
node $(pwd)/../../../dist/index.js sync --auto-rename-suspicious --write
```

5. Verify:
   - Source files updated: `t('Hello World')` → `t('common.hello-world')`.
   - Locale files updated: old keys removed, new normalized keys added with same values.
   - All target locales (e.g., `fr`) also get renamed keys.
   - Backup created in `.i18nsmith-backup/<timestamp>/`.
   - Default mapping saved to `.i18nsmith/auto-rename-map.json`.

6. Test with custom naming convention:

```bash
node $(pwd)/../../../dist/index.js sync --auto-rename-suspicious --write --naming-convention camelCase
```

7. Verify keys use camelCase format (e.g., `common.helloWorld`).

8. Test conflict detection:

```bash
# Add a key that will conflict with a proposal
echo '{"common.hello-world": "Existing", "Hello World": "New"}' > locales/en.json
node $(pwd)/../../../dist/index.js sync --auto-rename-suspicious
```

9. Verify conflict is reported and proposal is marked unsafe.

Acceptance:
- Dry-run mode shows proposals without modifying files.
- `--write` mode applies safe proposals atomically across source + all locale files.
- Rename mapping file is generated (default or custom path).
- Conflicts are detected and reported; conflicting proposals are not applied.
- Naming convention flag (`--naming-convention`) affects output format.
- Original locale file backups are created before writes.
- E2E test `should auto-rename suspicious keys when --write is provided` passes.

**H.3 — Combined sortKeys + auto-rename test**

Steps:
1. Create fixture with `sortKeys: "preserve"` and suspicious keys.
2. Run `sync --auto-rename-suspicious --write`.
3. Verify:
   - Keys are normalized (suspicious → proper format).
   - Original non-suspicious keys maintain their order.
   - New normalized keys are appended at end in alphabetical order among themselves.

Acceptance:
- Both features work correctly when combined.
- No unexpected key reordering beyond the specified `sortKeys` policy.

Phase H — Accessibility, security, and privacy checks
- Ensure no secrets are written to disk: `translation.secretEnvVar` must be read at runtime only.
- Confirm scaffolding does not include insecure defaults.
- Verify auto-rename mapping files don't leak sensitive data (should only contain key names, not values).

Phase I — Latest features integration
Purpose: comprehensive validation of recently added features to ensure they work correctly in combination with existing functionality.

**I.1 — Diff noise reduction (sortKeys)**

Real-world scenario test:
1. Clone a fixture, run sync with default (alphabetical) sorting.
2. Record git diff line count.
3. Switch config to `"sortKeys": "preserve"`.
4. Add one new key via sync --write.
5. Verify git diff shows only the new key addition, not full file reformatting.

Acceptance:
- `preserve` mode reduces diff noise to only actual changes (new/removed/updated keys).
- Existing projects can adopt i18nsmith without massive reformatting commits.

**I.2 — Auto-rename + manual review workflow**

Steps:
1. Run `sync --auto-rename-suspicious --rename-map-file review.json` (dry-run).
2. Manually edit `review.json` to adjust some proposals.
3. Apply edited mapping: `rename-keys --map review.json --write`.
4. Verify custom-edited renames were applied correctly.

Acceptance:
- Two-step workflow (generate → review → apply) works for teams that want manual control.
- Mapping file format is easy to edit (JSON or commented text).

**I.3 — Performance regression check for sortKeys**

Steps:
1. Create large fixture with 1000+ keys in random order.
2. Time `sync --write` with each sortKeys mode (alphabetical, preserve, insertion).
3. Verify no significant performance degradation (< 10% difference between modes).

Acceptance:
- All sortKeys modes have similar performance characteristics.
- No O(n²) sorting behavior detected.

CI integration checklist (for Phase 5 gating)
- Create GitHub Actions workflows that run:
  - Lint & TypeScript build (fast-fail)
  - Unit tests (parallel) across Node LTS versions
  - CLI integration tests (single VM with compiled CLI)
  - E2E fixtures run (serial) with artifacts (reports, patch-dir, csv exports) uploaded on failure
  - Performance smoke (optional; run weekly)

Failure handling & triage
- All test failures must produce an artifact: logs, JSON reports, and failing fixture copies for reproduction.
- Triage process: assign to code owner, create issue with reproducer, mark regressions in the changelog.

Maintenance & flake policy
- Flaky tests must be marked and quarantined with a ticket to fix within 3 working days.
- CI should re-run flaky tests only with exponential backoff (3 retries) and report flakiness metrics.

How to run locally (quick checklist)
1. Build packages: `pnpm -w build`
2. Run unit tests: `pnpm -w test --filter @i18nsmith/core`
3. Run CLI tests: `pnpm -w test --filter i18nsmith`
4. Run an E2E fixture: copy a fixture into a temp dir and run the manual smoke pipeline listed above.

Documentation & artifacts
- The CI job should persist these artifacts on failure:
  - `diag.json`, `check.json`, `scan.json`
  - CSV exports/imports used in tests
  - `--patch-dir` artifacts for diffs
  - `pnpm -w test` logs and vitest snapshots

Sign-off criteria to begin Phase 5
1. All unit & integration tests pass in CI (green across matrix).
2. E2E fixtures pass in CI with no destructive writes (or writes guarded behind explicit flags and backups verified).
3. Performance baseline recorded and acceptable (documented in this plan as an appendix).
4. Testing artifacts and JSON outputs are stable and documented for editor/CI consumption.
5. **New features validated:**
   - `sortKeys` configuration tested with all three modes (alphabetical, preserve, insertion).
   - `--auto-rename-suspicious --write` workflow tested end-to-end with fixture.
   - Diff noise reduction verified (preserve mode shows minimal diffs).
   - Auto-rename mapping export/import workflow validated.
   - Combined feature scenarios tested (sortKeys + auto-rename).

Appendix A — Minimal checklist for a single reviewer
- Run `pnpm -w build` and `pnpm -w test` (all packages) locally.
- Pick one fixture and run the full E2E pipeline (diagnose → check → sync seed → translate export/import → sync final).
- Verify backups and rollback.
- Check placeholder validation and `--strict-placeholders` behavior.
- **Test sortKeys:** Add a key to a fixture with `sortKeys: "preserve"` and verify original order maintained.
- **Test auto-rename:** Run `sync --auto-rename-suspicious --write` on suspicious-keys fixture and verify keys normalized.

Appendix B — Helpful commands

```bash
# Build
pnpm -w build

# Run all tests
pnpm -w test

# Run CLI integration tests
pnpm -w test --filter i18nsmith

# Example single E2E flow (from repo root)
cd /tmp
cp -R /path/to/repo/packages/cli/test/fixtures/basic-react ./fixture
cd fixture
node /path/to/repo/packages/cli/dist/index.js diagnose --report diag.json
node /path/to/repo/packages/cli/dist/index.js check --report check.json
node /path/to/repo/packages/cli/dist/index.js sync --write --seed-target-locales --seed-value "[TODO]"
node /path/to/repo/packages/cli/dist/index.js translate --export missing.csv --locales fr
node /path/to/repo/packages/cli/dist/index.js translate --import missing.csv --write

# Test sortKeys preserve mode
cd /tmp
mkdir test-sortkeys && cd test-sortkeys
cat > i18n.config.json << 'EOF'
{
  "sourceLanguage": "en",
  "targetLanguages": ["fr"],
  "localesDir": "locales",
  "include": ["src/**/*.tsx"],
  "locales": { "sortKeys": "preserve" }
}
EOF
mkdir -p locales src
echo '{"zebra": "Z", "apple": "A", "mango": "M"}' > locales/en.json
echo 'import {useTranslation} from "react-i18next"; export default () => {const {t}=useTranslation(); return <div>{t("banana")}</div>}' > src/App.tsx
node /path/to/repo/packages/cli/dist/index.js sync --write
# Verify locales/en.json has: zebra, apple, mango, banana (order preserved)

# Test auto-rename suspicious keys
cd /path/to/repo/packages/cli/test/fixtures/suspicious-keys
node /path/to/repo/packages/cli/dist/index.js sync --auto-rename-suspicious --rename-map-file proposals.txt
# Review proposals.txt
node /path/to/repo/packages/cli/dist/index.js sync --auto-rename-suspicious --write
# Verify src/BadKeys.tsx and locales/*.json updated

# Test auto-rename with custom naming convention
node /path/to/repo/packages/cli/dist/index.js sync --auto-rename-suspicious --write --naming-convention camelCase
# Verify keys use camelCase (e.g., common.helloWorld)
```

Contact & escalation
- If CI shows failures that are not reproducible locally, attach all artifacts to the issue and ping the maintainers on the `#i18nsmith` channel.

---

This plan is intentionally strict. If you'd like, I can also:
- Generate GitHub Actions YAML that runs the above suites and uploads artifacts.
- Produce a short checklist PR template for reviewers to follow when they sign-off on readiness.
