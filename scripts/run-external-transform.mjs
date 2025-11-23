#!/usr/bin/env node
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const cliDist = path.resolve(repoRoot, 'packages/cli/dist/index.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureCliBuild() {
  if (fs.existsSync(cliDist)) {
    return;
  }

  console.log('[i18nsmith] Building CLI before running transform...');
  run('pnpm', ['--filter', '@i18nsmith/cli', 'build'], { cwd: repoRoot });

  if (!fs.existsSync(cliDist)) {
    console.error('[i18nsmith] CLI build output not found at', cliDist);
    process.exit(1);
  }
}

function ensureProjectRoot(projectRoot) {
  if (!fs.existsSync(projectRoot)) {
    console.error(`[i18nsmith] Expected external project at ${projectRoot}`);
    process.exit(1);
  }
}

function warnIfConfigMissing(projectRoot, configPath) {
  const configFile = path.join(projectRoot, configPath);
  if (!fs.existsSync(configFile)) {
    console.warn(`[i18nsmith] Warning: ${configFile} not found. Run "i18nsmith init" inside the project to generate it.`);
  }
}

async function main() {
  // Allow passing project root as first positional arg, or via EXTERNAL_PROJECT_ROOT env var
  const extraArgs = process.argv.slice(2);
  let projectRoot = process.env.EXTERNAL_PROJECT_ROOT ?? extraArgs[0];

  if (!projectRoot) {
    console.error('[i18nsmith] No external project specified. Set EXTERNAL_PROJECT_ROOT or pass the project path as the first argument.');
    process.exit(2);
  }

  projectRoot = path.resolve(projectRoot);

  ensureProjectRoot(projectRoot);
  ensureCliBuild();
  warnIfConfigMissing(projectRoot, 'i18n.config.json');

  // Forward remaining args to CLI
  const forwarded = extraArgs.length > 1 ? extraArgs.slice(1) : [];
  const hasConfigArg = forwarded.some((arg, index) => arg === '--config' || arg.startsWith('--config=') || (forwarded[index - 1] === '--config'));

  const transformArgs = [
    cliDist,
    'transform',
    ...(hasConfigArg ? [] : ['--config', 'i18n.config.json']),
    ...forwarded,
  ];

  console.log(`[i18nsmith] Running transformer in workspace ${projectRoot}...`);
  run('node', transformArgs, { cwd: projectRoot, env: process.env });
}

main();
