# Best Practices Guide

Guidelines for effective i18n management with i18nsmith.

## Table of Contents

- [Key Naming Conventions](#key-naming-conventions)
- [Namespace Organization](#namespace-organization)
- [Project Structure](#project-structure)
- [CI/CD Integration](#cicd-integration)
- [Migration Strategies](#migration-strategies)
- [Performance Tips](#performance-tips)

---

## Key Naming Conventions

### Use Semantic Keys

❌ **Avoid literal text as keys:**
```json
{ "Save": "Save" }
{ "Click here to continue": "Click here to continue" }
```

✅ **Use semantic identifiers:**
```json
{ "actions.save": "Save" }
{ "buttons.continue": "Click here to continue" }
```

### Consistent Delimiter Style

Choose one delimiter and use it consistently:

```json
// Dot notation (recommended)
{
  "auth.login.title": "Sign In",
  "auth.login.submit": "Log In"
}

// Alternatively: snake_case namespaces
{
  "auth_login_title": "Sign In",
  "auth_login_submit": "Log In"
}
```

Configure in `i18nsmith.config.json`:
```json
{
  "keyDelimiter": "."
}
```

### Key Structure Patterns

```
<namespace>.<component>.<element>
<feature>.<action>.<variant>
<page>.<section>.<item>
```

Examples:
```json
{
  "auth.login.title": "Sign In",
  "auth.login.emailLabel": "Email Address",
  "auth.login.passwordLabel": "Password",
  "auth.login.submit": "Log In",
  "auth.login.forgotPassword": "Forgot your password?",
  
  "auth.register.title": "Create Account",
  "auth.register.submit": "Sign Up"
}
```

### Avoid These Patterns

| ❌ Bad | ✅ Good | Reason |
|--------|---------|--------|
| `Save` | `actions.save` | Too generic, no namespace |
| `btn_save` | `buttons.save` | Avoid abbreviations |
| `3dViewer` | `viewer.threeDimensional` | Don't start with numbers |
| `Please enter email` | `validation.emailRequired` | Not a sentence |

---

## Namespace Organization

### By Feature/Module

Organize keys by application feature:

```
locales/
├── en.json
└── fr.json

// en.json
{
  "auth.login.title": "...",
  "auth.login.submit": "...",
  "dashboard.welcome": "...",
  "dashboard.stats.title": "...",
  "settings.profile.title": "...",
  "settings.notifications.email": "..."
}
```

### By Component Type (Alternative)

For component libraries or design systems:

```json
{
  "buttons.save": "Save",
  "buttons.cancel": "Cancel",
  "buttons.delete": "Delete",
  
  "labels.email": "Email",
  "labels.password": "Password",
  
  "messages.success": "Success!",
  "messages.error": "Something went wrong"
}
```

### Namespace Size Guidelines

| Namespace Size | Status | Action |
|----------------|--------|--------|
| 1-2 keys | ⚠️ Orphaned | Consider merging |
| 3-20 keys | ✅ Healthy | Good size |
| 20-50 keys | ⚠️ Large | Consider splitting |
| 50+ keys | ❌ Too large | Split into sub-namespaces |

Detect orphaned namespaces:
```bash
i18nsmith audit --orphans
```

---

## Project Structure

### Recommended Layout

```
project/
├── locales/
│   ├── en.json        # Source locale
│   ├── fr.json        # Target locales
│   ├── de.json
│   └── es.json
├── src/
│   └── ...
└── i18nsmith.config.json
```

### Multi-Namespace Files (Large Projects)

For larger projects, split by namespace:

```
project/
├── locales/
│   ├── en/
│   │   ├── auth.json
│   │   ├── dashboard.json
│   │   └── settings.json
│   ├── fr/
│   │   ├── auth.json
│   │   └── ...
│   └── ...
└── i18nsmith.config.json
```

Configure:
```json
{
  "localesDir": "locales",
  "localeFilePattern": "{locale}/{namespace}.json"
}
```

### Monorepo Structure

```
monorepo/
├── packages/
│   ├── web/
│   │   ├── locales/
│   │   └── i18nsmith.config.json
│   └── mobile/
│       ├── locales/
│       └── i18nsmith.config.json
└── shared/
    └── locales/         # Shared translations
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
name: i18n Validation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          
      - run: npm ci
      
      # Sync check (dry run)
      - name: Check sync status
        run: npx i18nsmith sync
        
      # Strict validation
      - name: Validate translations
        run: npx i18nsmith audit --strict
        
      # Check for duplicate values
      - name: Check duplicates
        run: npx i18nsmith audit --duplicates --min-duplicate-threshold 3
```

### Pre-commit Hook

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx i18nsmith sync
npx i18nsmith audit --strict
```

### Strict Mode Checks

`--strict` mode fails on:
- Suspicious key patterns
- Key equals value
- Empty values in source locale
- Placeholder mismatches

```bash
# Local development (warnings only)
i18nsmith sync

# CI/CD (fail on issues)
i18nsmith sync --strict
```

### Post-Sync Audit

Automatically run audit after sync:

```json
{
  "postSyncAudit": true,
  "strictMode": false    // Set true for CI
}
```

---

## Migration Strategies

### Incremental Migration

For existing projects with literal strings:

1. **Initial scan:**
   ```bash
   i18nsmith sync
   # Review the diff
   ```

2. **Configure suspicious key policy:**
   ```json
   {
     "suspiciousKeyPolicy": "skip"
   }
   ```

3. **Migrate file by file:**
   ```bash
   i18nsmith transform src/components/Button.tsx
   i18nsmith transform src/components/Form.tsx
   ```

4. **Gradually enable strict mode:**
   ```json
   {
     "suspiciousKeyPolicy": "allow",
     "strictMode": true
   }
   ```

### Big Bang Migration

For new projects or major refactors:

1. **Transform entire codebase:**
   ```bash
   i18nsmith transform src/
   ```

2. **Review and fix suspicious keys manually**

3. **Enable strict mode from day one:**
   ```json
   {
     "strictMode": true,
     "suspiciousKeyPolicy": "error"
   }
   ```

### Handling Legacy Keys

Preserve legacy keys during migration:

```json
{
  "retainKeys": [
    "legacy.*",
    "v1.*"
  ],
  "suspiciousPatterns": [
    "^legacy\\.",
    "^v1\\."
  ]
}
```

---

## Performance Tips

### Optimize Include Patterns

Narrow your include patterns to reduce scan time:

```json
{
  "include": [
    "src/**/*.tsx",
    "src/**/*.ts"
  ],
  "exclude": [
    "**/*.test.tsx",
    "**/*.stories.tsx",
    "**/node_modules/**",
    "**/dist/**"
  ]
}
```

### Cache Configuration

i18nsmith caches AST parsing. For large projects:

```json
{
  "cache": true,
  "cacheDir": ".i18nsmith-cache"
}
```

### Parallel Processing

For monorepos, run sync per package in parallel:

```bash
# package.json script
"i18n:sync": "pnpm -r --parallel run i18n:sync"
```

### Incremental Sync

Only process changed files:

```bash
i18nsmith sync --changed
```

---

## Quick Reference

### Common Commands

```bash
# Initialize config
i18nsmith init

# Scan and report (dry run)
i18nsmith sync

# Apply changes
i18nsmith sync --write

# Full audit
i18nsmith audit

# Strict mode audit
i18nsmith audit --strict

# Transform a file
i18nsmith transform path/to/file.tsx

# Check specific issues
i18nsmith audit --duplicates
i18nsmith audit --inconsistent
i18nsmith audit --orphans
i18nsmith audit --placeholders
i18nsmith audit --unused
```

### Config Cheat Sheet

```json
{
  // Locale settings
  "sourceLanguage": "en",
  "targetLanguages": ["fr", "de", "es"],
  "localesDir": "locales",
  
  // Key handling
  "keyDelimiter": ".",
  "suspiciousKeyPolicy": "skip",
  
  // Sync behavior
  "retainLocales": true,
  "seedTargetLocales": true,
  "removeUnused": false,
  
  // Validation
  "strictMode": false,
  "postSyncAudit": true,
  
  // Files
  "include": ["src/**/*.{ts,tsx}"],
  "exclude": ["**/*.test.tsx"]
}
```

---

See also:
- [Troubleshooting Guide](./troubleshooting.md)
- [Configuration Reference](./configuration.md)
- [API Documentation](./api.md)
