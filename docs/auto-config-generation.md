# Auto Config Generation Design

## Overview

This document describes the design for intelligent automatic configuration generation in i18nsmith. The goal is to minimize user friction when setting up a new project by scanning the workspace and inferring optimal configuration settings.

## Current State Analysis

### Existing Capabilities

1. **Basic Locale Detection** (`@i18nsmith/core/config/inference.ts`)
   - Detects `localesDir` from common paths
   - Discovers existing locales from file names
   - Infers `sourceLanguage` and `targetLanguages` from discovered locales

2. **Framework Detection** (VS Code Extension only - `framework-detection-service.ts`)
   - Detects React, Vue, Next.js, Nuxt, Svelte
   - Identifies i18n adapters (react-i18next, vue-i18n, next-intl, etc.)
   - Not available in CLI

3. **Diagnostics** (`@i18nsmith/core/diagnostics.ts`)
   - Detects runtime packages from `package.json`
   - Finds provider files
   - Detects existing adapter files
   - Scans for translation usage patterns

4. **Interactive Init** (`packages/cli/src/commands/init.ts`)
   - Many prompts (13+ questions)
   - No smart defaults based on project analysis
   - Non-interactive mode (`-y`) uses generic defaults

### Current Pain Points

1. **Too Many Prompts**: Interactive init asks many questions that could be auto-detected
2. **No Framework-Aware Defaults**: Doesn't adapt patterns for Vue vs React vs Next.js
3. **Duplicate Logic**: Framework detection exists in VS Code extension but not CLI
4. **Failed Scan Experience**: When scan fails without config, user gets error without helpful suggestions
5. **No File Pattern Intelligence**: Doesn't analyze actual project structure for include/exclude

---

## Proposed Solution

### Phase 1: Project Intelligence Service

Create a unified `ProjectIntelligenceService` in `@i18nsmith/core` that performs comprehensive project analysis.

```typescript
// packages/core/src/project-intelligence/index.ts

export interface ProjectIntelligence {
  // Framework detection
  framework: FrameworkDetection;
  
  // File patterns
  filePatterns: FilePatternDetection;
  
  // Existing i18n setup
  existingSetup: ExistingSetupDetection;
  
  // Locale detection
  locales: LocaleDetection;
  
  // Confidence scores for each detection
  confidence: ConfidenceScores;
}

export interface FrameworkDetection {
  type: 'react' | 'vue' | 'next' | 'nuxt' | 'svelte' | 'angular' | 'unknown';
  version?: string;
  adapter: string;           // Recommended adapter module
  hookName: string;          // e.g., 'useTranslation', 'useI18n'
  features: string[];        // e.g., ['hooks', 'composables', 'app-router']
}

export interface FilePatternDetection {
  include: string[];         // Detected source file patterns
  exclude: string[];         // Detected patterns to exclude
  sourceDirectories: string[]; // Main source directories found
  hasTypeScript: boolean;
  hasJsx: boolean;
  hasVue: boolean;
}

export interface ExistingSetupDetection {
  hasExistingConfig: boolean;
  configPath?: string;
  hasExistingLocales: boolean;
  localesDir?: string;
  hasI18nProvider: boolean;
  providerPath?: string;
  runtimePackages: RuntimePackageInfo[];
}

export interface LocaleDetection {
  sourceLanguage: string;
  targetLanguages: string[];
  localesDir: string;
  format: 'flat' | 'nested' | 'auto';
  existingKeys: number;      // Count of existing translation keys
}

export interface ConfidenceScores {
  framework: number;         // 0-1
  filePatterns: number;
  existingSetup: number;
  locales: number;
  overall: number;
}
```

### Phase 2: Detection Strategies

#### 2.1 Framework Detection Strategy

```typescript
// Detection priority order
const FRAMEWORK_DETECTION_ORDER = [
  'nuxt',      // Check before vue (nuxt includes vue)
  'next',      // Check before react (next includes react)
  'vue',
  'react',
  'svelte',
  'angular',
];

// Framework signatures in package.json
const FRAMEWORK_SIGNATURES = {
  nuxt: {
    packages: ['nuxt', '@nuxt/core'],
    i18nPackages: ['@nuxtjs/i18n', 'vue-i18n'],
    defaultAdapter: 'vue-i18n',
    defaultHook: 'useI18n',
    includePatterns: ['**/*.vue', 'pages/**/*.{ts,js}', 'components/**/*.{ts,js}'],
  },
  next: {
    packages: ['next'],
    i18nPackages: ['next-intl', 'next-i18next', 'react-i18next'],
    defaultAdapter: 'react-i18next',
    defaultHook: 'useTranslation',
    includePatterns: ['app/**/*.{ts,tsx,js,jsx}', 'pages/**/*.{ts,tsx,js,jsx}', 'components/**/*.{ts,tsx,js,jsx}'],
  },
  vue: {
    packages: ['vue'],
    i18nPackages: ['vue-i18n', '@intlify/vue-i18n'],
    defaultAdapter: 'vue-i18n',
    defaultHook: 'useI18n',
    includePatterns: ['src/**/*.vue', 'src/**/*.{ts,js}'],
  },
  react: {
    packages: ['react'],
    i18nPackages: ['react-i18next', '@lingui/react', 'react-intl'],
    defaultAdapter: 'react-i18next',
    defaultHook: 'useTranslation',
    includePatterns: ['src/**/*.{ts,tsx,js,jsx}'],
  },
  svelte: {
    packages: ['svelte'],
    i18nPackages: ['svelte-i18n'],
    defaultAdapter: 'svelte-i18n',
    defaultHook: 't',
    includePatterns: ['src/**/*.svelte', 'src/**/*.{ts,js}'],
  },
  angular: {
    packages: ['@angular/core'],
    i18nPackages: ['@ngx-translate/core', '@angular/localize'],
    defaultAdapter: '@ngx-translate/core',
    defaultHook: 'translate',
    includePatterns: ['src/**/*.ts', 'src/**/*.html'],
  },
};
```

#### 2.2 File Pattern Detection Strategy

```typescript
interface FilePatternStrategy {
  // Scan for actual directories that exist
  detectSourceDirectories(workspaceRoot: string): Promise<string[]>;
  
  // Sample files to determine extensions in use
  detectFileExtensions(workspaceRoot: string): Promise<Set<string>>;
  
  // Build optimal include patterns
  buildIncludePatterns(
    framework: FrameworkDetection,
    directories: string[],
    extensions: Set<string>
  ): string[];
  
  // Build exclude patterns based on common conventions
  buildExcludePatterns(workspaceRoot: string): Promise<string[]>;
}

// Common exclude patterns by context
const COMMON_EXCLUDE_PATTERNS = {
  always: [
    'node_modules/**',
    '**/node_modules/**',
  ],
  next: [
    '.next/**',
    'out/**',
  ],
  nuxt: [
    '.nuxt/**',
    '.output/**',
  ],
  build: [
    'dist/**',
    'build/**',
    'coverage/**',
  ],
  test: [
    '**/*.test.*',
    '**/*.spec.*',
    '__tests__/**',
    '__mocks__/**',
  ],
  config: [
    '*.config.*',
    'vite.config.*',
    'next.config.*',
    'nuxt.config.*',
  ],
};
```

#### 2.3 Locale Detection Strategy

```typescript
// Extended locale directory candidates
const LOCALE_DIR_CANDIDATES = [
  // Standard
  'locales',
  'locale',
  'i18n',
  'translations',
  'lang',
  'languages',
  
  // Nested in src
  'src/locales',
  'src/locale',
  'src/i18n',
  'src/translations',
  
  // Framework-specific
  'public/locales',      // react-i18next common
  'app/locales',         // Next.js app router
  'messages',            // next-intl
  'i18n/locales',
  
  // Monorepo patterns
  'packages/*/locales',
  'apps/*/locales',
];

// Locale file patterns
const LOCALE_FILE_PATTERNS = {
  json: /^([a-z]{2,3}(?:[-_][A-Z]{2})?(?:[-_][a-zA-Z]+)?)\.json$/i,
  yaml: /^([a-z]{2,3}(?:[-_][A-Z]{2})?(?:[-_][a-zA-Z]+)?)\.ya?ml$/i,
  directory: /^[a-z]{2,3}(?:[-_][A-Z]{2})?(?:[-_][a-zA-Z]+)?$/i,
};
```

### Phase 3: Smart Init Flow

#### 3.1 New `i18nsmith init` Behavior

```
┌─────────────────────────────────────────────────────────────────┐
│                     i18nsmith init                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Scan project structure                                      │
│     ├─ Detect framework (package.json, file extensions)         │
│     ├─ Detect existing i18n setup                               │
│     ├─ Detect existing locales                                  │
│     └─ Analyze source file patterns                             │
│                                                                 │
│  2. Generate smart defaults                                     │
│     ├─ Framework-aware adapter selection                        │
│     ├─ Optimal include/exclude patterns                         │
│     └─ Locale settings from existing files                      │
│                                                                 │
│  3. Present detection summary                                   │
│     ┌───────────────────────────────────────────────────────┐   │
│     │ 🔍 Detected Project Configuration                     │   │
│     │                                                       │   │
│     │ Framework:    Next.js 14 with App Router             │   │
│     │ Adapter:      react-i18next (installed)               │   │
│     │ Languages:    en (source), [es, fr, de] (targets)     │   │
│     │ Locales Dir:  public/locales                          │   │
│     │ Source Files: 47 files in app/, components/           │   │
│     │ Confidence:   92%                                     │   │
│     └───────────────────────────────────────────────────────┘   │
│                                                                 │
│  4. Confirm or customize                                        │
│     ├─ [Y] Accept detected configuration                        │
│     ├─ [C] Customize individual settings                        │
│     └─ [E] Edit config file manually                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 3.2 CLI Interface Updates

```typescript
// packages/cli/src/commands/init.ts

interface SmartInitOptions {
  // Existing
  merge?: boolean;
  yes?: boolean;
  
  // New options
  detect?: boolean;        // Run detection only, don't create config
  minimal?: boolean;       // Skip optional prompts, use detected values
  template?: string;       // Use a preset template (react, vue, next, etc.)
  force?: boolean;         // Overwrite existing config
}

// New command: i18nsmith detect
// Shows what would be detected without creating config
program
  .command('detect')
  .description('Analyze project and show detected configuration')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const intelligence = await analyzeProject(process.cwd());
    if (options.json) {
      console.log(JSON.stringify(intelligence, null, 2));
    } else {
      printDetectionSummary(intelligence);
    }
  });
```

### Phase 4: Configuration Templates

Provide framework-specific templates that users can start from:

```yaml
# config-templates.yaml

templates:
  react:
    name: "React with react-i18next"
    description: "Standard React app using react-i18next"
    config:
      sourceLanguage: "en"
      targetLanguages: []
      localesDir: "src/locales"
      include:
        - "src/**/*.{ts,tsx,js,jsx}"
      exclude:
        - "**/*.test.*"
        - "**/*.spec.*"
      translationAdapter:
        module: "react-i18next"
        hookName: "useTranslation"
      keyGeneration:
        namespace: "translation"
        shortHashLen: 6

  next-app:
    name: "Next.js App Router"
    description: "Next.js 13+ with App Router"
    config:
      sourceLanguage: "en"
      targetLanguages: []
      localesDir: "messages"
      include:
        - "app/**/*.{ts,tsx}"
        - "components/**/*.{ts,tsx}"
      exclude:
        - ".next/**"
        - "**/*.test.*"
      translationAdapter:
        module: "next-intl"
        hookName: "useTranslations"

  next-pages:
    name: "Next.js Pages Router"
    description: "Next.js with Pages Router and react-i18next"
    config:
      sourceLanguage: "en"
      targetLanguages: []
      localesDir: "public/locales"
      include:
        - "pages/**/*.{ts,tsx}"
        - "components/**/*.{ts,tsx}"
        - "src/**/*.{ts,tsx}"
      exclude:
        - ".next/**"
        - "**/*.test.*"
      translationAdapter:
        module: "react-i18next"
        hookName: "useTranslation"

  vue:
    name: "Vue 3 with vue-i18n"
    description: "Vue 3 SFC application"
    config:
      sourceLanguage: "en"
      targetLanguages: []
      localesDir: "src/locales"
      include:
        - "src/**/*.vue"
        - "src/**/*.{ts,js}"
      exclude:
        - "**/*.test.*"
        - "**/*.spec.*"
      translationAdapter:
        module: "vue-i18n"
        hookName: "useI18n"

  nuxt:
    name: "Nuxt 3"
    description: "Nuxt 3 with @nuxtjs/i18n"
    config:
      sourceLanguage: "en"
      targetLanguages: []
      localesDir: "locales"
      include:
        - "**/*.vue"
        - "composables/**/*.ts"
        - "pages/**/*.ts"
      exclude:
        - ".nuxt/**"
        - ".output/**"
        - "**/*.test.*"
      translationAdapter:
        module: "vue-i18n"
        hookName: "useI18n"

  svelte:
    name: "Svelte with svelte-i18n"
    description: "Svelte/SvelteKit application"
    config:
      sourceLanguage: "en"
      targetLanguages: []
      localesDir: "src/lib/locales"
      include:
        - "src/**/*.svelte"
        - "src/**/*.{ts,js}"
      exclude:
        - ".svelte-kit/**"
        - "**/*.test.*"
      translationAdapter:
        module: "svelte-i18n"
        hookName: "t"
```

### Phase 5: Improved Error Experience

When a user runs `i18nsmith scan` or other commands without a config file:

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠️  Configuration file not found                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ No i18n.config.json found in current directory or parents.      │
│                                                                 │
│ 🔍 Quick project analysis:                                      │
│    • Framework: Next.js detected                                │
│    • i18n Library: react-i18next found in dependencies          │
│    • Locale files: Found 3 files in public/locales/             │
│                                                                 │
│ 💡 Suggested actions:                                           │
│                                                                 │
│    1. Auto-generate config (recommended):                       │
│       $ i18nsmith init --yes                                    │
│                                                                 │
│    2. Interactive setup:                                        │
│       $ i18nsmith init                                          │
│                                                                 │
│    3. Use a template:                                           │
│       $ i18nsmith init --template next-pages                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Milestone 1: Core Intelligence Service (Priority: High)

1. Create `packages/core/src/project-intelligence/` module
2. Move framework detection from VS Code extension to core
3. Implement file pattern detection
4. Implement enhanced locale detection
5. Add confidence scoring

### Milestone 2: CLI Integration (Priority: High)

1. Add `i18nsmith detect` command
2. Refactor `init` command to use ProjectIntelligenceService
3. Implement smart defaults flow
4. Add `--template` option support
5. Improve no-config error messages

### Milestone 3: Templates & Presets (Priority: Medium)

1. Define configuration templates
2. Implement template loading
3. Add template selection UI
4. Create documentation for each template

### Milestone 4: VS Code Integration (Priority: Medium)

1. Use shared ProjectIntelligenceService in extension
2. Add "Quick Setup" command
3. Show detected config in status bar
4. Offer one-click config generation

---

## API Reference

### ProjectIntelligenceService

```typescript
import { ProjectIntelligenceService } from '@i18nsmith/core';

const service = new ProjectIntelligenceService();
const result = await service.analyze('/path/to/project');

// Access detection results
console.log(result.framework.type);        // 'next'
console.log(result.framework.adapter);      // 'react-i18next'
console.log(result.filePatterns.include);   // ['app/**/*.tsx', ...]
console.log(result.confidence.overall);     // 0.92

// Generate config from detection
const config = service.generateConfig(result);

// Apply a template
const templateConfig = service.applyTemplate('next-app', result);
```

### CLI Commands

```bash
# Detect project configuration
i18nsmith detect
i18nsmith detect --json

# Initialize with smart detection
i18nsmith init              # Interactive with smart defaults
i18nsmith init --yes        # Accept all detected values
i18nsmith init --minimal    # Only ask essential questions

# Initialize with template
i18nsmith init --template react
i18nsmith init --template next-app
i18nsmith init --template vue

# List available templates
i18nsmith init --list-templates
```

---

## Configuration Schema Additions

```typescript
interface I18nConfig {
  // ... existing fields ...
  
  /**
   * Metadata about how this config was generated.
   * Used for diagnostics and upgrade suggestions.
   */
  _meta?: {
    /** Template used to generate this config */
    template?: string;
    /** Version of i18nsmith that generated the config */
    generatedBy?: string;
    /** Timestamp of generation */
    generatedAt?: string;
    /** Detection confidence when auto-generated */
    confidence?: number;
  };
}
```

---

## Success Metrics

1. **Reduced Time to First Scan**: Target < 30 seconds from install to first successful scan
2. **Reduced Init Questions**: From 13+ prompts to 1-3 (confirm/customize)
3. **Detection Accuracy**: Target > 85% correct framework detection
4. **User Satisfaction**: Reduce config-related issues by 50%

---

## Related Documentation

- [Configuration Reference](./schema.md)
- [CLI Commands](../README.md)
- [Framework-Specific Guides](./recipes/)
- [Troubleshooting](./troubleshooting.md)
