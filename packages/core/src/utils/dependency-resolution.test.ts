import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { isPackageResolvable, requireFromWorkspace, buildResolutionPaths } from './dependency-resolution.js';

describe('dependency-resolution utilities', () => {
  it('buildResolutionPaths returns unique ancestor node_module paths', () => {
    const paths = buildResolutionPaths('/a/b/c');
    expect(paths).toContain('/a/b/c');
    expect(paths.some(p => p.endsWith('node_modules'))).toBeTruthy();
  });

  it('resolves and requires a package placed in workspace node_modules', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-test-'));
    const nm = path.join(tmp, 'node_modules', 'vue-eslint-parser');
    await fs.mkdir(nm, { recursive: true });
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test-project' }));
    // simple module that exports a marker
    await fs.writeFile(path.join(nm, 'index.js'), "module.exports = { marker: 'ok' };\n");

    try {
      expect(isPackageResolvable('vue-eslint-parser', tmp)).toBe(true);
      const mod = requireFromWorkspace('vue-eslint-parser', tmp) as any;
      expect(mod).toBeDefined();
      expect(mod.marker).toBe('ok');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('isPackageResolvable returns false when package is not present', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-test-'));
    await fs.writeFile(path.join(tmp, 'package.json'), JSON.stringify({ name: 'empty' }));
    try {
      expect(isPackageResolvable('this-package-does-not-exist', tmp)).toBe(false);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
