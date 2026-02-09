import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface MissingDep { adapter: string; dependency: string; installHint: string }

/**
 * Run adapter preflight checks to detect missing framework dependencies.
 *
 * Uses a lightweight file-based approach rather than instantiating the core
 * AdapterRegistry, because the extension is bundled as CJS by esbuild and
 * VueAdapter relies on `import.meta.url` which is unavailable in the bundle.
 *
 * Checks:
 * 1. Reads i18n.config.json to determine which file types are included.
 * 2. If Vue files are in scope, verifies vue-eslint-parser is available.
 *
 * Returns an empty array when the config file is missing or unreadable
 * (the "no config" state is handled separately by the quick-actions model).
 */
export function runAdapterPreflightCheck(): MissingDep[] {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return [];
  }

  const configPath = path.join(workspaceRoot, 'i18n.config.json');
  if (!fs.existsSync(configPath)) {
    return [];
  }

  let config: { include?: string[]; exclude?: string[] };
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    return [];
  }

  const missing: MissingDep[] = [];

  // Determine if Vue files are in scope by checking include patterns
  const includePatterns = config.include ?? [];
  const hasVueInScope = includePatterns.some(p => p.includes('.vue'));

  if (hasVueInScope) {
    const pm = detectPackageManager(workspaceRoot);
    const installCmd = pm === 'npm'
      ? 'npm install --save-dev vue-eslint-parser'
      : `${pm} add -D vue-eslint-parser`;

    if (!isPackageAvailable('vue-eslint-parser', workspaceRoot)) {
      missing.push({
        adapter: 'vue',
        dependency: 'vue-eslint-parser',
        installHint: installCmd,
      });
    }
  }

  return missing;
}

/**
 * Check whether a package is available in the project. Checks:
 * 1. Direct node_modules directory existence.
 * 2. Presence in package.json dependencies/devDependencies (handles pnpm
 *    hoisting where the direct folder might not exist).
 */
function isPackageAvailable(packageName: string, workspaceRoot: string): boolean {
  const roots = listAncestorRoots(workspaceRoot);

  // Check node_modules in workspace root and ancestors
  for (const root of roots) {
    if (fs.existsSync(path.join(root, 'node_modules', packageName))) {
      return true;
    }
  }

  // Check package.json in workspace root and ancestors (covers pnpm hoisted layouts)
  for (const root of roots) {
    try {
      const pkgPath = path.join(root, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps[packageName]) {
          return true;
        }
      }
    } catch {
      // ignore
    }
  }

  return false;
}

/** Detect the project's package manager. */
function detectPackageManager(workspaceRoot: string): 'pnpm' | 'yarn' | 'npm' {
  const roots = listAncestorRoots(workspaceRoot);
  for (const root of roots) {
    if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
    if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  }
  return 'npm';
}

function listAncestorRoots(startDir: string): string[] {
  const roots: string[] = [];
  let current = startDir;
  while (true) {
    roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return roots;
}
