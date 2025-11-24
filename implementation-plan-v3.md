# Implementation Plan v3 — Runtime Auto-Setup

The autoschool integration highlighted that users hit the `react-i18next::useTranslation NO_I18NEXT_INSTANCE` error unless they manually create `i18n.ts` and wire providers. This plan tracks the fixes we just implemented to make the scaffolding experience turnkey.

## Objectives

1. **Harden scaffolders** so they understand custom locales directories, detect existing files, and optionally overwrite.
2. **Offer automatic runtime setup** (i18n initializer + provider) directly from both `i18nsmith init` and `scaffold-adapter`.
3. **Document the flows** so teams know when to choose the zero-deps adapter vs. the react-i18next runtime.

## Completed Work

- Added workspace-aware helpers in `packages/cli/src/utils/scaffold.ts`:
  - `scaffoldTranslationContext` now computes correct relative imports, respects `localesDir`, and refuses to clobber files unless forced.
  - New `scaffoldI18next` writes `src/lib/i18n.ts` + `src/components/i18n-provider.tsx`, mirroring the proven autoschool fix and guarding against race conditions.
- Extended `scaffold-adapter` command:
  - `--type custom | react-i18next`, `--locales-dir`, `--force`, `--i18n-path`, `--provider-path`.
  - Interactive prompts, dependency warnings, and next-step guidance for wrapping providers.
- Upgraded `i18nsmith init`:
  - When choosing `react-i18next`, users can scaffold the runtime automatically and receive dependency guidance.
  - Custom adapter scaffolding now feeds the locales directory and handles file-exists scenarios gracefully.
- Documentation refresh:
  - README now highlights both scaffold flows, updated quick start commands, and reiterates why the runtime is required.

## Next Ideas

- Auto-detect and patch common Next.js provider files to insert the generated `I18nProvider`.
- Offer `--install-deps` flag to add `react-i18next`/`i18next` automatically when missing.
- Expand scaffold templates for other ecosystems (Solid, Vue) once transformer adapters support them.
