import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

describe('translate command', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-translate-test-'));
    
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
    
    // Create source locale
    await fs.writeFile(
      path.join(tempDir, 'locales', 'en.json'),
      JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye' }, null, 2)
    );
    
    // Create target locale with one missing key
    await fs.writeFile(
      path.join(tempDir, 'locales', 'fr.json'),
      JSON.stringify({ greeting: 'Bonjour' }, null, 2)
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

  describe('--export', () => {
    it('exports missing translations to CSV', async () => {
      const csvPath = path.join(tempDir, 'missing.csv');
      const output = runCli(`translate --export ${csvPath}`);
      
      expect(output).toContain('Exported');
      
      const csvContent = await fs.readFile(csvPath, 'utf8');
      expect(csvContent).toContain('key,sourceLocale,sourceValue,targetLocale,translatedValue');
      expect(csvContent).toContain('farewell');
      expect(csvContent).toContain('Goodbye');
      expect(csvContent).toContain('fr');
    });

    it('handles empty values correctly', async () => {
      // All translations are present
      await fs.writeFile(
        path.join(tempDir, 'locales', 'fr.json'),
        JSON.stringify({ greeting: 'Bonjour', farewell: 'Au revoir' }, null, 2)
      );
      
      const output = runCli('translate --export output.csv');
      expect(output).toContain('No missing translations');
    });
  });

  describe('--import', () => {
    it('imports translations from CSV', async () => {
      const csvPath = path.join(tempDir, 'translations.csv');
      await fs.writeFile(
        csvPath,
        `key,sourceLocale,sourceValue,targetLocale,translatedValue
farewell,en,Goodbye,fr,Au revoir
`
      );

      const output = runCli(`translate --import ${csvPath} --write`);
      expect(output).toContain('1 row');
      
      const frContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
      const frData = JSON.parse(frContent);
      expect(frData.farewell).toBe('Au revoir');
    });

    it('skips rows with empty translatedValue', async () => {
      const csvPath = path.join(tempDir, 'translations.csv');
      await fs.writeFile(
        csvPath,
        `key,sourceLocale,sourceValue,targetLocale,translatedValue
farewell,en,Goodbye,fr,
`
      );

      const output = runCli(`translate --import ${csvPath}`);
      expect(output).toContain('skipped');
    });

    it('handles quoted CSV fields with commas', async () => {
      // Add a source key with comma
      await fs.writeFile(
        path.join(tempDir, 'locales', 'en.json'),
        JSON.stringify({ 
          greeting: 'Hello', 
          farewell: 'Goodbye',
          message: 'Hello, world!' 
        }, null, 2)
      );
      
      const csvPath = path.join(tempDir, 'translations.csv');
      await fs.writeFile(
        csvPath,
        `key,sourceLocale,sourceValue,targetLocale,translatedValue
message,en,"Hello, world!",fr,"Bonjour, le monde!"
`
      );

      const output = runCli(`translate --import ${csvPath} --write`);
      expect(output).toContain('1 row');
      
      const frContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
      const frData = JSON.parse(frContent);
      expect(frData.message).toBe('Bonjour, le monde!');
    });

    it('dry-run mode does not write files', async () => {
      const csvPath = path.join(tempDir, 'translations.csv');
      await fs.writeFile(
        csvPath,
        `key,sourceLocale,sourceValue,targetLocale,translatedValue
farewell,en,Goodbye,fr,Au revoir
`
      );

      const originalContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
      
      const output = runCli(`translate --import ${csvPath}`);
      expect(output).toContain('DRY RUN');
      
      const newContent = await fs.readFile(path.join(tempDir, 'locales', 'fr.json'), 'utf8');
      expect(newContent).toBe(originalContent);
    });
  });
});
