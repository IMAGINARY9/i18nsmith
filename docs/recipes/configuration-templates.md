# Configuration Templates

i18nsmith provides several pre-configured templates to help you get started quickly with different frameworks and project types. These templates include optimized include/exclude patterns, recommended i18n adapters, and sensible defaults for your specific use case.

## Available Templates

### React (`--template react`)

**Description**: Standard React application using react-i18next.

**Best for**: Traditional React apps with Create React App, Vite, or custom React setups.

**Configuration**:
```json
{
  "sourceLanguage": "en",
  "targetLanguages": [],
  "localesDir": "src/locales",
  "include": ["src/**/*.{ts,tsx,js,jsx}"],
  "exclude": ["**/*.test.*", "**/*.spec.*"],
  "translationAdapter": {
    "module": "react-i18next",
    "hookName": "useTranslation"
  }
}
```

### Next.js App Router (`--template next-app`)

**Description**: Next.js 13+ with App Router and next-intl.

**Best for**: Modern Next.js applications using the App Router architecture.

**Configuration**:
```json
{
  "sourceLanguage": "en",
  "targetLanguages": [],
  "localesDir": "messages",
  "include": ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  "exclude": [".next/**", "**/*.test.*"],
  "translationAdapter": {
    "module": "next-intl",
    "hookName": "useTranslations"
  }
}
```

### Next.js Pages Router (`--template next-pages`)

**Description**: Next.js with Pages Router and react-i18next.

**Best for**: Next.js applications using the traditional Pages Router.

**Configuration**:
```json
{
  "sourceLanguage": "en",
  "targetLanguages": [],
  "localesDir": "public/locales",
  "include": ["pages/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
  "exclude": [".next/**", "**/*.test.*"],
  "translationAdapter": {
    "module": "react-i18next",
    "hookName": "useTranslation"
  }
}
```

### Vue 3 (`--template vue3`)

**Description**: Vue 3 SFC application with Composition API and vue-i18n.

**Best for**: Vue 3 applications using Single File Components and the Composition API.

**Configuration**:
```json
{
  "sourceLanguage": "en",
  "targetLanguages": [],
  "localesDir": "src/locales",
  "include": ["src/**/*.vue", "src/**/*.{ts,js}"],
  "exclude": ["**/*.test.*", "**/*.spec.*"],
  "translationAdapter": {
    "module": "vue-i18n",
    "hookName": "useI18n"
  }
}
```

### Nuxt 3 (`--template nuxt3`)

**Description**: Nuxt 3 with @nuxtjs/i18n module.

**Best for**: Nuxt 3 applications with auto-imports and server-side rendering.

**Configuration**:
```json
{
  "sourceLanguage": "en",
  "targetLanguages": [],
  "localesDir": "locales",
  "include": ["**/*.vue", "composables/**/*.ts", "pages/**/*.ts", "components/**/*.ts"],
  "exclude": [".nuxt/**", ".output/**", "**/*.test.*"],
  "translationAdapter": {
    "module": "vue-i18n",
    "hookName": "useI18n"
  }
}
```

### Svelte/SvelteKit (`--template svelte`)

**Description**: Svelte/SvelteKit application with svelte-i18n.

**Best for**: Svelte and SvelteKit applications using stores for i18n.

**Configuration**:
```json
{
  "sourceLanguage": "en",
  "targetLanguages": [],
  "localesDir": "src/lib/locales",
  "include": ["src/**/*.svelte", "src/**/*.{ts,js}"],
  "exclude": [".svelte-kit/**", "**/*.test.*"],
  "translationAdapter": {
    "module": "svelte-i18n",
    "hookName": "t"
  }
}
```

### Minimal (`--template minimal`)

**Description**: Basic configuration for any JavaScript project.

**Best for**: Custom setups, non-framework projects, or when you want full control over configuration.

**Configuration**:
```json
{
  "sourceLanguage": "en",
  "targetLanguages": [],
  "localesDir": "locales",
  "include": ["**/*.{ts,tsx,js,jsx}"],
  "exclude": ["node_modules/**", "dist/**", "**/*.test.*"],
  "translationAdapter": {
    "module": "react-i18next",
    "hookName": "useTranslation"
  }
}
```

## Usage

Use templates with the `init` command:

```bash
# Initialize with a specific template
i18nsmith init --template next-app -y

# List available templates
i18nsmith init --help
```

Templates provide a starting point but can be customized after initialization by editing `i18n.config.json`.

## Choosing a Template

- **React projects**: Use `react` for standard React apps
- **Next.js App Router**: Use `next-app` for modern Next.js
- **Next.js Pages Router**: Use `next-pages` for legacy Next.js
- **Vue 3**: Use `vue3` for Vue applications
- **Nuxt 3**: Use `nuxt3` for Nuxt applications
- **Svelte/SvelteKit**: Use `svelte` for Svelte applications
- **Custom/Other**: Use `minimal` for full control

If you're unsure which template to use, run `i18nsmith init -y` without a template for automatic detection, or use `i18nsmith detect` to see what i18nsmith detects in your project.