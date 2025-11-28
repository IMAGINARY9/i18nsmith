import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_PATH = path.resolve(__dirname, '../../dist/index.js');

function runCli(args: string[], options: { cwd?: string } = {}) {
  const result = spawnSync('node', [CLI_PATH, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      CI: 'true',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: (result.stdout ?? '') + (result.stderr ?? ''),
    exitCode: result.status ?? 1,
  };
}

describe('debug-patterns command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-debug-patterns-'));
    
    // Create a basic config
    const config = {
      sourceLanguage: 'en',
      targetLanguages: ['fr'],
      localesDir: 'locales',
      include: ['src/**/*.tsx', 'src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    };
    await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));
    
    // Create some source files
    await fs.mkdir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src', 'App.tsx'), 'export function App() { return <div>Hello</div>; }');
    await fs.writeFile(path.join(tmpDir, 'src', 'utils.ts'), 'export const add = (a: number, b: number) => a + b;');
    await fs.writeFile(path.join(tmpDir, 'src', 'utils.test.ts'), 'test("add", () => expect(add(1, 2)).toBe(3));');
    
    // Create locales directory
    await fs.mkdir(path.join(tmpDir, 'locales'));
    await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), '{}');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should show include patterns with file counts', () => {
    const result = runCli(['debug-patterns'], { cwd: tmpDir });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Include Patterns');
    expect(result.output).toContain('src/**/*.tsx');
    expect(result.output).toContain('src/**/*.ts');
  });

  it('should show exclude patterns', () => {
    const result = runCli(['debug-patterns'], { cwd: tmpDir });

    expect(result.output).toContain('Exclude Patterns');
    expect(result.output).toContain('**/*.test.ts');
  });

  it('should show summary with effective file count', () => {
    const result = runCli(['debug-patterns'], { cwd: tmpDir });

    expect(result.output).toContain('Summary');
    expect(result.output).toContain('Effective files to scan');
  });

  it('should list files in verbose mode', () => {
    const result = runCli(['debug-patterns', '--verbose'], { cwd: tmpDir });

    expect(result.output).toContain('App.tsx');
    expect(result.output).toContain('utils.ts');
  });

  it('should output JSON when --json flag is used', () => {
    const result = runCli(['debug-patterns', '--json'], { cwd: tmpDir });

    // Extract JSON from output
    const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
    expect(jsonMatch).not.toBeNull();
    
    const parsed = JSON.parse(jsonMatch![0]);
    expect(parsed).toHaveProperty('includePatterns');
    expect(parsed).toHaveProperty('excludePatterns');
    expect(parsed).toHaveProperty('effectiveFiles');
    expect(Array.isArray(parsed.effectiveFiles)).toBe(true);
  });

  it('should detect unmatched patterns and suggest fixes', async () => {
    // Update config with a pattern that won't match
    const config = {
      sourceLanguage: 'en',
      targetLanguages: ['fr'],
      localesDir: 'locales',
      include: ['app/**/*.tsx', 'src/**/*.tsx'],  // app/ doesn't exist
      exclude: ['**/node_modules/**'],
    };
    await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config, null, 2));

    const result = runCli(['debug-patterns'], { cwd: tmpDir });

    // Should show the pattern that matched 0 files
    expect(result.output).toContain('app/**/*.tsx');
    expect(result.output).toContain('0 file(s)');
  });

  it('should handle missing config gracefully', async () => {
    await fs.rm(path.join(tmpDir, 'i18n.config.json'));

    const result = runCli(['debug-patterns'], { cwd: tmpDir });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain('failed');
  });
});
