# Changelog

All notable changes to this extension will be documented in this file.

## [Unreleased]

### Enhancement
- Enhance Vue adapter and CLI preflight checks; add dependency installation prompts.

## [0.4.2] - 2026-02-09
### Enhancement
- Minor enhancements: Vue adapter improvements and dependency installation prompts.

## [0.4.1] - 2026-02-09
### Fix
- Minor fixes: preflight check improvements and actionable error notifications.

## [0.4.0] - 2026-02-09

### Features
- **Vue.js Support**: Complete Vue.js integration with AST-based parsing, template detection, and transformation capabilities.
- **Multi-Framework Architecture**: Implemented framework registry and adapter system supporting Vue, React, and TypeScript.
- **Enhanced Sync Command**: Added auto-renaming, diff generation, and improved locale file updates with preview output.
- **Preflight Checks**: Added adapter preflight validation before transform/sync/apply operations.
- **Dynamic Key Whitelist**: Implemented quick action and command for whitelisting dynamic keys.
- **Parser Abstraction Layer**: Refactored parsers with abstraction for better extensibility (TypeScript, Vue parsers).
- **Framework Detection**: Enhanced project intelligence with automatic framework detection and scaffolding.
- **Extension Hardening**: Improved error handling, CodeLens refresh, and ghost command fixes.

### Enhancements
- Improved Vue adapter with diagnostics and runtime detection.
- Enhanced extraction configuration with translatable attributes.
- Better candidate extraction and offset handling in parsers.
- Added comprehensive tests for new features and adapters.

## [0.3.3] - 2025-12-21
### Fix
- Prepare release 0.3.3: minor fixes and packaging updates.

## [0.3.4] - 2026-01-08
### Patch
- Prepare release 0.3.4: minor fixes and packaging/CI guidance updates.


## [0.3.2] - 2025-12-20
### Fix
- Fix `npm ERR! EUNSUPPORTEDPROTOCOL` when running CLI via `npx` by bundling workspace dependencies.
- Ensure `npx i18nsmith` works correctly without requiring `pnpm` or workspace setup.

## [0.3.1] - 2025-12-20
### Patch
- Bump patch version to 0.3.1 and prepare republishing because v0.3.0 already exists in the Visual Studio Marketplace.
- Packaging: produce i18nsmith-vscode-0.3.1.vsix for release artifacts.


## [0.3.0] - 2025-12-15
### Refactoring
- Major architectural refactor: moved core logic into dedicated controllers (`SyncController`, `TransformController`, `ExtractionController`, `ConfigurationController`).
- Introduced `ServiceContainer` for better dependency management.
- Cleaned up `extension.ts` to focus on activation and wiring.
- Removed legacy monolithic functions and unused code.
- Improved testability with new controller tests and activation smoke tests.

## [0.2.1] - 2025-12-13
- Chore: bump package version to 0.2.1 and package the compiled extension for release.
- See the commit history for packaging/build details.

## [0.2.0] - 2025-12-12
- Preview-first workflows: suggested commands now open previews by default instead of running destructive --write operations.
- Added support for CLI preview output and diff flags to enable safe preview/apply flows from the extension.
- Fixed duplicate Cancel buttons appearing in modal dialogs.
- Misc: improvements to quick actions, diagnostics refresh, and local CLI integration for development.

## [0.1.1] - 2025-12-04
- README polish: TL;DR, troubleshooting, smoke checklist
- CI: add PR CI workflow for compile/lint/tests
