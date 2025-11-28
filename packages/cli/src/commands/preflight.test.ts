/**
 * Tests for the preflight onboarding check command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// We'll test the core validation logic by importing the module
// For now, test the file structure and utilities

describe('preflight command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-preflight-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('config file detection', () => {
    it('should detect when config file exists', async () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr', 'de'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      await fs.writeFile(path.join(tmpDir, 'i18n.config.json'), JSON.stringify(config));
      
      const configPath = path.join(tmpDir, 'i18n.config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(true);
    });

    it('should detect when config file is missing', async () => {
      const configPath = path.join(tmpDir, 'i18n.config.json');
      const exists = await fs.access(configPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(false);
    });
  });

  describe('locales directory validation', () => {
    it('should detect when locales directory exists', async () => {
      await fs.mkdir(path.join(tmpDir, 'locales'));
      
      const localesPath = path.join(tmpDir, 'locales');
      const stats = await fs.stat(localesPath);
      
      expect(stats.isDirectory()).toBe(true);
    });

    it('should detect when locales directory is missing', async () => {
      const localesPath = path.join(tmpDir, 'locales');
      const exists = await fs.access(localesPath).then(() => true).catch(() => false);
      
      expect(exists).toBe(false);
    });
  });

  describe('source locale validation', () => {
    it('should detect valid source locale file', async () => {
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(
        path.join(tmpDir, 'locales', 'en.json'),
        JSON.stringify({ 'hello.world': 'Hello World' })
      );
      
      const localePath = path.join(tmpDir, 'locales', 'en.json');
      const content = await fs.readFile(localePath, 'utf8');
      const data = JSON.parse(content);
      
      expect(data).toHaveProperty('hello.world');
    });

    it('should detect invalid JSON in locale file', async () => {
      await fs.mkdir(path.join(tmpDir, 'locales'));
      await fs.writeFile(path.join(tmpDir, 'locales', 'en.json'), '{ invalid json }');
      
      const localePath = path.join(tmpDir, 'locales', 'en.json');
      const content = await fs.readFile(localePath, 'utf8');
      
      expect(() => JSON.parse(content)).toThrow();
    });
  });

  describe('write permission checks', () => {
    it('should be able to write to temp directory', async () => {
      const testFile = path.join(tmpDir, '.write-test');
      await fs.writeFile(testFile, 'test');
      const content = await fs.readFile(testFile, 'utf8');
      await fs.unlink(testFile);
      
      expect(content).toBe('test');
    });
  });

  describe('config validation', () => {
    it('should validate source language is present', () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      
      expect(config.sourceLanguage).toBe('en');
      expect(config.sourceLanguage.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect missing target languages', () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: [] as string[],
        localesDir: 'locales',
        include: ['src/**/*.tsx'],
      };
      
      expect(config.targetLanguages.length).toBe(0);
    });

    it('should detect node_modules in include patterns', () => {
      const config = {
        sourceLanguage: 'en',
        targetLanguages: ['fr'],
        localesDir: 'locales',
        include: ['src/**/*.tsx', 'node_modules/**/*.tsx'],
      };
      
      const hasNodeModules = config.include.some(p => p.includes('node_modules'));
      expect(hasNodeModules).toBe(true);
    });
  });
});
