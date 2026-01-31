# Adapter & Extensibility Guide

## Overview
Adapters decouple framework/runtime specifics from core scanning, transforming, syncing, and translating. Three adapter families:
1. Translation Runtime Adapter (provider + hook)
2. Transformer Writer Adapter (AST mutation logic)
3. Translator Provider Adapter (external service or mock)

## 1. Translation Runtime Adapter
Defines how the consumer code accesses translations.
```ts
interface TranslationAdapterConfig {
  kind: string;          // e.g. 'react-i18next', 'next-intl', 'vue-i18n'
  module: string;        // import source
  hookName?: string;     // name of hook providing t()
  providerComponent?: string; // provider element for root wrapping
}
```

## 2. Writer Interface (Transformer)
```ts
interface WriterContext { /* file-level state */ }
interface Writer {
  ensureImports(file: SourceFile, cfg: TranslationAdapterConfig): void;
  ensureHook(file: SourceFile, cfg: TranslationAdapterConfig): void;
  replaceNode(candidate: TransformCandidate, ctx: WriterContext): void;
}
```
Implementations: `ReactWriter`, future `VueWriter`, `NoopWriter`.

## 3. Translator Interface
```ts
interface Translator {
  id: string;
  estimate?(texts: string[], opts: EstimateOptions): Promise<EstimateResult>;
  translate(batch: TranslationBatch, opts: TranslateOptions): Promise<TranslateResult>;
}
```
Use environment variable indirection for API key names.

## Lifecycle Hooks
- Pre-translate: placeholder validation.
- Post-translate: shape verification.
- Fallback: use source text when strict mode fails.

## Adding a New Framework Writer
1. Implement `Writer` methods using `ts-morph`.
2. Register via factory: `getWriter(adapter.kind)`.
3. Add tests: import injection, hook creation, replacement cases.
4. Update docs & README support matrix.

## Adding a Translator
1. New package `@i18nsmith/translator-<provider>`.
2. Implement `Translator` with batching + rate limiting.
3. Export minimal index with factory.
4. Document environment variables.

## Support Matrix (Planned)
| Kind | Runtime | Writer | Status |
|------|---------|--------|--------|
| react-i18next | i18next | ReactWriter | Stable |
| next-intl | intl | ReactWriter (shared) | Beta |
| vue-i18n | i18n | VueWriter | Stable |
| lingui | lingui | ReactWriter (extended) | Planned |
| mock | pseudo | NoopWriter + MockTranslator | Stable |

## Design Principles
- Deterministic outputs (key generation & locale sorting).
- Explicit opt-in for destructive operations.
- Clear fallback when adapter unsupported.

## Testing Strategy
- Snapshot tests for AST rewrites.
- Contract tests for translator (placeholder preservation).
- Integration tests for CLI selection logic.

## Future Extensions
- LLM contextual translator.
- HTML extraction adapter.
- Key deprecation lifecycle.
