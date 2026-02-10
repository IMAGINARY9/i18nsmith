import path from 'path';

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
  try {
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
  const resolveFrom = buildResolutionPaths(workspaceRoot);
  try {
    // Use require.resolve with paths to find the package in workspace context
    const resolved = require.resolve(packageName, { paths: resolveFrom });
    
    // Clear the cache for this module to ensure fresh loading in case it was
    // previously cached as a failure or older version.
    // This is important for long-running processes (like VS Code extension)
    // where the user might install dependencies while the process is running.
    delete require.cache[resolved];
    
    return require(resolved);
  } catch {
    // Fall back to default resolution
    return require(packageName);
  }
}