# E2E Test Fixtures

This directory contains fixture projects for end-to-end testing of i18nsmith CLI commands.

## Fixture Projects

### `basic-react`
A minimal React project with react-i18next for basic workflow testing.
- Tests: scan, sync, transform, check commands
- Uses: react-i18next adapter

### `nested-locales`
Tests nested locale file structure (flat vs nested JSON).
- Tests: --rewrite-shape flat/nested
- Uses: Nested JSON structure with dot-delimited keys

### `multi-namespace`
Tests namespace-based organization.
- Tests: Namespace scanning, multi-file locales
- Uses: Multiple namespace JSON files

### `suspicious-keys`
Tests detection and handling of suspicious key patterns.
- Tests: audit, sync --strict, auto-rename features
- Uses: Various problematic key patterns

### `backup-restore`
Tests backup and restore functionality.
- Tests: backup-list, backup-restore, --no-backup
- Uses: Pre-created backup directories

## Usage in Tests

```typescript
import { setupFixture, cleanupFixture } from './helpers';

describe('some feature', () => {
  let fixtureDir: string;
  
  beforeEach(async () => {
    fixtureDir = await setupFixture('basic-react');
  });
  
  afterEach(async () => {
    await cleanupFixture(fixtureDir);
  });
  
  it('should work', () => {
    const result = runCli(['scan'], { cwd: fixtureDir });
    expect(result.exitCode).toBe(0);
  });
});
```

## Adding New Fixtures

1. Create a new directory under `fixtures/`
2. Add `i18n.config.json` with appropriate settings
3. Add source files and locales as needed
4. Document the fixture in this README
5. Add tests that use the fixture
