# Auto Config Generation - Quick Reference

## TL;DR

i18nsmith can now intelligently detect your project configuration:

```bash
# See what would be detected
i18nsmith detect

# Initialize with smart defaults
i18nsmith init --yes

# Use a specific template
i18nsmith init --template next-app
```

## Detection Capabilities

| Detection | Sources | Confidence |
|-----------|---------|------------|
| **Framework** | `package.json` dependencies | High |
| **i18n Library** | `package.json` + file patterns | High |
| **Locales Dir** | Common paths scan | Medium |
| **Source Files** | File extension analysis | High |
| **Existing Keys** | Locale file parsing | High |

## Supported Frameworks

| Framework | Detected By | Default Adapter |
|-----------|-------------|-----------------|
| **Nuxt** | `nuxt` package | `vue-i18n` |
| **Next.js** | `next` package | `react-i18next` |
| **Vue** | `vue` package | `vue-i18n` |
| **React** | `react` package | `react-i18next` |
| **Svelte** | `svelte` package | `svelte-i18n` |
| **Angular** | `@angular/core` | `@ngx-translate/core` |

## Available Templates

| Template | Use Case |
|----------|----------|
| `react` | Standard React + react-i18next |
| `next-app` | Next.js 13+ App Router + next-intl |
| `next-pages` | Next.js Pages Router + react-i18next |
| `vue3` | Vue 3 + vue-i18n Composition API |
| `nuxt3` | Nuxt 3 + @nuxtjs/i18n |
| `svelte` | Svelte/SvelteKit + svelte-i18n |
| `minimal` | Generic JavaScript project |

## Confidence Levels

| Level | Score | Behavior |
|-------|-------|----------|
| **High** | ≥0.8 | Auto-apply with `--yes` |
| **Medium** | 0.5-0.8 | Show for confirmation |
| **Low** | <0.5 | Prompt for customization |

## Example Detection Output

```
🔍 Project Analysis

Framework:     Next.js 14 (App Router)
               ✓ next@14.0.0 detected
               ✓ app/layout.tsx found

i18n Library:  next-intl
               ✓ next-intl@3.0.0 in dependencies

Locales:       messages/
               ✓ en.json (127 keys)
               ✓ es.json (127 keys)
               ✓ fr.json (125 keys)

Source Files:  23 files
               ✓ app/**/*.tsx
               ✓ components/**/*.tsx

Confidence:    92% (High)

Suggested config will be written to: i18n.config.json
```

## CLI Commands

```bash
# Analyze project (no changes)
i18nsmith detect
i18nsmith detect --json

# Initialize configuration
i18nsmith init              # Interactive with smart defaults
i18nsmith init --yes        # Accept all detected values
i18nsmith init --minimal    # Only essential questions
i18nsmith init --template <name>  # Use preset template

# List templates
i18nsmith init --list-templates

# Force overwrite existing
i18nsmith init --force
```

## Related Documentation

- [Full Design Document](./auto-config-generation.md)
- [Implementation Spec](./specs/auto-config-spec.yaml)
- [Framework-Specific Guides](./recipes/)
