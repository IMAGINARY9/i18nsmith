# Vue.js Support Implementation Plan

## 1. Objective
Enable `i18nsmith` to support Vue.js applications using `vue-i18n`. This includes:
- Scanning `.vue` Single File Components (SFCs) for hardcoded strings in `<template>` and `<script>`.
- Generating keys and managing locale files (existing functionality).
- Transforming `.vue` files to use `vue-i18n` (`$t` in template, `useI18n` in script).

## 2. Architecture Analysis & Gap Assessment

### Current Architecture
- **Scanner (`packages/core`)**: Tightly coupled to `ts-morph`. Expects `SourceFile` (TypeScript/JSX AST). Fails on `.vue` files or treats them as unknown.
- **Transformer (`packages/transformer`)**: logic is embedded in `Transformer.ts` and `react-adapter.ts`. It assumes it can use `ts-morph` methods (`insertImportDeclaration`, `insertStatements`) on the file object.

### The Standard Gap
- `ts-morph` does not natively parse Vue templates.
- Vue SFCs contain multiple languages (HTML/Pug in template, JS/TS in script).
- A new parsing strategy is required for `.vue` files.

## 3. Technology Stack Proposal
- **Parsing/Scanning**: 
  - Use `vue-eslint-parser` (robust, AST-based, ESTree compatible) OR `@vue/compiler-sfc` (official). 
  - *Recommendation*: **`vue-eslint-parser`** is often easier for static analysis tools as it provides a unified AST for template and script.
- **Transforming (Writing)**:
  - **Script**: Extract script content -> Virtual `ts-morph` source file -> Apply changes -> Inject back.
  - **Template**: Use `magic-string` based on AST location ranges from the parser. `ts-morph` cannot write to templates.

## 4. Implementation Plan

### Phase 1: Core Refactoring (Scanner Extensibility)
The `Scanner` class must allow pluggable parsers.

- [ ] **Refactor `Scanner`**: Decouple `ts-morph` logic into a `TypescriptParser` strategy.
- [ ] **Create `ParserInterface`**:
  ```typescript
  interface FileParser {
    canHandle(filePath: string): boolean;
    parse(filePath: string, content: string): ScanCandidate[];
  }
  ```
- [ ] **Implement `VueParser`**:
  - Install `vue-eslint-parser`.
  - Parse `<template>`: Identify `VText`, `VAttribute` (e.g. `label="foo"`), and `VExpressionContainer` (e.g. `{{ "foo" }}`).
  - Parse `<script>`: Delegate to `TypescriptParser` or handle internally.

### Phase 2: Transformer Architecture (Writer Abstraction)
We need to support different transformation strategies.

- [ ] **Define `Writer` Interface**:
  ```typescript
  interface I18nWriter {
    canHandle(filePath: string): boolean;
    transform(file: CodeFile, candidates: TransformCandidate[]): Promise<boolean>; // Returns didMutate
  }
  ```
- [ ] **Extract `ReactWriter`**: Move current `run()` loop logic that manipulates `SourceFile` into `ReactWriter`.
- [ ] **Implement `VueWriter`**:
  - **Dependencies**: `magic-string`.
  - **Logic**:
    1. Read `.vue` file.
    2. Create `MagicString` instance.
    3. **Template**: Iterate candidates. Replace `"Hello"` with `$t('key')`. Handle attribute binding (`label="Hi"` -> `:label="$t('key')"`).
    4. **Script**: Extract `<script>` content. Run `ts-morph` on it to inject `const { t } = useI18n()`. Replace the script block in the original string.

### Phase 3: Vue Adapter Configuration
- [ ] Add `vue-i18n` to `ADAPTER_DEPENDENCIES`.
- [ ] Update `i18n.config.json` schema to allow `framework: "vue"`.

## 5. Detailed Task List (JSON)

This JSON structure is intended for agent consumption to execute the plan step-by-step.

```json
{
  "tasks": [
    {
      "id": "core-deps",
      "description": "Add Vue parsing dependencies to core package",
      "command": "pnpm --filter @i18nsmith/core add vue-eslint-parser"
    },
    {
      "id": "refactor-scanner",
      "description": "Refactor Scanner class to support multiple strategies",
      "steps": [
        "Create packages/core/src/parsers/ParserResult.ts",
        "Create packages/core/src/parsers/TypescriptParser.ts (move current ts-morph logic here)",
        "Update Scanner.ts to iterate over parsers"
      ]
    },
    {
      "id": "impl-vue-scanner",
      "description": "Implement Vue parser strategy",
      "steps": [
        "Create packages/core/src/parsers/VueParser.ts",
        "Implement template node traversal",
        "Map Vue AST nodes to ScanCandidate"
      ]
    },
    {
      "id": "transformer-deps",
      "description": "Add manipulation dependencies",
      "command": "pnpm --filter @i18nsmith/transformer add magic-string"
    },
    {
      "id": "refactor-transformer",
      "description": "Abstract Transformer writing logic",
      "steps": [
        "Create packages/transformer/src/writers/Writer.ts (interface)",
        "Create packages/transformer/src/writers/ReactWriter.ts",
        "Update Transformer.ts to use Writer registry"
      ]
    },
    {
      "id": "impl-vue-writer",
      "description": "Implement Vue writer strategy",
      "steps": [
        "Create packages/transformer/src/writers/VueWriter.ts",
        "Implement template string replacement (MagicString)",
        "Implement attribute binding conversion (:) ",
        "Implement script injection (useI18n)"
      ]
    },
    {
      "id": "integration-test",
      "description": "Add e2e tests for vue files",
      "steps": [
        "Create packages/cli/src/fixtures/vue-app",
        "Add test case in e2e.test.ts"
      ]
    }
  ]
}
```

## 6. Code Examples

### VueParser (Sketch)
```typescript
import { parse } from 'vue-eslint-parser';

export class VueParser {
  parse(code: string) {
    const ast = parse(code, { sourceType: 'module' });
    const candidates = [];
    
    // Check ast.templateBody
    // Traverse VElement, VText
  }
}
```

### VueWriter Transformation Rules
- **Text Interpolation**:
  `<div>Hello</div>` -> `<div>{{ $t('hello') }}</div>`
- **Attribute**:
  `<img alt="Description">` -> `<img :alt="$t('description')">`
- **Script**:
  ```javascript
  // Before
  const msg = "Hello";
  
  // After
  import { useI18n } from 'vue-i18n';
  // inside setup()
  const { t } = useI18n();
  const msg = t('hello');
  ```
