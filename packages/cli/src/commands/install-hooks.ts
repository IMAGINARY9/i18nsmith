import fs from 'fs/promises';
import path from 'path';
import { Command } from 'commander';
import { detectPackageManager } from '../utils/package-manager.js';
import { withErrorHandling } from '../utils/errors.js';

interface InstallHooksOptions {
  yes?: boolean;
  force?: boolean;
  skip?: boolean;
  cwd?: string;
}

async function huskyInstalled(root: string) {
  try {
    const pkgPath = path.join(root, 'package.json');
    const pkgRaw = await fs.readFile(pkgPath, 'utf8');
    return /"husky"/.test(pkgRaw);
  } catch {
    return false;
  }
}

async function ensureHusky(root: string, pm: string, force: boolean) {
  if (!force && await huskyInstalled(root)) {
    return;
  }
  const installCmd = pm === 'pnpm' ? 'pnpm add -D husky' : pm === 'yarn' ? 'yarn add -D husky' : 'npm install --save-dev husky';
  console.log(`→ Installing husky: ${installCmd}`);
  console.log('   (Run manually; automatic exec intentionally omitted in prototype)');
}

async function writeHook(root: string, file: string, content: string) {
  const hookPath = path.join(root, '.husky', file);
  await fs.mkdir(path.dirname(hookPath), { recursive: true });
  await fs.writeFile(hookPath, content, 'utf8');
  console.log(`✔ Hook created: ${path.relative(root, hookPath)}`);
}

export function registerInstallHooks(program: Command) {
  const cmd = new Command('install-hooks')
    .description('Prototype: scaffold Husky git hooks for i18nsmith checks')
    .option('-y, --yes', 'Skip confirmations')
    .option('--force', 'Force re-install husky even if present')
    .option('--skip', 'Skip husky installation (just create hooks)')
    .action(
      withErrorHandling(async (opts: InstallHooksOptions) => {
        const cwd = opts.cwd ?? process.cwd();
        const pm = await detectPackageManager();
        const hasHusky = await huskyInstalled(cwd);

        if (!hasHusky && !opts.skip) {
          await ensureHusky(cwd, pm, !!opts.force);
          console.log('Add "prepare": "husky install" to package.json scripts if missing.');
        }

  const preCommitContent = `#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\n[ -n "$I18NSMITH_SKIP_HOOKS" ] && exit 0\nNOCOLOR=1 npx i18nsmith check --fail-on conflicts || exit 1\n`;
  const prePushContent = `#!/bin/sh\n. "$(dirname "$0")/_/husky.sh"\n[ -n "$I18NSMITH_SKIP_HOOKS" ] && exit 0\nNOCOLOR=1 npx i18nsmith sync --dry-run --check || exit 1\n`;

        await writeHook(cwd, 'pre-commit', preCommitContent);
        await writeHook(cwd, 'pre-push', prePushContent);

        console.log('\nHooks added. Set I18NSMITH_SKIP_HOOKS=1 to bypass.');
        console.log('Prototype complete – future versions will offer interactive selection & monorepo scoping.');
      })
    );

  program.addCommand(cmd);
}
