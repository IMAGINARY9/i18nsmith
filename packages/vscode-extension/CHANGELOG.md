# Changelog

All notable changes to this extension will be documented in this file.

## [Unreleased]

## [0.3.3] - 2025-12-21
### Fix
- Prepare release 0.3.3: minor fixes and packaging updates.


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
