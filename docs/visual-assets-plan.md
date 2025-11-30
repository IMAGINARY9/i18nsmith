# Visual Assets Plan (Phase 5)

## Goal
Capture concise GIFs / screenshots illustrating critical workflows to reduce onboarding friction and improve README scannability.

## Asset Inventory
| ID | Workflow | Type | Duration | Purpose | Placement |
|----|----------|------|----------|---------|-----------|
| VA1 | `init` interactive wizard | GIF | <15s | Show config prompts & merge flow | README Quick Start |
| VA2 | `diagnose` output | Screenshot | N/A | Highlight actionable items & conflicts | README Diagnose section |
| VA3 | `check` consolidated summary | GIF | <10s | Demonstrate suggested commands list | README Guided health check |
| VA4 | `sync --interactive` selection | GIF | <20s | Show checkbox selection & confirmation | Recipes / interactive sync |
| VA5 | `transform --dry-run --diff` single file | GIF | <10s | Reveal before/after unified diff | Before/After transform recipe |
| VA6 | `translate --estimate` cost preview | Screenshot | N/A | Surface character counts & provider cost | Translation workflows recipe |
| VA7 | `rename-keys --map --diff` | GIF | <12s | Preview batch rename diff output | README key rename workflow |
| VA8 | `backup-restore` flow | GIF | <10s | Demonstrate safety rollback | Backup & restore section |

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
