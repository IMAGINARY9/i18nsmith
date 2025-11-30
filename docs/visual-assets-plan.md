# Visual Assets Plan (Phase 5)

## Goal
Capture concise GIFs / screenshots illustrating critical workflows to reduce onboarding friction and improve README scannability.

## Asset Inventory
| ID | Workflow | Type | Duration | Purpose | Placement | Status |
|----|----------|------|----------|---------|-----------|--------|
| VA1 | `init` interactive wizard | GIF | <15s | Show config prompts & merge flow | README Quick Start | 🔲 TODO |
| VA2 | `diagnose` output | Screenshot | N/A | Highlight actionable items & conflicts | README Diagnose section | 🔲 TODO |
| VA3 | `check` consolidated summary | GIF | <10s | Demonstrate suggested commands list | README Guided health check | 🔲 TODO |
| VA4 | `sync --interactive` selection | GIF | <20s | Show checkbox selection & confirmation | Recipes / interactive sync | 🔲 TODO |
| VA5 | `transform --dry-run --diff` single file | GIF | <10s | Reveal before/after unified diff | Before/After transform recipe | 🔲 TODO |
| VA6 | `translate --estimate` cost preview | Screenshot | N/A | Surface character counts & provider cost | Translation workflows recipe | 🔲 TODO |
| VA7 | `rename-keys --map --diff` | GIF | <12s | Preview batch rename diff output | README key rename workflow | 🔲 TODO |
| VA8 | `backup-restore` flow | GIF | <10s | Demonstrate safety rollback | Backup & restore section | 🔲 TODO |

---

## GIF Storyboards

### VA1 · `init` Interactive Wizard
> **Status:** 🔲 TODO  
> **Duration target:** <15 seconds  
> **Placement:** README Quick Start section

#### Storyboard

| Step | Time | Action | Terminal Output / Notes |
|------|------|--------|-------------------------|
| 1 | 0:00 | Clear terminal, show prompt | `$ _` |
| 2 | 0:01 | Type command | `$ npx i18nsmith init` |
| 3 | 0:03 | Wizard starts | `? Source language: (en)` |
| 4 | 0:05 | User presses Enter | Default `en` accepted |
| 5 | 0:06 | Target locales prompt | `? Target languages: (es, fr, de)` |
| 6 | 0:08 | User types `es, fr` and presses Enter | Shows selection |
| 7 | 0:10 | Include patterns prompt | `? Include globs: (src/**/*.{ts,tsx})` |
| 8 | 0:11 | User presses Enter | Default accepted |
| 9 | 0:12 | Config written | `✔ Created i18n.config.json` |
| 10 | 0:14 | Suggested next steps | `Run 'i18nsmith diagnose' to check project health` |

#### Key Highlights
- Show default values being accepted quickly (low friction)
- Emphasize the config file creation confirmation
- End on actionable next-step suggestion

#### Recording Notes
- Use a clean demo project directory
- Pre-clear any existing `i18n.config.json`

---

### VA2 · `diagnose` Output
> **Status:** 🔲 TODO  
> **Type:** Screenshot  
> **Placement:** README Diagnose section

#### Storyboard

| Element | Description |
|---------|-------------|
| Header | `i18nsmith diagnose` command visible |
| Locales section | Shows detected locales (en.json, fr.json) with key counts |
| Dependencies section | Shows detected runtime (react-i18next) |
| Providers section | Shows detected provider file path |
| Actionable items | 2-3 warnings with severity icons (⚠️) |
| Conflicts section | Empty or shows one example conflict |
| Footer | Exit code and timestamp |

#### Key Highlights
- Clear sectioning with colored headers
- Actionable items should be visible and scannable
- Show both healthy items (✓) and warnings (⚠️)

#### Recording Notes
- Use fixture with intentional warnings (e.g., missing locale, suspicious key)
- Capture at 120 column width for readability

---

### VA3 · `check` Consolidated Summary
> **Status:** 🔲 TODO  
> **Duration target:** <10 seconds  
> **Placement:** README Guided health check section

#### Storyboard

| Step | Time | Action | Terminal Output / Notes |
|------|------|--------|-------------------------|
| 1 | 0:00 | Clear terminal | `$ _` |
| 2 | 0:01 | Type command | `$ npx i18nsmith check` |
| 3 | 0:03 | Summary header appears | `📋 i18nsmith Health Check` |
| 4 | 0:04 | Diagnostics section | `Locales: 2 ✓  Dependencies: 1 ✓` |
| 5 | 0:05 | Sync drift section | `Missing keys: 4  Unused keys: 2` |
| 6 | 0:06 | Actionable items table | Table with 3-4 items, severity, file refs |
| 7 | 0:08 | Suggested commands | `→ Run: i18nsmith sync --write` |
| 8 | 0:09 | Exit | Shows exit code in prompt |

#### Key Highlights
- Fast execution (<2s real time, shown sped up)
- Clear actionable output with copy-pasteable commands
- Show the "single command to fix" value proposition

#### Recording Notes
- Use fixture with drift to show interesting output
- Ensure suggested commands are fully visible

---

### VA4 · `sync --interactive` Selection
> **Status:** 🔲 TODO  
> **Duration target:** <20 seconds  
> **Placement:** Recipes / interactive sync section

#### Storyboard

| Step | Time | Action | Terminal Output / Notes |
|------|------|--------|-------------------------|
| 1 | 0:00 | Type command | `$ npx i18nsmith sync --interactive` |
| 2 | 0:02 | Dry-run summary appears | Shows missing/unused key counts |
| 3 | 0:04 | Missing keys checkbox prompt | `? Select missing keys to add:` |
| 4 | 0:06 | User toggles 2 of 4 items | Space bar presses, checkmarks appear |
| 5 | 0:09 | User confirms selection | Presses Enter |
| 6 | 0:10 | Unused keys checkbox prompt | `? Select unused keys to remove:` |
| 7 | 0:12 | User selects 1 item | Single toggle |
| 8 | 0:14 | Confirmation prompt | `Apply 2 additions and 1 removal? (Y/n)` |
| 9 | 0:16 | User confirms | Types `y` |
| 10 | 0:18 | Success output | `✔ Synced 2 locales` |

#### Key Highlights
- Interactive checkbox UI is the star
- Show selective approval (not all-or-nothing)
- Emphasize the confirmation step (safety)

#### Recording Notes
- Use fixture with 4+ missing keys, 2+ unused keys
- Pause briefly on each selection to show the UI

---

### VA5 · `transform --dry-run --diff` Single File
> **Status:** 🔲 TODO  
> **Duration target:** <10 seconds  
> **Placement:** Before/After transform recipe

#### Storyboard

| Step | Time | Action | Terminal Output / Notes |
|------|------|--------|-------------------------|
| 1 | 0:00 | Type command | `$ npx i18nsmith transform --dry-run --diff --target src/Button.tsx` |
| 2 | 0:02 | Scanning indicator | `Scanning 1 file...` |
| 3 | 0:03 | Diff header | `--- src/Button.tsx (before)` |
| 4 | 0:04 | Diff content | Red lines (removed), green lines (added) |
| 5 | 0:06 | Shows import injection | `+import { useTranslation } from 'react-i18next';` |
| 6 | 0:07 | Shows text replacement | `-<button>Save</button>` / `+<button>{t('button.save')}</button>` |
| 7 | 0:09 | Summary | `1 file, 3 keys extracted (DRY RUN)` |

#### Key Highlights
- Unified diff format is familiar to developers
- Color-coded additions/removals
- Clear "DRY RUN" indicator

#### Recording Notes
- Use a simple component with 2-3 hardcoded strings
- Ensure diff fits in terminal without horizontal scroll

---

### VA6 · `translate --estimate` Cost Preview
> **Status:** 🔲 TODO  
> **Type:** Screenshot  
> **Placement:** Translation workflows recipe

#### Storyboard

| Element | Description |
|---------|-------------|
| Command | `i18nsmith translate --estimate --locales fr,de` |
| Provider info | `Provider: deepl (via DEEPL_API_KEY)` |
| Per-locale table | Locale, Missing keys, Characters, Est. cost |
| Example row | `fr`, `12`, `1,245`, `~$0.02` |
| Total row | Bold total characters and cost |
| Footer | `Run with --write to apply translations` |

#### Key Highlights
- Cost transparency before committing
- Per-locale breakdown
- Clear next-step instruction

#### Recording Notes
- Mock or use real provider with small fixture
- Show at least 2 target locales

---

### VA7 · `rename-keys --map --diff`
> **Status:** 🔲 TODO  
> **Duration target:** <12 seconds  
> **Placement:** README key rename workflow

#### Storyboard

| Step | Time | Action | Terminal Output / Notes |
|------|------|--------|-------------------------|
| 1 | 0:00 | Show map file briefly | `cat rename-map.json` → `{"old.key": "new.key", ...}` |
| 2 | 0:03 | Type command | `$ npx i18nsmith rename-keys --map rename-map.json --diff` |
| 3 | 0:05 | Processing indicator | `Renaming 3 keys across 2 locales...` |
| 4 | 0:06 | Source file diff | Shows code changes (old key → new key) |
| 5 | 0:08 | Locale file diff | Shows JSON key renames |
| 6 | 0:10 | Summary | `3 keys renamed in 4 files (DRY RUN)` |
| 7 | 0:11 | Next step | `Add --write to apply changes` |

#### Key Highlights
- Map file format is simple JSON
- Diffs show both code and locale changes
- Atomic operation preview

#### Recording Notes
- Use fixture with 3 keys to rename
- Keep map file simple (3-4 entries)

---

### VA8 · `backup-restore` Flow
> **Status:** 🔲 TODO  
> **Duration target:** <10 seconds  
> **Placement:** Backup & restore section

#### Storyboard

| Step | Time | Action | Terminal Output / Notes |
|------|------|--------|-------------------------|
| 1 | 0:00 | Run a write operation | `$ npx i18nsmith sync --write --prune` |
| 2 | 0:02 | Backup created | `✔ Backup created: .i18nsmith-backup/2025-11-30T12-00-00/` |
| 3 | 0:04 | List backups | `$ npx i18nsmith backup-list` |
| 4 | 0:05 | Backup list shown | Table with timestamps and file counts |
| 5 | 0:07 | Restore command | `$ npx i18nsmith backup-restore --latest` |
| 6 | 0:09 | Restore confirmation | `✔ Restored 2 locale files from backup` |

#### Key Highlights
- Automatic backup creation on destructive operations
- Simple restore with `--latest` shortcut
- Safety net for accidental data loss

#### Recording Notes
- Use fixture with locale files that have content to restore
- Show the backup directory briefly if time permits

---

## Capture Environment
- Terminal: dark theme (high contrast, monospaced font).
- Width: 120 columns to avoid wrapping tables.
- Node version: LTS (current). Ensure deterministic output (use seeded small test repo fixture).

## Test Fixture
Create a lightweight fixture under `examples/phase5-demo/` containing:
- 6 React components with translatable strings.
- `locales/en.json`, `locales/fr.json` with partial translations.
- A dynamic key example (`t(`errors.${code}`)`).
- 2 suspicious keys (sentence-like).

## Recording Guidelines
- Start terminal cleared (`clear`).
- Run command; trim dead time; highlight key output lines with quick cursor pause.
- Keep GIF under target duration; optimize with 2 FPS for static sections, 8–10 FPS for interactive selections.

## Tooling
- macOS: `asciinema` for raw cast + `agg` to convert to GIF.
- Annotate with subtle border only; avoid overlaid text (use README captions instead).

## File Naming
```
assets/
  va1-init.gif
  va2-diagnose.png
  va3-check.gif
  va4-sync-interactive.gif
  va5-transform-diff.gif
  va6-translate-estimate.png
  va7-rename-keys.gif
  va8-backup-restore.gif
```

## Integration Checklist
- Add `assets/` folder (git-tracked, keep size reasonable < 2MB total).
- Update README sections to embed images with short alt text.
- Provide fallback text-only description for low-bandwidth / dark reader mode.

## Future Enhancements
- Short narrated MP4 (1 min) for homepage / marketing.
- Side-by-side diff visualization for transform (SVG overlay).
- Accessibility: Provide transcripts for interactive GIFs.

## Next Steps
1. Create `examples/phase5-demo` fixture.
2. Record VA1–VA3 first (core onboarding path).
3. Integrate into README; gather feedback.
4. Capture remaining assets; optimize GIF sizes.
