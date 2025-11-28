# Translation Workflows (Manual → External → Automated)

This recipe explains three safe, incremental workflows for filling missing translations: Manual seeding, External CSV handoff, and Automated provider-driven translation. Each workflow is compatible with the `i18nsmith` safety rails (dry-run default, placeholder validation, atomic locale writes).

## 1) Manual — seed locale files and edit in-place

When you want to avoid any machine translation or external handoff, seed missing keys into target locale files so translators can edit JSON directly (or via an editor). This is the lowest-risk option.

CLI:

```bash
# Add missing keys to target locales with empty values (dry-run shows preview)
i18nsmith sync --check

# Apply seeding to create the keys (use --seed-value to use a TODO marker)
i18nsmith sync --write --seed-target-locales --seed-value "[TODO]"
```

Notes:
- `seedValue` can be set globally in `i18n.config.json` under `sync.seedValue`.
- The seed step will not overwrite existing translations.
- Backups are created automatically before any `--write` operation.

## 2) External — CSV handoff for non-technical translators

Export only the missing keys to a CSV, send to translators, then import the completed CSV back into locale files.

CSV format (header row included):

```
key,sourceLocale,sourceValue,targetLocale,translatedValue
greeting,en,Hello,fr,
```

Export missing translations:

```bash
i18nsmith translate --export missing.csv --locales fr,de
```

When translators fill `translatedValue`, import and apply:

```bash
i18nsmith translate --import filled.csv --write
```

Important:
- Import matches rows by `key` (not by line order) so reordering is safe.
- The importer validates placeholder consistency (e.g., `{{name}}`) and will surface issues during dry-run or fail on `--strict-placeholders`.
- Use `--dry-run`/`--check` first to confirm what will be written.

## 3) Automated — pluggable translation providers

Automated translation uses adapters that implement the `Translator` contract. This is convenient but requires API keys; use `--estimate` to check cost first.

Example:

```bash
# Estimate cost & plan (no writes)
i18nsmith translate --estimate --locales fr --provider deepl

# Apply translations
i18nsmith translate --locales fr --provider deepl --write
```

Tips & safety
- Configure adapters by setting `translation.provider` and `translation.secretEnvVar` in `i18n.config.json`. Never store secret values directly in the config.
- Interactive confirmation is required for paid adapters unless you pass `--yes`.
- Use `--force` to overwrite existing translations, otherwise only missing keys are translated.
- The `mock` adapter is great for UI tests (pseudo-localization): `i18nsmith translate --provider mock --write`.

## Acceptance checklist

- Manual: `sync --write --seed-target-locales` creates keys in target locale files and preserves existing values.
- External: `translate --export` produces a usable CSV and `translate --import` merges translations by key while validating placeholders.
- Automated: `translate --estimate` reports character counts and a cost estimate when available, and `translate --write` updates locale files atomically.

## Troubleshooting

- Placeholders failing validation: run `i18nsmith sync --validate-interpolations` to surface mismatches and inspect the offending keys.
- Import missing rows or mismatched keys: ensure `key` column matches exact dotted keys used in locale JSON.
- Large CSVs: split by locale or namespace and import progressively to reduce merge conflicts.

## Example end-to-end sequence (recommended starter flow)

1. `i18nsmith diagnose --report .i18nsmith/diag.json`
2. `i18nsmith check --report .i18nsmith/check.json` (review actionable items)
3. `i18nsmith sync --write --seed-target-locales` (seed targets)
4. `i18nsmith translate --export missing.csv --locales fr,de`
5. Send `missing.csv` to translators; receive `filled.csv`.
6. `i18nsmith translate --import filled.csv --write`
7. `i18nsmith sync --check` to ensure no drift remains

---

This recipe is intentionally conservative. It lets teams choose a low-risk path first (seed + manual edits), then move to CSV handoffs, and finally adopt automated adapters when comfortable. See `i18n.config.json` keys referenced above for configuration knobs and `--help` for each command for additional flags.
