import { describe, it, expect, vi } from 'vitest';
import { DependencyCacheManager } from './dependency-cache-manager';

describe('DependencyCacheManager', () => {
  it('registers and notifies invalidators for installed packages', () => {
    const manager = new DependencyCacheManager();
    const callback = vi.fn();
    manager.register('vue-eslint-parser', callback);

    manager.notifyInstalled(['vue-eslint-parser'], '/workspace');

    expect(callback).toHaveBeenCalledWith('/workspace');
  });

  it('does not call invalidator for unregistered packages', () => {
    const manager = new DependencyCacheManager();
    const callback = vi.fn();
    manager.register('vue-eslint-parser', callback);

    manager.notifyInstalled(['some-other-package'], '/workspace');

    expect(callback).not.toHaveBeenCalled();
  });

  it('handles multiple packages and callbacks', () => {
    const manager = new DependencyCacheManager();
    const vueCallback = vi.fn();
    const otherCallback = vi.fn();
    manager.register('vue-eslint-parser', vueCallback);
    manager.register('other-parser', otherCallback);

    manager.notifyInstalled(['vue-eslint-parser', 'other-parser'], '/workspace');

    expect(vueCallback).toHaveBeenCalledWith('/workspace');
    expect(otherCallback).toHaveBeenCalledWith('/workspace');
  });

  it('ignores errors in invalidator callbacks', () => {
    const manager = new DependencyCacheManager();
    const goodCallback = vi.fn();
    const badCallback = vi.fn(() => { throw new Error('test error'); });
    manager.register('good-package', goodCallback);
    manager.register('bad-package', badCallback);

    expect(() => {
      manager.notifyInstalled(['good-package', 'bad-package'], '/workspace');
    }).not.toThrow();

    expect(goodCallback).toHaveBeenCalledWith('/workspace');
    expect(badCallback).toHaveBeenCalledWith('/workspace');
  });
});