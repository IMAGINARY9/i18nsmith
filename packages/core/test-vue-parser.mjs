import { VueParser } from './src/parsers/vue-parser.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const parser = new VueParser();
const workspaceRoot = __dirname;

console.log('VueParser available:', parser.isAvailable(workspaceRoot));

const vueContent = `
<template>
  <div>
    <h1>{{ $t('header.title') }}</h1>
    <button @click="login">{{ $t('common.login') }}</button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

function login() {
  console.log(t('auth.success'));
}
</script>
`;

const result = parser.parseFile('/test/App.vue', vueContent, 't', workspaceRoot);
console.log('References found:', result.references.length);
console.log('References:', JSON.stringify(result.references, null, 2));
console.log('Warnings:', result.dynamicKeyWarnings);
