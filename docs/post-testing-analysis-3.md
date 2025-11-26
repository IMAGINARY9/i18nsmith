# Post-Testing Analysis 3: Retest Findings (2025-11-26)

## Overview
Following the implementation of critical fixes (Phase 3.18), a retest was performed on the `bilinmenu` repository. While some issues were resolved, significant blocking issues persist regarding data integrity, key transformation, and locale preservation.

## Critical Issues Detected

### 1. Persistence of "Text-as-Key" Patterns
**Observation:**
The `en.json` file still contains entries where the key is a long English string, and the value is identical to the key.
```json
{
  "Menu items have 100+ tags available": "Menu items have 100+ tags available",
  "Menu items have 20-50 tags total": "Menu items have 20-50 tags total"
}
```
**Analysis:**
- This indicates that the `Transformer` did not successfully transform these strings into structured keys (e.g., `menu.tags.available`).
- Alternatively, if these were already in the code as `t('Menu items...')`, the `Syncer` correctly identified them as used keys but failed to flag them as "suspicious" or offer a migration path to structured keys.
- The `KeyGenerator` should ideally flag these or the `Transformer` should have a mode to force-migrate text-as-keys to structured keys.

### 2. Target Locale Data Loss (Clearing of fr, it, de)
**Observation:**
The user reported that "other detected locales (fr, it, de) was cleared, not saved and not even marked."
**Analysis:**
- This suggests a catastrophic failure in the `Syncer`'s pruning logic or the `Transformer`'s seeding logic.
- If `en.json` contained keys that were considered "unused" (perhaps because the scanner missed them, or they were dynamic), the `Syncer` would prune them from *all* locales.
- Even with the new `retainLocales` flag (implemented in 3.18.4), if it wasn't enabled in the user's config, the default behavior is still to prune unused keys.
- **Root Cause Hypothesis:** The scanner might be missing references (e.g., in `src/app/**` as noted in the report), causing the `Syncer` to think those keys are unused, leading to their deletion from all locales.

### 3. Incomplete File Processing
**Observation:**
"Other files wasn't processed at all."
**Analysis:**
- The report mentions "289 files scanned", but the user implies many files were skipped.
- This could be due to:
    - `include` glob patterns not matching the file structure (e.g., `src/app` vs `pages`).
    - Files being skipped due to syntax errors or missing `useTranslation` hooks (though the transformer should inject them).
    - The `Scanner` might be failing silently on certain file types or constructs.

### 4. Value = Key Issue
**Observation:**
Entries like `"marketplace.subtitle": "marketplace.subtitle"`.
**Analysis:**
- This happens when a key is added (seeded) but no value is provided, and the fallback strategy defaults to the key itself.
- While better than empty strings for some runtimes, it degrades the user experience.
- We need to ensure that when migrating or seeding, we try to find a better source value (e.g., from the code itself if it was a transformation).

## Action Plan

### Immediate Fixes (Phase 3.19)

1.  **Fix Target Locale Clearing (Safety First):**
    - **Status:** ✅ **Completed**
    - **Change Default:** `retainLocales` now defaults to `true` in `loadConfig`. This prevents `Syncer` from pruning target locales when keys are missing from source/code.

2.  **Force Migration of Text-as-Keys:**
    - **Status:** ✅ **Completed**
    - **Implementation:** Added `--migrate-text-keys` flag to `transform` command.
    - **Logic:** `Scanner` now detects `t('String with spaces')` calls, including property/element access patterns like `i18n.t('...')`, `props?.t('...')`, and `obj['t']('...')`. `Transformer` generates structured keys for them, updates the code, and copies the existing localized values into the new keys—even when `seedTargetLocales` is disabled.

3.  **Scanner Robustness:**
    - **Status:** ✅ **Completed**
    - **Note:** Added `scanCalls` capability plus broader detection of translation call shapes. Default include globs now cover both `src/` and Next.js `app/`/`pages/` directories, common build outputs (e.g., `.next/`, `dist/`) are excluded automatically, and `i18nsmith scan --list-files` can print the exact files matched to catch gaps quickly. Scanner now treats no-substitution template literals the same as string literals across JSX attributes/expressions and `t()` calls, so text embedded in template strings is no longer skipped. Continue monitoring for non-React file gaps, but template literal coverage is handled.

4.  **Value Generation:**
    - **Status:** ✅ **Verified**
    - **Note:** `Transformer` now prefers any legacy locale value tied to the detected text-as-key before touching fallbacks, and the `Syncer` only uses the humanized key (`account.name` → `Account Name`) when no reusable text exists. This keeps earlier copy intact whenever it was previously mapped, with the generator acting strictly as a backup.

5.  **Namespace-based dynamic key allowlists:**
    - **Status:** ✅ **Completed**
    - **Note:** `sync.dynamicKeyGlobs` lets us treat whole namespaces (e.g., `relativeTime.*`, `navigation.**`) as runtime-only so broad groups no longer flood the report with unused-key noise. The globs expand lazily from locale files—which keeps reports readable while still preventing accidental pruning.

## Recommendations for User
1.  **Enable `retainLocales: true`** in `i18n.config.json` immediately to stop data loss.
2.  **Check `include` globs:** Ensure `src/**/*.{ts,tsx}` covers all needed files.
3.  **Run `diagnose`:** Check if the scanner is actually seeing the files.
