# Recipe: GitLab CI Integration

## Goal
Run automated i18n checks (diagnostics, drift, translation estimates) in GitLab pipelines with artifact retention.

## Example `.gitlab-ci.yml`
```yaml
stages:
  - install
  - build
  - i18n

variables:
  NODE_ENV: production

cache:
  key: ${CI_COMMIT_REF_SLUG}
  paths:
    - node_modules/
    - .i18nsmith/cache/

install:
  stage: install
  script:
    - pnpm install --frozen-lockfile

build:
  stage: build
  script:
    - pnpm -r build

i18n_check:
  stage: i18n
  script:
    - npx i18nsmith check --fail-on conflicts --json --report i18n-check.json || echo "Non-zero exit captured"
    - npx i18nsmith sync --dry-run --json --report i18n-sync.json
  artifacts:
    when: always
    paths:
      - i18n-check.json
      - i18n-sync.json
    expire_in: 1 week
  allow_failure: false

translation_estimate:
  stage: i18n
  script:
    - npx i18nsmith translate --estimate --json --report i18n-translate.json
  artifacts:
    when: always
    paths:
      - i18n-translate.json
    expire_in: 1 week
  rules:
    - if: "$CI_COMMIT_BRANCH == 'main'"
```

## Exit Code Handling
If you want the job to fail outright on drift remove `|| echo "Non-zero exit captured"` so CI surfaces the exit code directly.

## Parallelization Tips
- Run translation estimate only on default branch or scheduled pipelines.
- Use separate jobs for `check` and `sync` if artifacts need independent retention policies.

## Using Environments & Deploy Hooks
Add an environment job gating production deploys:
```yaml
i18n_gate:
  stage: i18n
  script:
    - npx i18nsmith check --fail-on conflicts
  environment:
    name: production
    action: prepare
  only:
    - main
```

## Common Issues
| Issue | Cause | Fix |
|-------|-------|-----|
| Empty reports | Patterns matched 0 files | Add broader include globs or inspect `diagnostics-zero-source-files` warning |
| Slow runs | No cache reuse | Cache `.i18nsmith/cache` plus `node_modules` |
| Missing API key | Not set in CI variables | Add provider secret as masked variable; reference via `translation.secretEnvVar` |

## Next Steps
- Add merge request comment script parsing `i18n-check.json`.
- Gate translation writes behind manual pipeline approval (future Phase 5 enhancement).
