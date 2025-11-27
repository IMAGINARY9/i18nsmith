import { promises as fs } from 'fs';
import path from 'path';

export async function readPackageJson() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  try {
    const content = await fs.readFile(pkgPath, 'utf8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    console.warn('Unable to read package.json for dependency checks.');
    return undefined;
  }
}

export function hasDependency(pkg: Record<string, unknown> | undefined, dep: string) {
  if (!pkg) return false;
  const deps = pkg.dependencies as Record<string, unknown> | undefined;
  const devDeps = pkg.devDependencies as Record<string, unknown> | undefined;
  return Boolean(deps?.[dep] || devDeps?.[dep]);
}
