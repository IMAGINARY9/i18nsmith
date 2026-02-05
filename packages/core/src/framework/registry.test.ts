import { describe, it, expect, beforeEach } from 'vitest';
import { AdapterRegistry } from './registry.js';
import type { FrameworkAdapter } from './types.js';

// Mock adapter for testing
class MockAdapter implements FrameworkAdapter {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly extensions: string[],
    public readonly capabilities = { scan: true, mutate: true, diff: true }
  ) {}

  checkDependencies() {
    return [{ name: 'mock-dep', available: true, installHint: 'npm install mock' }];
  }

  scan() {
    return [];
  }

  mutate() {
    return { didMutate: false, content: '', edits: [] };
  }
}

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  describe('register and getById', () => {
    it('should register and retrieve adapters by ID', () => {
      const adapter = new MockAdapter('test', 'Test Adapter', ['.test']);

      registry.register(adapter);

      expect(registry.getById('test')).toBe(adapter);
      expect(registry.getById('nonexistent')).toBeUndefined();
    });
  });

  describe('getForFile', () => {
    it('should return adapter that handles the file extension', () => {
      const reactAdapter = new MockAdapter('react', 'React', ['.tsx', '.jsx']);
      const vueAdapter = new MockAdapter('vue', 'Vue', ['.vue']);

      registry.register(reactAdapter);
      registry.register(vueAdapter);

      expect(registry.getForFile('component.tsx')).toBe(reactAdapter);
      expect(registry.getForFile('component.jsx')).toBe(reactAdapter);
      expect(registry.getForFile('component.vue')).toBe(vueAdapter);
      expect(registry.getForFile('component.js')).toBeUndefined();
    });

    it('should return first matching adapter for overlapping extensions', () => {
      const adapter1 = new MockAdapter('adapter1', 'Adapter 1', ['.js', '.ts']);
      const adapter2 = new MockAdapter('adapter2', 'Adapter 2', ['.js']);

      registry.register(adapter1);
      registry.register(adapter2);

      // adapter1 is registered first, so it should win for .js files
      expect(registry.getForFile('file.js')).toBe(adapter1);
    });
  });

  describe('getAll', () => {
    it('should return all registered adapters', () => {
      const adapter1 = new MockAdapter('adapter1', 'Adapter 1', ['.ext1']);
      const adapter2 = new MockAdapter('adapter2', 'Adapter 2', ['.ext2']);

      registry.register(adapter1);
      registry.register(adapter2);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all).toContain(adapter1);
      expect(all).toContain(adapter2);
    });
  });

  describe('preflightCheck', () => {
    it('should run dependency checks for all adapters', () => {
      const adapter1 = new MockAdapter('adapter1', 'Adapter 1', ['.ext1']);
      const adapter2 = new MockAdapter('adapter2', 'Adapter 2', ['.ext2']);

      registry.register(adapter1);
      registry.register(adapter2);

      const results = registry.preflightCheck();

      expect(results.size).toBe(2);
      expect(results.get('adapter1')).toEqual([
        { name: 'mock-dep', available: true, installHint: 'npm install mock' }
      ]);
      expect(results.get('adapter2')).toEqual([
        { name: 'mock-dep', available: true, installHint: 'npm install mock' }
      ]);
    });
  });
});