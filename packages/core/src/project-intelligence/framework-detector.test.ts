import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FrameworkDetector } from './framework-detector.js';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import fg, { sync } from 'fast-glob';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    stat: vi.fn(),
  },
}));

// Mock fs readFileSync
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

// Mock fast-glob
vi.mock('fast-glob', () => {
  const mockSync = vi.fn();
  const mockFg = vi.fn();
  mockFg.sync = mockSync;
  return {
    default: mockFg,
    sync: mockSync,
  };
});

describe('FrameworkDetector', () => {
  let detector: FrameworkDetector;
  const mockWorkspaceRoot = '/test/project';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(fs.readFile).mockReset();
    detector = new FrameworkDetector({
      workspaceRoot: mockWorkspaceRoot,
      verbose: false,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new FrameworkDetector({ workspaceRoot: mockWorkspaceRoot });
  });

  describe('aggregate detection evidence', () => {
    it('should detect Vue from file patterns when no packages present', async () => {
      // Mock package.json with no Vue packages
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-vue-project',
            dependencies: {},
            devDependencies: { 'typescript': '^5.0.0' }
          });
        }
        throw new Error('File not found');
      });

      // Mock pathExists
      const mockPathExists = vi.fn();
      mockPathExists.mockImplementation(async (pattern: string) => {
        return pattern === '**/*.vue' || pattern === 'src/**/*.vue';
      });
      (detector as any).pathExists = mockPathExists;

      const result = await detector.detect();

      expect(result.type).toBe('vue');
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          type: 'file',
          source: expect.stringContaining('.vue'),
          description: expect.stringContaining('.vue')
        })
      );
    });

    it('should prefer Nuxt over Vue when nuxt.config exists', async () => {
      // Mock package.json with both Vue and Nuxt packages
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-nuxt-project',
            dependencies: {
              'vue': '^3.0.0',
              'nuxt': '^3.0.0'
            }
          });
        }
        throw new Error('File not found');
      });

      // Mock pathExists
      const mockPathExists = vi.fn();
      mockPathExists.mockImplementation(async (pattern: string) => {
        return pattern === '**/*.vue' || pattern === 'nuxt.config.ts';
      });
      vi.spyOn(detector as any, 'pathExists').mockImplementation(mockPathExists);

      const result = await detector.detect();

      expect(result.type).toBe('nuxt');
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          type: 'package',
          source: 'nuxt'
        })
      );
    });

    it('should prefer Vue over Nuxt when only Vue files exist without Nuxt config', async () => {
      // Mock package.json with Vue but no Nuxt packages
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-vue-project',
            dependencies: { 'vue': '^3.0.0' }
          });
        }
        throw new Error('File not found');
      });

      // Mock pathExists
      const mockPathExists = vi.fn();
      mockPathExists.mockImplementation(async (pattern: string) => {
        return pattern === '**/*.vue';
      });
      vi.spyOn(detector as any, 'pathExists').mockImplementation(mockPathExists);

      const result = await detector.detect();

      expect(result.type).toBe('vue');
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          type: 'file',
          source: '**/*.vue'
        })
      );
      // Should not have Nuxt evidence since no Nuxt config
      expect(result.evidence).not.toContainEqual(
        expect.objectContaining({
          type: 'file',
          source: 'nuxt.config.*'
        })
      );
    });

    it('should collect evidence from multiple frameworks for confidence scoring', async () => {
      // Mock package.json with React
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-project',
            dependencies: { 'react': '^18.0.0' }
          });
        }
        throw new Error('File not found');
      });

      // Mock file existence checks - both Vue and React files exist (unlikely but tests aggregation)
      const mockPathExists = vi.fn();
      mockPathExists.mockImplementation(async (pattern: string) => {
        return pattern === '**/*.vue' || pattern === '**/*.{ts,tsx,js,jsx}';
      });
      (detector as any).pathExists = mockPathExists;

      const result = await detector.detect();

      // Should detect React as primary (has package), but evidence shows both were considered
      expect(result.type).toBe('react');
      expect(result.evidence.length).toBeGreaterThan(1);
    });
  });

  describe('custom adapter detection', () => {
    it('should detect custom adapter from source code imports', async () => {
      // Mock package.json with React
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-custom-adapter',
            dependencies: { 'react': '^18.0.0' },
            devDependencies: {}
          });
        }
        throw new Error('File not found');
      });

      // Mock readFileSync for source files
      vi.mocked(readFileSync).mockImplementation((filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'src/App.tsx')) {
          return `import { useTranslation } from '@/contexts/translation-context';
export function App() {
  const { t } = useTranslation();
  return <div>{t('hello')}</div>;
}
          `;
        }
        throw new Error('File not found');
      });

      // Mock fast-glob.sync to return source files
      vi.mocked(fg.sync).mockReturnValue([
        path.join(mockWorkspaceRoot, 'src/App.tsx')
      ]);

      // Mock pathExists to return false for framework patterns
      const mockPathExists = vi.fn();
      mockPathExists.mockResolvedValue(false);
      (detector as any).pathExists = mockPathExists;

      const result = await detector.detect();

      expect(result.type).toBe('react');
      expect(result.adapter).toBe('@/contexts/translation-context');
      expect(result.evidence.some(e => e.type === 'code')).toBe(true);
    });

    it('should prefer existing config over detection', async () => {
      // Mock package.json with next-intl
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-existing-config',
            dependencies: { 'next-intl': '^3.0.0', 'next': '^14.0.0' },
            devDependencies: {}
          });
        }
        throw new Error('File not found');
      });

      // Mock i18n.config.json
      vi.mocked(readFileSync).mockImplementation((filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'i18n.config.json')) {
          return JSON.stringify({
            version: 1,
            sourceLanguage: 'en',
            translationAdapter: {
              module: '@/contexts/custom-i18n',
              hookName: 'useTranslation'
            }
          });
        }
        throw new Error('File not found');
      });

      const result = await detector.detect();

      expect(result.adapter).toBe('@/contexts/custom-i18n');
      expect(result.evidence.some(e => e.type === 'file' && e.source === 'i18n.config.json')).toBe(true);
    });

    it('should detect Vue custom composables', async () => {
      // Mock package.json with Vue
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-vue-custom',
            dependencies: { 'vue': '^3.0.0' },
            devDependencies: {}
          });
        }
        throw new Error('File not found');
      });

      // Mock readFileSync for source code scanning
      vi.mocked(readFileSync).mockImplementation((filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'src/App.vue')) {
          return `<script setup>
import { useI18n } from '~/composables/useI18n';
const { t } = useI18n();
</script>
<template>
  <div>{{ t('hello') }}</div>
</template>`;
        }
        throw new Error('File not found');
      });

      // Mock fast-glob.sync to return source files
      vi.mocked(fg.sync).mockReturnValue([
        path.join(mockWorkspaceRoot, 'src/App.vue')
      ]);

      const result = await detector.detect();

      expect(result.adapter).toBe('~/composables/useI18n');
      expect(result.evidence.some(e => e.type === 'code')).toBe(true);
    });

    it('should handle conflicts between custom and package adapters', async () => {
      // Mock package.json with both next-intl and custom setup
      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'package.json')) {
          return JSON.stringify({
            name: 'test-conflict',
            dependencies: { 'next-intl': '^3.0.0', 'next': '^14.0.0' },
            devDependencies: {}
          });
        }
        throw new Error('File not found');
      });

      // Mock readFileSync for source code scanning
      vi.mocked(readFileSync).mockImplementation((filePath) => {
        if (filePath === path.join(mockWorkspaceRoot, 'src/App.tsx')) {
          return `import { useTranslation } from '@/contexts/i18n';
export function App() {
  const { t } = useTranslation();
  return <div>{t('hello')}</div>;
}`;
        }
        throw new Error('File not found');
      });

      // Mock fast-glob.sync to return source files
      vi.mocked(fg.sync).mockReturnValue([
        path.join(mockWorkspaceRoot, 'src/App.tsx')
      ]);

      const result = await detector.detect();

      // Should prefer custom adapter
      expect(result.adapter).toBe('@/contexts/i18n');
      // Should have conflict evidence
      expect(result.evidence.some(e => e.type === 'pattern' && e.source === 'conflict')).toBe(true);
    });
  });
});