# Recipe: Before / After Transform Examples

## Goal
Illustrate how `transform` rewrites code while preserving semantics and enabling translation.

## 1. JSX Text Node
Before:
```tsx
export function Hero() { return <h1>Welcome to our platform</h1>; }
```
After (dry-run preview):
```tsx
import { useTranslation } from 'react-i18next';
export function Hero() {
  const { t } = useTranslation();
  return <h1>{t('hero.welcome')}</h1>;
}
```

## 2. Attribute Replacement
Before:
```tsx
<input placeholder="Your name" />
```
After:
```tsx
<input placeholder={t('form.your_name')} />
```

## 3. Existing Hook Detection
Before (already using translation):
```tsx
const { t } = useTranslation();
<button>{t('cta.start')}</button>
```
After: (unchanged, key reused) – duplicates skipped.

## 4. Dynamic Key Warning
```tsx
{t(`errors.${code}`)}
```
Reported as dynamic; add `--assume-globs errors.*` to suppress unused warnings.

## 5. Conditional Text
Before:
```tsx
{isAdmin ? 'Admin Panel' : 'Dashboard'}
```
After:
```tsx
{isAdmin ? t('nav.admin_panel') : t('nav.dashboard')}
```

## 6. Vue SFC Template Interpolation
Before:
```vue
<template>
  <div>
    <h1>{{ title }}</h1>
    <p>{{ message }}</p>
  </div>
</template>

<script>
export default {
  data() {
    return {
      title: 'Welcome to Vue.js',
      message: 'This is a test component'
    }
  }
}
</script>
```
After:
```vue
<template>
  <div>
    <h1>{{ $t('welcome_to_vue_js') }}</h1>
    <p>{{ $t('this_is_a_test_component') }}</p>
  </div>
</template>

<script>
import { useI18n } from 'vue-i18n';

export default {
  setup() {
    const { t } = useI18n();
    return { t };
  },
  data() {
    return {
      title: this.t('welcome_to_vue_js'),
      message: this.t('this_is_a_test_component')
    }
  }
}
</script>
```

## 7. Vue SFC Attribute Binding
Before:
```vue
<template>
  <input v-model="name" placeholder="Enter your name" />
  <button @click="submit">{{ buttonText }}</button>
</template>

<script>
export default {
  data() {
    return {
      name: '',
      buttonText: 'Submit Form'
    }
  }
}
</script>
```
After:
```vue
<template>
  <input v-model="name" :placeholder="$t('enter_your_name')" />
  <button @click="submit">{{ $t('submit_form') }}</button>
</template>

<script>
import { useI18n } from 'vue-i18n';

export default {
  setup() {
    const { t } = useI18n();
    return { t };
  },
  data() {
    return {
      name: '',
      buttonText: this.t('submit_form')
    }
  }
}
</script>
```

## 8. Skipped Non-Translatable
- `className`, `data-testid`, raw numbers, and emoji-only strings ignored.

## Key Generation Modes
| Mode | Example | Use Case |
|------|---------|----------|
| minimal | `hero.welcome` | Readable defaults |
| hashed | `hero.welcome.abc123` | Collision auditing |
| namespaced | `home.hero.welcome` | Large monorepos |

## Review Diffs
Use dry-run with unified diffs:
```bash
npx i18nsmith transform --dry-run --diff --target src/components/Hero.tsx
```

## Next Steps
- Pair with `sync --write` to materialize locale entries.
- Run `check` to confirm no drift after transform.
