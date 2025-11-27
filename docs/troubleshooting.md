# Troubleshooting Guide

Common issues and solutions for i18nsmith.

## Table of Contents

- [Suspicious Key Detection](#suspicious-key-detection)
- [Target Locale Issues](#target-locale-issues)
- [Key-Value Patterns](#key-value-patterns)
- [Placeholder Validation](#placeholder-validation)
- [Sync Behavior](#sync-behavior)
- [CLI Issues](#cli-issues)

---

## Suspicious Key Detection

### "Why are my keys showing as suspicious?"

i18nsmith validates translation keys against common patterns that indicate potential issues. Keys may be flagged for several reasons:

#### Contains Spaces
**Issue:** Key `"When to Use Categorized View:"` flagged as suspicious.  
**Reason:** Translation keys should not contain spaces—they look like literal text rather than identifiers.  
**Solution:** Use dot-delimited namespaces: `"guide.whenToUseCategorizedView"`

#### Single Word Without Namespace
**Issue:** Key `"save"` flagged as suspicious.  
**Reason:** Single-word keys without namespaces often indicate untransformed text.  
**Solution:** Add a namespace: `"actions.save"` or `"buttons.save"`

#### Starts with Number
**Issue:** Key `"3dModelViewer"` flagged as suspicious.  
**Reason:** Keys starting with numbers may cause issues in some systems.  
**Solution:** Prefix with namespace: `"components.threeDModelViewer"`

#### Sentence-like Pattern
**Issue:** Key `"PleaseEnterValidEmail"` flagged as suspicious.  
**Reason:** CamelCase phrases that read like sentences suggest literal text.  
**Solution:** Use semantic identifiers: `"validation.emailInvalid"`

#### Key Equals Value
**Issue:** Key `"Save"` with value `"Save"` flagged.  
**Reason:** When key and value are identical, it often means the key is literal text.  
**Solution:** Use semantic keys: `"buttons.save": "Save"`

### Handling Suspicious Keys

Configure suspicious key policy in `i18nsmith.config.json`:

```json
{
  "suspiciousKeyPolicy": "allow",  // "allow" | "skip" | "error"
  "suspiciousPatterns": [
    "^(button|btn)_",      // Skip legacy patterns
    "^LEGACY_"             // Skip deprecated keys
  ]
}
```

- `"allow"`: Transform all keys (default)
- `"skip"`: Skip transformation of suspicious keys
- `"error"`: Fail build on suspicious keys

---

## Target Locale Issues

### "Why are my target locales being cleared?"

If translations in target locales (`fr.json`, `de.json`, etc.) are being removed unexpectedly:

#### Check retainLocales Setting
By default, i18nsmith preserves existing translations. If they're being removed:

```json
{
  "retainLocales": true
}
```

#### Check Sync Mode
Running sync with write mode will modify files:

```bash
# Dry run first to see what would change
i18nsmith sync

# Only write if changes look correct
i18nsmith sync --write
```

### "Why aren't new keys appearing in target locales?"

i18nsmith only adds keys to target locales when:

1. **Key is discovered in code** (missing from source locale)
2. **`seedTargetLocales` is enabled**

```json
{
  "seedTargetLocales": true
}
```

This adds new keys with empty values to all target locales, making them easy to spot for translators.

#### Keys Already in Source Locale
If a key already exists in the source locale, it's not considered "missing" and won't be seeded. This is intentional—existing source keys are assumed to already exist in target locales if they've been translated.

---

## Key-Value Patterns

### "Why do I see key=value patterns?"

When a translation key equals its value (e.g., `"Save": "Save"`), it usually indicates:

1. **Untransformed literal text** - The text wasn't replaced with a proper key
2. **Missing value generation** - Key was created but no value was assigned
3. **Intentional placeholder** - Sometimes acceptable for single-word translations

#### Detecting Key=Value Issues

Run the audit command:

```bash
i18nsmith audit --key-equals-value
```

#### Fixing Key=Value Issues

1. **Use semantic keys:**
   ```json
   // Before
   { "Save": "Save" }
   
   // After
   { "actions.save": "Save" }
   ```

2. **Configure value generation:**
   ```json
   {
     "keyValueRule": "sentence",  // Generate sentence-case values
     "keyDelimiter": "."
   }
   ```

---

## Placeholder Validation

### "Why are placeholder mismatches being reported?"

i18nsmith validates that placeholders in translations match across locales:

```json
// en.json
{ "greeting": "Hello {name}, you have {count} messages" }

// fr.json - MISMATCH: missing {count}
{ "greeting": "Bonjour {name}" }
```

#### Checking Placeholders

```bash
i18nsmith audit --placeholders
```

#### Common Placeholder Issues

1. **Different names:** `{name}` vs `{userName}`
2. **Missing placeholders:** Target missing placeholders from source
3. **Extra placeholders:** Target has placeholders not in source
4. **Type mismatches:** `{count, number}` vs `{count}`

### Placeholder Format Support

i18nsmith supports:
- **ICU format:** `{name}`, `{count, number}`, `{date, date, short}`
- **React/i18next format:** `{{name}}`, `{{count}}`
- **Custom patterns:** Configurable via regex

---

## Sync Behavior

### "Why isn't sync detecting all my keys?"

#### Check Include Patterns

Ensure your file patterns cover all source files:

```json
{
  "include": [
    "src/**/*.{ts,tsx,js,jsx}",
    "app/**/*.{ts,tsx}",          // Next.js App Router
    "pages/**/*.{ts,tsx}"         // Next.js Pages Router
  ],
  "exclude": [
    "**/*.test.{ts,tsx}",
    "**/*.spec.{ts,tsx}"
  ]
}
```

#### Check Dynamic Key Handling

Dynamic keys (computed at runtime) can't be statically analyzed:

```typescript
// Static - will be detected
t('buttons.save')

// Dynamic - won't be detected
const key = 'buttons.' + action;
t(key)
```

Configure dynamic key globs:

```json
{
  "dynamicKeyGlobs": [
    "actions.*",
    "features.*.title"
  ]
}
```

### "Why are some keys marked as unused?"

Keys detected in locale files but not found in code are flagged as potentially unused:

```bash
i18nsmith audit --unused
```

**Common false positives:**
- Dynamic keys (covered by `dynamicKeyGlobs`)
- Keys used in other repositories
- Keys used in configuration files

Mark keys as intentionally retained:

```json
{
  "retainKeys": [
    "legal.*",
    "external.*"
  ]
}
```

---

## CLI Issues

### "Command not found: i18nsmith"

Ensure the CLI is installed globally or use npx:

```bash
# Install globally
npm install -g @i18nsmith/cli

# Or use npx
npx @i18nsmith/cli sync
```

### "Config file not found"

i18nsmith looks for configuration in order:
1. `i18nsmith.config.json`
2. `i18nsmith.config.js`
3. `.i18nsmithrc`
4. `package.json` (`i18nsmith` field)

Generate a default config:

```bash
i18nsmith init
```

### "Permission denied errors"

Check file permissions on locale files:

```bash
chmod 644 locales/*.json
```

---

## Getting Help

If you're still stuck:

1. **Check verbose output:** `i18nsmith sync --verbose`
2. **Run diagnostics:** `i18nsmith diagnose`
3. **Open an issue:** Include config, error message, and minimal reproduction

See also:
- [Best Practices Guide](./best-practices.md)
- [API Documentation](./api.md)
- [Configuration Reference](./configuration.md)
