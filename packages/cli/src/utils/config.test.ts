import { describe, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import { loadConfig } from './config';

// Mock fs
vi.mock('fs/promises');

describe('loadConfig', () => {
  it('should load and normalize config', async () => {
    const mockConfig = {
      sourceLanguage: 'en',
      targetLanguages: ['fr', 'de'],
      localesDir: 'locales',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['node_modules/**'],
      minTextLength: 2,
      translation: { service: 'deepl' },
    };

    (fs.readFile as any).mockResolvedValue(JSON.stringify(mockConfig));

    const config = await loadConfig();

    expect(config.sourceLanguage).toBe('en');
    expect(config.targetLanguages).toEqual(['fr', 'de']);
    expect(config.minTextLength).toBe(2);
  });

  it('should apply defaults', async () => {
    const mockConfig = {};

    (fs.readFile as any).mockResolvedValue(JSON.stringify(mockConfig));

    const config = await loadConfig();

    expect(config.sourceLanguage).toBe('en');
    expect(config.localesDir).toBe('locales');
    expect(config.include).toEqual(['src/**/*.{ts,tsx,js,jsx}']);
    expect(config.minTextLength).toBe(1);
  });

  it('should handle string arrays', async () => {
    const mockConfig = {
      targetLanguages: 'fr,de',
      include: 'src/**/*.{ts,tsx}',
    };

    (fs.readFile as any).mockResolvedValue(JSON.stringify(mockConfig));

    const config = await loadConfig();

    expect(config.targetLanguages).toEqual(['fr', 'de']);
    expect(config.include).toEqual(['src/**/*.{ts,tsx}']);
  });

  it('should throw on missing config', async () => {
    (fs.readFile as any).mockRejectedValue({ code: 'ENOENT' });

    await expect(loadConfig()).rejects.toThrow('Config file not found');
  });
});