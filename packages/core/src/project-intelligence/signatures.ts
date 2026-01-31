/**
 * Framework Signatures for Detection
 * 
 * This file contains the detection rules for each supported framework.
 * Used by the FrameworkDetector to identify the project type.
 * 
 * @module @i18nsmith/core/project-intelligence
 */

import type { FrameworkSignature, FrameworkType } from './types.js';

/**
 * Framework signatures ordered by detection priority.
 * Lower priority number = checked first (important for frameworks that include others).
 * 
 * Example: Nuxt includes Vue, so we check for Nuxt before Vue.
 */
export const FRAMEWORK_SIGNATURES: FrameworkSignature[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Nuxt (check before Vue - Nuxt includes Vue)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'nuxt',
    priority: 1,
    packages: ['nuxt', '@nuxt/core', '@nuxt/kit'],
    i18nPackages: ['@nuxtjs/i18n', 'vue-i18n'],
    defaultAdapter: 'vue-i18n',
    defaultHook: 'useI18n',
    includePatterns: [
      '**/*.vue',
      'pages/**/*.{ts,js}',
      'components/**/*.{ts,js}',
      'composables/**/*.{ts,js}',
      'layouts/**/*.{ts,js,vue}',
    ],
    excludePatterns: [
      '.nuxt/**',
      '.output/**',
      'node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    localesCandidates: [
      'locales',
      'i18n/locales',
      'lang',
      'i18n',
    ],
    featureIndicators: {
      'auto-imports': ['nuxt.config.ts', 'nuxt.config.js'],
      'pages': ['pages/'],
      'composables': ['composables/'],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Next.js (check before React - Next includes React)
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'next',
    priority: 2,
    packages: ['next'],
    i18nPackages: ['next-intl', 'next-i18next', 'react-i18next'],
    defaultAdapter: 'react-i18next',
    defaultHook: 'useTranslation',
    includePatterns: [
      'app/**/*.{ts,tsx}',
      'pages/**/*.{ts,tsx}',
      'components/**/*.{ts,tsx}',
      'src/**/*.{ts,tsx}',
    ],
    excludePatterns: [
      '.next/**',
      'out/**',
      'node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    localesCandidates: [
      'messages',           // next-intl convention
      'public/locales',     // react-i18next/next-i18next convention
      'locales',
      'i18n',
    ],
    featureIndicators: {
      'app-router': ['app/layout.tsx', 'app/layout.ts', 'app/layout.js'],
      'pages-router': ['pages/_app.tsx', 'pages/_app.ts', 'pages/_app.js', 'pages/index.tsx'],
      'src-directory': ['src/app/', 'src/pages/'],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Vue
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'vue',
    priority: 3,
    packages: ['vue'],
    optionalPackages: ['@vue/cli-service', 'vite'],
    i18nPackages: ['vue-i18n', '@intlify/vue-i18n', '@intlify/unplugin-vue-i18n'],
    defaultAdapter: 'vue-i18n',
    defaultHook: 'useI18n',
    includePatterns: [
      'src/**/*.vue',
      'src/**/*.{ts,js}',
    ],
    excludePatterns: [
      'dist/**',
      'node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    localesCandidates: [
      'src/locales',
      'src/i18n',
      'locales',
      'i18n',
    ],
    featureIndicators: {
      'composition-api': ['src/composables/'],
      'options-api': [],
      'sfc': ['**/*.vue'],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // React
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'react',
    priority: 4,
    packages: ['react'],
    optionalPackages: ['react-dom', 'react-scripts', 'vite'],
    i18nPackages: [
      'react-i18next',
      '@lingui/react',
      'react-intl',
      'formatjs',
      '@formatjs/intl',
    ],
    defaultAdapter: 'react-i18next',
    defaultHook: 'useTranslation',
    includePatterns: [
      'src/**/*.{ts,tsx,js,jsx}',
    ],
    excludePatterns: [
      'build/**',
      'dist/**',
      'node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    localesCandidates: [
      'src/locales',
      'public/locales',
      'locales',
      'i18n',
    ],
    featureIndicators: {
      'hooks': [], // React hooks are standard now
      'cra': ['react-scripts'],
      'vite': ['vite.config.ts', 'vite.config.js'],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Svelte / SvelteKit
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'svelte',
    priority: 5,
    packages: ['svelte', '@sveltejs/kit'],
    i18nPackages: ['svelte-i18n', 'sveltekit-i18n', '@inlang/paraglide-js'],
    defaultAdapter: 'svelte-i18n',
    defaultHook: 't',
    includePatterns: [
      'src/**/*.svelte',
      'src/**/*.{ts,js}',
    ],
    excludePatterns: [
      '.svelte-kit/**',
      'build/**',
      'node_modules/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    localesCandidates: [
      'src/lib/locales',
      'src/locales',
      'locales',
      'messages',
    ],
    featureIndicators: {
      'sveltekit': ['svelte.config.js', 'svelte.config.ts'],
      'stores': ['src/lib/stores/'],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Angular
  // ─────────────────────────────────────────────────────────────────────────
  {
    type: 'angular',
    priority: 6,
    packages: ['@angular/core'],
    optionalPackages: ['@angular/cli', '@angular/common'],
    i18nPackages: ['@ngx-translate/core', '@angular/localize'],
    defaultAdapter: '@ngx-translate/core',
    defaultHook: 'translate',
    includePatterns: [
      'src/**/*.ts',
      'src/**/*.html',
    ],
    excludePatterns: [
      'dist/**',
      'node_modules/**',
      '**/*.spec.ts',
    ],
    localesCandidates: [
      'src/assets/i18n',
      'src/i18n',
      'i18n',
    ],
    featureIndicators: {
      'standalone': ['src/app/app.config.ts'],
      'modules': ['src/app/app.module.ts'],
    },
  },
];

/**
 * Get framework signature by type.
 */
export function getFrameworkSignature(type: FrameworkType): FrameworkSignature | undefined {
  return FRAMEWORK_SIGNATURES.find((sig) => sig.type === type);
}

/**
 * Get signatures ordered by detection priority.
 */
export function getSignaturesByPriority(): FrameworkSignature[] {
  return [...FRAMEWORK_SIGNATURES].sort((a, b) => a.priority - b.priority);
}

/**
 * Known i18n adapter modules and their recommended hook names.
 */
export const I18N_ADAPTER_HOOKS: Record<string, string> = {
  // React ecosystem
  'react-i18next': 'useTranslation',
  'i18next': 't',
  'next-intl': 'useTranslations',
  'next-i18next': 'useTranslation',
  '@lingui/react': 'useLingui',
  'react-intl': 'useIntl',
  '@formatjs/intl': 'useIntl',
  
  // Vue ecosystem
  'vue-i18n': 'useI18n',
  '@intlify/vue-i18n': 'useI18n',
  '@nuxtjs/i18n': 'useI18n',
  
  // Svelte ecosystem
  'svelte-i18n': 't',
  'sveltekit-i18n': 't',
  '@inlang/paraglide-js': 'm',
  
  // Angular ecosystem
  '@ngx-translate/core': 'translate',
  '@angular/localize': '$localize',
};

/**
 * Get recommended hook name for an adapter module.
 */
export function getAdapterHook(adapterModule: string): string {
  return I18N_ADAPTER_HOOKS[adapterModule] ?? 'useTranslation';
}

/**
 * Common exclude patterns that apply to all frameworks.
 */
export const UNIVERSAL_EXCLUDE_PATTERNS = [
  'node_modules/**',
  '**/node_modules/**',
  '**/*.d.ts',
];

/**
 * Build output directories to exclude.
 */
export const BUILD_OUTPUT_PATTERNS = [
  'dist/**',
  'build/**',
  'out/**',
  'coverage/**',
  '.cache/**',
];

/**
 * Test file patterns to exclude.
 */
export const TEST_FILE_PATTERNS = [
  '**/*.test.*',
  '**/*.spec.*',
  '__tests__/**',
  '__mocks__/**',
  '**/__tests__/**',
  '**/__mocks__/**',
  'cypress/**',
  'e2e/**',
];

/**
 * Config file patterns to exclude.
 */
export const CONFIG_FILE_PATTERNS = [
  '*.config.*',
  '**/*.config.*',
  'vite.config.*',
  'next.config.*',
  'nuxt.config.*',
  'svelte.config.*',
  'tailwind.config.*',
  'postcss.config.*',
  'jest.config.*',
  'vitest.config.*',
];

/**
 * Storybook patterns to exclude.
 */
export const STORYBOOK_PATTERNS = [
  '.storybook/**',
  '**/*.stories.*',
  '**/*.story.*',
];
