## Resolve Placeholder Issues — purpose and concrete example

Is this action important?

Yes. "Resolve Placeholder Issues" focuses on interpolation/token mismatches between the source code and locale strings. These issues break runtime formatting or result in missing interpolation values at runtime. They are distinct from locale drift (missing keys or unused keys) and should be handled separately because their fixes are usually token edits inside existing locale values rather than adding or removing keys.

When it should be used

- When your code calls the translation with named placeholders (e.g. `t('greeting', { name })`) but the locale string uses a different token name (e.g. `{username}`), causing the runtime translator to receive no value for the locale token.
- When placeholder count or types differ (e.g. code passes `count` but locale lacks plural forms or tokens).

Example scenario (concrete files)

1) Source file (React / TSX)

```tsx
// src/App.tsx
function Welcome({ userName }: { userName: string }) {
  return <div>{t('welcome.message', { name: userName })}</div>;
}
```

2) Locale file before (source language `en`)

```json
// locales/en.json
{
  "welcome": {
    "message": "Welcome, {username}!"
  }
}
```

Problem

- The code passes a placeholder named `name` but the locale uses `{username}`. At runtime the translator will not replace `{username}` because the value is provided under `name`.

What the `Resolve Placeholder Issues` action should do (desired behavior)

1. Run a validation-only preview that detects placeholder mismatches without suggesting that missing keys be added. The preview should contain an explicit `placeholderIssues` section (in the CLI preview JSON) that lists which keys have mismatched tokens and what the expected tokens are.

2. Present a focused UI listing the mismatches. Example UI text:

  Title: Validate interpolations — 1 placeholder mismatch found

  - Key: `welcome.message`
    - Expected tokens: `name`
    - Found tokens in locale: `username`
    - Suggested fix: replace `{username}` → `{name}`

  Buttons: [Apply placeholder fixes] [Show full sync preview]

3. If the user clicks "Apply placeholder fixes":

- The extension should create a selection file that explicitly lists only the keys to change (so the CLI knows which entries to write). Example selection file generated under `.i18nsmith/selection-<ts>.json`:

```json
{
  "missing": [
    "welcome.message"
  ],
  "unused": []
}
```

Note: Even though the key exists in the locale, the selection file is used to instruct the CLI to apply targeted edits when the preview flow would otherwise skip or be conservative.

- The extension runs the CLI apply command (the exact form depends on CLI flags used in your project). Example:

```
i18nsmith sync --apply-preview --selection-file ".i18nsmith/selection-<ts>.json"
```

4. The CLI updates only the placeholder token(s) in-place and writes the modified locale file. Resulting `locales/en.json`:

```json
{
  "welcome": {
    "message": "Welcome, {name}!"
  }
}
```

5. Extension refreshes diagnostics and quick actions. The placeholder mismatch disappears. Because no missing keys were added, "Fix Locale Drift" does not need to run. The "Resolve Placeholder Issues" quick action should disappear (or report zero issues) after refresh.

Why this behavior matters

- It prevents the extension from showing the same full sync diff UI for a purely placeholder-level problem. Developers get a concise, actionable view and one-click fix that changes the token names instead of adding new keys or suggesting broad locale writes.
- It avoids accidentally adding missing keys when the user's intent is to keep tokens stable and only fix mismatches.

Edge cases & notes

- If the preview returns both placeholder issues and missing-key diffs, the extension should surface a combined message that explains both sets of findings and suggest running "Fix Locale Drift" for missing-key additions and "Resolve Placeholder Issues" for token normalization. In that case, the quick actions can still be separate, but the preview UI should make it clear both kinds of changes were found.
- Plurals and ICU-style messages sometimes require more than token rename — in such cases the placeholder action can only suggest fixes where they are safe and deterministic. More complex plural conversions should be routed to a human review in the preview UI.
- If automatic fixes are risky, the Apply flow can instead generate a patch in the preview editor and ask the user to review before writing.

Sample JSON snippet that a CLI might return as preview payload (illustrative)

```json
{
  "summary": {
    "missingKeys": [],
    "unusedKeys": [],
    "placeholderIssues": [
      {
        "key": "welcome.message",
        "expectedTokens": ["name"],
        "foundTokens": ["username"],
        "suggestedEdit": "Replace {username} with {name}"
      }
    ]
  },
  "args": ["--validate-interpolations"]
}
```

Quick checklist for implementers

- Ensure `preview-intents` can parse an explicit `--validate-interpolations` intent. (Already supported as `extraArgs`).
- In the extension, detect placeholder-only previews (placeholderIssues present and no diffs) and show a tailored placeholder preview UI rather than the full diff preview.
- When applying, write a selection file containing only placeholder keys and pass it to the CLI apply command so only those changes are written.

If you want, I can implement the focused placeholder preview UI in `packages/vscode-extension` (quick change) so the action becomes visibly distinct from "Fix Locale Drift". Would you like that now?
