import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { I18nConfig } from './config/types.js';

/**
 * Vue Test Helper
 *
 * Utility class for setting up and tearing down Vue testing environments.
 * Provides common patterns for creating Vue components, projects, and test scenarios.
 */
export class VueTestHelper {
  private tempDir: string | undefined;
  private srcDir: string | undefined;
  private localesDir: string | undefined;

  /**
   * Initialize a temporary Vue project structure
   */
  async setupProject(projectName = 'vue-test-project'): Promise<{
    tempDir: string;
    srcDir: string;
    localesDir: string;
    config: I18nConfig;
  }> {
    this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `i18nsmith-${projectName}-`));
    this.srcDir = path.join(this.tempDir, 'src');
    this.localesDir = path.join(this.tempDir, 'locales');

    await fs.mkdir(this.srcDir, { recursive: true });
    await fs.mkdir(this.localesDir, { recursive: true });

    const config: I18nConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['de', 'fr'],
      localesDir: this.localesDir,
      include: ['src/**/*.{vue,ts,tsx,js,jsx}'],
    };

    return {
      tempDir: this.tempDir,
      srcDir: this.srcDir,
      localesDir: this.localesDir,
      config,
    };
  }

  /**
   * Clean up temporary directories
   */
  async teardown(): Promise<void> {
    if (this.tempDir) {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      this.tempDir = undefined;
      this.srcDir = undefined;
      this.localesDir = undefined;
    }
  }

  /**
   * Create a Vue component file
   */
  async createVueComponent(
    filename: string,
    content: string,
    subDir = ''
  ): Promise<string> {
    if (!this.srcDir) throw new Error('Project not initialized');
    const componentPath = path.join(this.srcDir, subDir, filename);
    await fs.mkdir(path.dirname(componentPath), { recursive: true });
    await fs.writeFile(componentPath, content, 'utf8');
    return componentPath;
  }

  /**
   * Create a locale file
   */
  async createLocaleFile(
    locale: string,
    translations: Record<string, any>
  ): Promise<string> {
    if (!this.localesDir) throw new Error('Project not initialized');
    const localePath = path.join(this.localesDir, `${locale}.json`);
    await fs.writeFile(localePath, JSON.stringify(translations, null, 2), 'utf8');
    return localePath;
  }

  /**
   * Create a TypeScript/JavaScript file
   */
  async createScriptFile(
    filename: string,
    content: string,
    subDir = ''
  ): Promise<string> {
    if (!this.srcDir) throw new Error('Project not initialized');
    const scriptPath = path.join(this.srcDir, subDir, filename);
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, content, 'utf8');
    return scriptPath;
  }

  /**
   * Get the absolute path for a file in the project
   */
  getAbsolutePath(relativePath: string): string {
    if (!this.tempDir) throw new Error('Project not initialized');
    return path.join(this.tempDir, relativePath);
  }
}

/**
 * Vue Component Templates
 *
 * Pre-built Vue component templates for common testing scenarios
 */
export const VueComponentTemplates = {
  /**
   * Basic Vue 2 Options API component
   */
  basicOptionsApi: (content: string = 'Hello World') => `
<template>
  <div>
    <h1>${content}</h1>
  </div>
</template>

<script>
export default {
  name: 'BasicComponent'
}
</script>

<style scoped>
h1 {
  color: blue;
}
</style>
`,

  /**
   * Vue 3 Composition API component
   */
  compositionApi: (content: string = 'Hello World') => `
<template>
  <div>
    <h1>${content}</h1>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const message = ref('${content}')
</script>

<style scoped>
h1 {
  color: green;
}
</style>
`,

  /**
   * Vue 3 Script Setup component with i18n
   */
  scriptSetupWithI18n: (keys: string[] = ['title']) => `
<template>
  <div>
    <h1>{{ $t('${keys[0]}') }}</h1>
    ${keys.slice(1).map(key => `<p>{{ $t('${key}') }}</p>`).join('\n    ')}
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

// Script usage
const greeting = t('greeting')
</script>
`,

  /**
   * Nuxt 3 component with auto-imports
   */
  nuxt3AutoImports: (keys: string[] = ['title']) => `
<template>
  <div>
    <h1>{{ $t('${keys[0]}') }}</h1>
    ${keys.slice(1).map(key => `<p>{{ $t('${key}') }}</p>`).join('\n    ')}
  </div>
</template>

<script setup lang="ts">
// No imports needed - auto-imported by Nuxt
const route = useRoute()
const greeting = $t('greeting')
</script>
`,

  /**
   * Component with dynamic keys
   */
  dynamicKeys: () => `
<template>
  <div>
    <p>{{ $t(\`errors.\${errorCode}\`) }}</p>
    <p>{{ $t('messages.' + type) }}</p>
    <p>{{ $t(errorKey) }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const errorCode = ref('404')
const type = ref('success')
const errorKey = ref('errors.unknown')
</script>
`,

  /**
   * Component with various attributes
   */
  attributes: () => `
<template>
  <div>
    <input
      :placeholder="$t('form.placeholder')"
      :title="$t('form.tooltip')"
      :aria-label="$t('form.label')"
    />
    <button :title="$t('actions.save')">
      {{ $t('actions.save') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>
`,

  /**
   * Component with slots
   */
  slots: () => `
<template>
  <div>
    <header>
      <slot name="title">{{ $t('default.title') }}</slot>
    </header>
    <main>
      <slot>{{ $t('default.content') }}</slot>
    </main>
  </div>
</template>
`,

  /**
   * Component with directives
   */
  directives: () => `
<template>
  <div>
    <p v-html="translatedHtml"></p>
    <input v-model="message" :placeholder="$t('form.message')" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const message = ref('')

const translatedHtml = computed(() => \`<strong>\${t('bold.text')}</strong>\`)
</script>
`
};

/**
 * Test Scenario Builders
 *
 * Functions to create complete test scenarios
 */
export const TestScenarioBuilders = {
  /**
   * Create a basic Vue application with multiple components
   */
  async createBasicVueApp(helper: VueTestHelper): Promise<{
    components: string[];
    locales: Record<string, any>;
  }> {
    const components = [];

    // App.vue
    components.push(await helper.createVueComponent('App.vue', `
<template>
  <div id="app">
    <Header />
    <main>
      <HelloWorld />
    </main>
    <Footer />
  </div>
</template>

<script setup lang="ts">
import Header from './components/Header.vue'
import HelloWorld from './components/HelloWorld.vue'
import Footer from './components/Footer.vue'
</script>
`));

    // Header.vue
    components.push(await helper.createVueComponent('components/Header.vue',
      VueComponentTemplates.scriptSetupWithI18n(['nav.home', 'nav.about'])
    ));

    // HelloWorld.vue
    components.push(await helper.createVueComponent('components/HelloWorld.vue',
      VueComponentTemplates.compositionApi('{{ $t(\'hello.world\') }}')
    ));

    // Footer.vue
    components.push(await helper.createVueComponent('components/Footer.vue',
      VueComponentTemplates.scriptSetupWithI18n(['footer.copyright'])
    ));

    // Locale files
    const locales = {
      en: {
        'nav.home': 'Home',
        'nav.about': 'About',
        'hello.world': 'Hello World',
        'footer.copyright': '© 2024'
      },
      de: {
        'nav.home': 'Startseite',
        'nav.about': 'Über',
        'hello.world': 'Hallo Welt',
        'footer.copyright': '© 2024'
      }
    };

    await helper.createLocaleFile('en', locales.en);
    await helper.createLocaleFile('de', locales.de);

    return { components, locales };
  },

  /**
   * Create a complex Vue application with dynamic features
   */
  async createComplexVueApp(helper: VueTestHelper): Promise<{
    components: string[];
    locales: Record<string, any>;
  }> {
    const components = [];

    // Main App
    components.push(await helper.createVueComponent('App.vue', `
<template>
  <div>
    <UserProfile :user="currentUser" />
    <ErrorDisplay :error="currentError" />
    <DynamicContent :type="contentType" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import UserProfile from './components/UserProfile.vue'
import ErrorDisplay from './components/ErrorDisplay.vue'
import DynamicContent from './components/DynamicContent.vue'

const currentUser = ref({ name: 'John', role: 'admin' })
const currentError = ref(null)
const contentType = ref('dashboard')
</script>
`));

    // UserProfile.vue with dynamic keys
    components.push(await helper.createVueComponent('components/UserProfile.vue', `
<template>
  <div class="profile">
    <h2>{{ $t('user.profile.title') }}</h2>
    <p>{{ $t(\`user.roles.\${user.role}\`) }}</p>
    <p>{{ $t('user.welcome', { name: user.name }) }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  user: { name: string; role: string }
}>()
</script>
`));

    // ErrorDisplay.vue with conditional rendering
    components.push(await helper.createVueComponent('components/ErrorDisplay.vue', `
<template>
  <div v-if="error" class="error">
    <p>{{ $t(\`errors.\${error.code}\`) }}</p>
    <button @click="dismiss">{{ $t('actions.dismiss') }}</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  error: { code: string } | null
}>()

const emit = defineEmits<{
  dismiss: []
}>()

function dismiss() {
  emit('dismiss')
}
</script>
`));

    // DynamicContent.vue with slots
    components.push(await helper.createVueComponent('components/DynamicContent.vue', `
<template>
  <div class="content">
    <slot name="header">
      <h3>{{ $t(\`content.\${type}.title\`) }}</h3>
    </slot>
    <slot>
      <p>{{ $t(\`content.\${type}.description\`) }}</p>
    </slot>
  </div>
</div>
</template>

<script setup lang="ts">
defineProps<{
  type: string
}>()
</script>
`));

    // Locale files with nested structure
    const locales = {
      en: {
        user: {
          profile: { title: 'User Profile' },
          roles: { admin: 'Administrator', user: 'User' },
          welcome: 'Welcome, {name}!'
        },
        errors: {
          '404': 'Page not found',
          '500': 'Server error'
        },
        actions: { dismiss: 'Dismiss' },
        content: {
          dashboard: {
            title: 'Dashboard',
            description: 'Welcome to your dashboard'
          },
          settings: {
            title: 'Settings',
            description: 'Manage your preferences'
          }
        }
      }
    };

    await helper.createLocaleFile('en', locales.en);

    return { components, locales };
  }
};