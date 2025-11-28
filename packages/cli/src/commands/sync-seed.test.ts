import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

describe('sync --seed-target-locales', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-seed-test-'));
    
    // Create basic project structure
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'locales'), { recursive: true });
    
    // Create source file with translation calls
    await fs.writeFile(
      path.join(tempDir, 'src', 'App.tsx'),
      `import { useTranslation } from 'react-i18next';
export function App() {
  const { t } = useTranslation();
  return <div>{t('greeting')}{t('farewell')}</div>;
}
`
    );
    
    // Create source locale with both keys
    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye' }, null, 2)
    );
    
    // Create empty target locale
    await fs.writeFile(
      path.join(tempDir, 'locales', 'fr.json'),
      JSON.stringify({}, null, 2)
    );
    
    // Create config
    await fs.writeFile(
      path.join(tempDir, 'i18n.config.json'),
      JSON.stringify({
        version: 1,
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.{ts,tsx}'],
      }, null, 2)
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const runCli = (args: string): string => {
    const cliPath = path.resolve(__dirname, '..', '..', 'dist', 'index.js');
    try {
      return execSync(`node ${cliPath} ${args}`, {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string };
      return (err.stdout ?? '') + (err.stderr ?? '');
    }
  };

  it('seeds target locales with empty string by default', async () => {
    const output = runCli('sync --write --seed-target-locales');
    expect(output).toContain('Syncing');
    
    const frContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
    const frData = JSON.parse(frContent);
    
    // Should have both keys seeded in target locale
    expect(frData.greeting).toBe('');
    expect(frData.farewell).toBe('');
  });

  it('seeds target locales with custom seed value', async () => {
    const output = runCli('sync --write --seed-target-locales --seed-value "[TODO]"');
    expect(output).toContain('Syncing');
    
    const frContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
    const frData = JSON.parse(frContent);
    
    // Should have both keys seeded with [TODO]
    expect(frData.greeting).toBe('[TODO]');
    expect(frData.farewell).toBe('[TODO]');
  });

  it('does not seed when flag is not provided', async () => {
    const output = runCli('sync --write');
    expect(output).toContain('Syncing');
    
    const frContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
    const frData = JSON.parse(frContent);
    
    // Target locale should remain empty (no seeding)
    expect(Object.keys(frData).length).toBe(0);
  });

  it('dry-run shows what would be seeded', async () => {
    const output = runCli('sync --seed-target-locales');
    expect(output).toContain('DRY RUN');
    expect(output).toContain('missing');
    
    // File should not be modified
    const frContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
    const frData = JSON.parse(frContent);
    expect(Object.keys(frData).length).toBe(0);
  });
});
