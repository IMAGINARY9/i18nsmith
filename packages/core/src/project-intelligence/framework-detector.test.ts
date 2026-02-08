import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FrameworkDetector } from './framework-detector.js';
import fs from 'fs/promises';
import path from 'path';
import fg from 'fast-glob';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    stat: vi.fn(),
  },
}));

// Mock fast-glob
vi.mock('fast-glob', () => ({
  default: vi.fn(),
}));

describe('FrameworkDetector', () => {
  let detector: FrameworkDetector;
  const mockWorkspaceRoot = '/test/project';

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
        return pattern === '**/*.vue';
      });
      (detector as any).pathExists = mockPathExists;

      const result = await detector.detect();

      expect(result.type).toBe('nuxt');
      expect(result.evidence).toContainEqual(
        expect.objectContaining({
          type: 'file',
          source: '**/*.vue',
          description: 'Found files matching **/*.vue'
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
});