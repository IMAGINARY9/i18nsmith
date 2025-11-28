#!/usr/bin/env node
import { spawnSync, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

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

function runQuiet(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    shell: false,
    ...options,
  });
  return result;
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

function checkConfig(projectRoot, configPath) {
  const configFile = path.join(projectRoot, configPath);
  if (!fs.existsSync(configFile)) {
    console.warn('\n[i18nsmith] ⚠️  Config file not found: ' + configPath);
    console.warn('[i18nsmith]    Run "npx i18nsmith init" inside the project to generate it.');
    console.warn('[i18nsmith]    Or specify a custom path with --config <path>\n');
    return null;
  }
  return JSON.parse(fs.readFileSync(configFile, 'utf8'));
}

async function showMatchedFiles(projectRoot, config) {
  if (!config || !config.include) {
    return;
  }

  try {
    const patterns = Array.isArray(config.include) ? config.include : [config.include];
    const excludePatterns = config.exclude || [];
    
    let matchedFiles = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, { 
        cwd: projectRoot, 
        ignore: excludePatterns,
        nodir: true 
      });
      matchedFiles.push(...matches);
    }

    // Dedupe and sort
    matchedFiles = [...new Set(matchedFiles)].sort();
    
    if (matchedFiles.length === 0) {
      console.warn('\n[i18nsmith] ⚠️  No source files matched the include patterns:');
      console.warn('             ' + patterns.join(', '));
      console.warn('[i18nsmith]    Check your i18n.config.json include/exclude settings.\n');
    } else {
      console.log(`\n[i18nsmith] 📁 ${matchedFiles.length} source file(s) will be scanned:`);
      const displayFiles = matchedFiles.slice(0, 10);
      displayFiles.forEach(f => console.log(`             • ${f}`));
      if (matchedFiles.length > 10) {
        console.log(`             ... and ${matchedFiles.length - 10} more`);
      }
      console.log();
    }
  } catch (error) {
    // Ignore glob errors, just skip file preview
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
  
  // Check config and show matched files
  const configPath = 'i18n.config.json';
  const config = checkConfig(projectRoot, configPath);
  
  if (config) {
    console.log('[i18nsmith] ✓ Found config: ' + configPath);
    await showMatchedFiles(projectRoot, config);
  }

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
  
  // Suggest next steps after successful run
  console.log('\n[i18nsmith] ✅ Transform complete!');
  console.log('[i18nsmith] Next steps:');
  console.log('             • Run "npx i18nsmith sync --write" to update locale files');
  console.log('             • Run "npx i18nsmith check" to verify locale consistency');
}

main();
