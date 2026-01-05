# Extraction / transform edge cases and long-term fixes

This doc captures tricky cases found during external testing and proposes long-term fixes.

## 1) JSX pluralization / concatenation patterns (manual review)

### Example

```tsx
{mapMarkers.length} location{mapMarkers.length !== 1 ? 's' : ''}
```

A naïve transform might try to extract just `"location"` or produce an awkward split like:

```tsx
{mapMarkers.length} {t('...location')}{mapMarkers.length !== 1 ? 's' : ''}
```

### Why this is hard

This is a *compound* phrase with:
- numeric interpolation
- a conditional suffix
- implicit plural logic tied to the same count variable

Any one-size-fits-all transform risks breaking grammar in many languages.

### Recommended long-term approach

#### Option A (safe default): **Skip + warn (recommended now)**
Detect the pattern and skip auto-transforming it. Emit a warning actionable item like:
- `Pluralization/concat expression detected; requires manual i18n review`

Detection heuristics (safe):
- JSXExpression where the surrounding siblings form a sentence and contain both:
  - a numeric expression (`{count}`)
  - adjacent text token
  - conditional expression appending a suffix

#### Option B (higher quality): ICU MessageFormat generation
Introduce an optional adapter mode that can extract such constructs into an ICU message:

```json
{"locations": "{count, plural, one {# location} other {# locations}}"}
```

Then rewrite code to:

```tsx
{t('locations', { count: mapMarkers.length })}
```

This requires:
- agreement on ICU support in runtime (i18next messageformat plugin, formatjs, etc.)
- a new placeholder extraction/validation strategy
- locale migration story

### What we do today

- Do **not** attempt to auto-transform this pattern.
- Keep extraction conservative and require manual edits for plural logic.

## 2) HTML/JSX attribute invariants

Example of a broken transform:

```diff
- type="email"
+ type={t('...')}
```

Long-term fix:
- Maintain a hard deny-list of attributes whose values are *never* translatable because they affect behavior:
  - `type`, `name`, `id`, `role`, `method`, `action`, `rel`, `target`, etc.

The scanner already limits to a small allow-list (alt/label/placeholder/title...). Keep that guardrail.

## 3) Fallback literals in code should seed locale values

Example:

```ts
setSetupError(t('auth.claim.invalidToken') || 'This invitation token is missing or invalid.')
```

Long-term fix:
- Extend reference extraction to recognize `t('key') || 'literal'` and treat `'literal'` as the preferred default source value for that key during sync.

This yields better seeded locale values and reduces the need for manual backfilling.
