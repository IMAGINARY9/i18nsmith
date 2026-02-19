
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Syncer } from './syncer.js';
import { LocaleStore } from './locale-store.js';
import { I18nConfig } from './config.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('Vue Integration', () => {
  let tempDir: string;
  let srcDir: string;
  let localesDir: string;
  let cacheDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-vue-test-'));
    srcDir = path.join(tempDir, 'src');
    localesDir = path.join(tempDir, 'locales');
    cacheDir = path.join(tempDir, '.i18nsmith/cache');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(localesDir, { recursive: true });
    await fs.mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('correctly detects keys used in Vue templates and scripts', async () => {
    // 1. Create a Vue component with template and script usage
    const vueContent = `
<template>
  <div>
    <h1>{{ $t('header.title') }}</h1>
    <button @click="login">{{ $t('common.login') }}</button>
    <!-- Complex expression -->
    <p>{{ $t('errors.' + errorCode) }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const errorCode = '404';

function login() {
  console.log(t('auth.success'));
}
</script>
`;
    await fs.writeFile(path.join(srcDir, 'App.vue'), vueContent);

    // 2. Setup locales
    const en = {
      header: { title: "Welcome" },
      common: { login: "Log in" },
      auth: { success: "Logged in successfully" },
      unused: { k: "I am unused" }
    };
    await fs.writeFile(path.join(localesDir, 'en.json'), JSON.stringify(en, null, 2));

    // 3. Configure Syncer
    const config: I18nConfig = {
      localesDir: 'locales',
      sourceLanguage: 'en',
      targetLanguages: ['en'],
      include: ['src/**/*.vue'], // Explicitly include .vue
      // Using defaults for parser setup implicitly (Syncer sets up ReferenceExtractor)
    };
    
    const syncer = new Syncer(config, { workspaceRoot: tempDir });

    // 4. Run Syncer
    const summary = await syncer.run({
        invalidateCache: true, // ensure no stale cache
    });

    // 5. Verify results
    // keys detected: header.title, common.login, auth.success (and 'errors.' is dynamic)
    // keys unused: unused.k
    // keys missing: errors.404 (dynamic)
    
    // We expect 'header.title' and 'common.login' to be identified as USED.
    // If Vue parser works, they are used. If not, they are unused.
    
    const unusedKeys = summary.unusedKeys.map(u => u.key);
    console.log('Unused keys detected:', unusedKeys);

    expect(unusedKeys).toContain('unused.k');
    expect(unusedKeys).not.toContain('header.title');
    expect(unusedKeys).not.toContain('common.login');
    expect(unusedKeys).not.toContain('auth.success');
  });

  it('detects nested $t() used as interpolation params inside template calls', async () => {
    const vueContent = `
<template>
  <div>
    <!-- nested $t used as interpolation param -->
    <p>{{ $t('parent.key', { inner: $t('nested.key') }) }}</p>
  </div>
</template>

<script setup lang="ts">
// intentionally empty
</script>
`;

    await fs.writeFile(path.join(srcDir, 'Nested.vue'), vueContent);

    const en = {
      parent: { key: 'Parent: {inner}' },
      nested: { key: 'Inner' },
    };
    await fs.writeFile(path.join(localesDir, 'en.json'), JSON.stringify(en, null, 2));

    const config: I18nConfig = {
      localesDir: 'locales',
      sourceLanguage: 'en',
      targetLanguages: ['en'],
      include: ['src/**/*.vue'],
    };

    const syncer = new Syncer(config, { workspaceRoot: tempDir });
    const summary = await syncer.run({ invalidateCache: true });

    // Both keys should be detected as references (not unused)
    const unused = summary.unusedKeys.map(u => u.key);
    expect(unused).not.toContain('parent.key');
    expect(unused).not.toContain('nested.key');
  });

  it('I18nDemo.vue nested interpolation key is preserved end-to-end', async () => {
    const vueContent = `
<template>
  <div class="i18n-demo">
    <p v-if="name">{{ $t('common.components.i18ndemo.arg0-name.4ac48a', { arg0: $t('demo.card.greeting'), name: name }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
const name = ref('');
</script>
`;

    await fs.writeFile(path.join(srcDir, 'I18nDemo.vue'), vueContent);

    const en = {
      common: { components: { i18ndemo: { 'arg0-name': 'Hello {arg0}, {name}', 'placeholder': '' } } },
      demo: { card: { greeting: 'Good morning' } }
    };
    const es = {
      common: { components: { i18ndemo: { 'arg0-name': 'Hola {arg0}, {name}' } } },
      demo: { card: { greeting: 'Buenos días' } }
    };
    await fs.writeFile(path.join(localesDir, 'en.json'), JSON.stringify(en, null, 2));
    await fs.writeFile(path.join(localesDir, 'es.json'), JSON.stringify(es, null, 2));

    const config: I18nConfig = {
      localesDir: 'locales',
      sourceLanguage: 'en',
      targetLanguages: ['es'],
      include: ['src/**/*.vue'],
    };

    const syncer = new Syncer(config, { workspaceRoot: tempDir });
    const summary = await syncer.run({ invalidateCache: true });

    // The nested key 'demo.card.greeting' should be detected as a reference
    // and therefore must NOT appear in unusedKeys
    const unused = summary.unusedKeys.map(u => u.key);
    const referenced = summary.references.map(r => r.key);

    expect(referenced).toContain('demo.card.greeting');
    expect(unused).not.toContain('demo.card.greeting');
  });
});
