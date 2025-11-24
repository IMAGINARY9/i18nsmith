import { promises as fs } from 'fs';
import path from 'path';

export async function readPackageJson() {
  const pkgPath = path.join(process.cwd(), 'package.json');
  try {
    const content = await fs.readFile(pkgPath, 'utf8');
    return JSON.parse(content) as Record<string, any>;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return undefined;
    }
    console.warn('Unable to read package.json for dependency checks.');
    return undefined;
  }
}

export function hasDependency(pkg: Record<string, any> | undefined, dep: string) {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]);
}
