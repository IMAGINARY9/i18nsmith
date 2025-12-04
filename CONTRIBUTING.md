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
