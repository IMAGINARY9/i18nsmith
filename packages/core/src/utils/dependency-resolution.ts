import path from 'path';
import { createRequire } from 'module';
import fs from 'fs';

/**
 * Build a list of paths to search for module resolution, starting from the given
 * directory and walking up the directory tree to include all ancestor node_modules.
 */
export function buildResolutionPaths(startDir: string): string[] {
  const paths: string[] = [];
  let current = startDir;
  while (true) {
    paths.push(current);
    paths.push(path.join(current, 'node_modules'));
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return Array.from(new Set(paths));
}

/**
 * Check if a package is available for resolution from the given workspace root.
 * Uses require.resolve with ancestor path searching to handle monorepos and
 * different package manager layouts.
 */
export function isPackageResolvable(packageName: string, workspaceRoot: string): boolean {
  // Prefer resolving as if called from the workspace (handles pnpm/yarn/npm
  // layouts and workspaces more reliably). Fall back to path-based
  // resolution if package.json is not present.
  try {
    const pkgJson = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgJson)) {
      const req = createRequire(pkgJson);
      req.resolve(packageName);
      return true;
    }

    const resolveFrom = buildResolutionPaths(workspaceRoot);
    require.resolve(packageName, { paths: resolveFrom });
    return true;
  } catch (e: any) {
    return false;
  }
}

/**
 * Attempt to require a package from the workspace context, falling back to
 * default resolution if not found in workspace.
 */
export function requireFromWorkspace(packageName: string, workspaceRoot: string): any {
  // Try to load the module as if required from the workspace root. This is
  // more reliable for monorepos and package managers that use different
  // node_modules layouts (pnpm, yarn workspaces, etc.). If workspace
  // resolution fails, fall back to normal require().
  try {
    const pkgJson = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(pkgJson)) {
      const req = createRequire(pkgJson);
      const resolved = req.resolve(packageName);
      // Clear any cached copy and require via the workspace-specific require
      delete require.cache[resolved];
      return req(packageName);
    }

    const resolveFrom = buildResolutionPaths(workspaceRoot);
    const resolved = require.resolve(packageName, { paths: resolveFrom });
    delete require.cache[resolved];
    return require(resolved);
  } catch (err) {
    // Let the caller receive the original error when module truly isn't
    // available via any resolution path.
    throw err;
  }
}