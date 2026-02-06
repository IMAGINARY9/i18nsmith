# Contributing

Thanks for contributing to i18nsmith! A few quick notes to help you get started.

Getting started

1. Fork the repo and create a feature branch.
2. Run `pnpm install --no-frozen-lockfile` at the repo root.
3. Build the workspace: `pnpm -r build`.
4. Run the extension in the Extension Development Host (open `packages/vscode-extension` and press F5).

Reporting bugs and features

- Use the issue templates in `.github/ISSUE_TEMPLATE/`.
- For feature requests, include motivation and usage examples.

Code style & tests

- Run `pnpm --filter i18nsmith-vscode lint` and `pnpm --filter i18nsmith-vscode test` before opening a PR.
- Keep changes small and focused. Add tests for new logic where appropriate.

Releases

- Update `packages/vscode-extension/CHANGELOG.md` and bump the version in `packages/vscode-extension/package.json` when preparing a release.

## Adding a New Framework Adapter

i18nsmith supports multiple frontend frameworks through pluggable adapters. To add support for a new framework:

1. **Create the adapter** in `packages/core/src/framework/adapters/<framework>.ts`
   - Implement the `FrameworkAdapter` interface
   - Handle framework-specific AST transformations
   - Add dependency checks for framework parsers

2. **Add comprehensive tests** in `packages/core/src/framework/adapters/<framework>.test.ts`
   - Unit tests for scanning and mutation logic
   - Integration tests with sample files

3. **Register the adapter** in CLI/extension setup
   - Add to `AdapterRegistry` in the main entry point
   - Update preflight checks

4. **Add CI matrix entry** in `.github/workflows/`
   - Include framework-specific dependencies
   - Run adapter tests in parallel

5. **Update documentation**
   - Add to supported frameworks list in README.md
   - Document any framework-specific configuration

See existing adapters (ReactAdapter, VueAdapter) for reference implementations.
