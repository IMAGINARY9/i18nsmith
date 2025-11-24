import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export type PackageManager = 'pnpm' | 'yarn' | 'npm';

export async function detectPackageManager(workspaceRoot = process.cwd()): Promise<PackageManager> {
  if (await fileExists(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (await fileExists(path.join(workspaceRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

export async function installDependencies(manager: PackageManager, deps: string[], workspaceRoot = process.cwd()) {
  const args = manager === 'npm' ? ['install', ...deps] : ['add', ...deps];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(manager, args, {
      cwd: workspaceRoot,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${manager} exited with code ${code}`));
      }
    });
  });
}

async function fileExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
