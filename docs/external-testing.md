# External Project Integration Testing Guide

This document explains how to run the i18nsmith transformer against a local external project for testing purposes.

## Prerequisites

1. Have the external project checked out locally and accessible from your machine.
2. Inside that project, run `pnpm install` (or `npm install`) so TypeScript sources resolve properly.
3. Generate an `i18n.config.json` in the external project root via `i18nsmith init` or copy a template. Minimal example:
   ```json
   {
     "sourceLanguage": "en",
     "targetLanguages": ["fr"],
     "localesDir": "locales",
     "include": ["src/**/*.tsx"],
     "exclude": ["node_modules/**"]
   }
   ```
4. From the i18nsmith repo root, run `pnpm install` so the CLI, core, and transformer packages are available locally.

> Tip: Run `i18nsmith check --fail-on warnings` inside the external project before transforming to confirm locales/runtimes are healthy. The command is read-only and surfaces actionable follow-up commands.

## Running the transformer against an external project

A convenience script is available that accepts the external project path as the first argument or via the `EXTERNAL_PROJECT_ROOT` environment variable.

```bash
# Using positional arg
pnpm external:transform -- /path/to/external/project --write

# Or via environment variable
EXTERNAL_PROJECT_ROOT=/path/to/external/project pnpm external:transform --write
```

What the script does:

- Ensures the local `@i18nsmith/cli` package is built if needed.
- Switches the working directory to the specified external project so the transformer operates on the real workspace.
- Executes the CLI `transform` command and forwards any additional CLI flags you pass.

### Passing extra options

Any additional arguments after the project path are forwarded directly to the CLI. For example:

```bash
pnpm external:transform /path/to/project --json
pnpm external:transform /path/to/project --write --config custom-i18n.config.json
```

If you omit `--config`, the script automatically uses `i18n.config.json` from the external project root.

### Data safety

- The runner never stages or commits files in either repository; it simply runs the transformer and leaves the external project's working tree modified so you can review diffs yourself.
- Add your external project to `.gitignore` at the i18nsmith repo root if you keep a local path reference or caching folder under the repo (see the recommended entries below).
- Always run `git status` inside the external project after each transform run and review changes before committing.

## Recommended .gitignore entries (repo root)

Add these to your root `.gitignore` to prevent accidental tracking of local test artifacts:

```
# Local external projects used for testing (do not commit)
external-projects/
.local-i18n/
.local-testing/
tmp-transformer-*
*.local-transform-*
```

## Troubleshooting

- **Missing repo**: The script fails if the supplied path does not exist.
- **Missing config**: A warning is printed if `i18n.config.json` is absent; run `i18nsmith init` inside the project.
- **Build errors**: Run `pnpm --filter @i18nsmith/cli build` manually to see TypeScript diagnostics before re-running the script.
- **Permissions**: Ensure the external project working directory is writable so locale JSON files can be created.

With these steps, you can test i18nsmith against any local project while keeping sensitive paths out of the repository.
