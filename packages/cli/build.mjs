import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

JSON.parse(readFileSync('./package.json', 'utf8'));

console.log('Cleaning dist/');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

console.log('Emitting type declarations via tsc...');
execSync('pnpm exec tsc -p tsconfig.json --emitDeclarationOnly', {
  stdio: 'inherit',
});

console.log('Bundling CLI as a single, self-contained CommonJS file (no externals)');

// Produce a single CommonJS bundle so `npx`/npm-installed binaries run consistently
// (some deps perform dynamic require() calls which fail under ESM bundles).
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs', // CommonJS output avoids ESM dynamic-require limitations
  target: ['node18'],
  outfile: 'dist/index.cjs',
  // Produce a self-contained bundle for npx installs
  external: [],
  sourcemap: false,
  minify: false,
});

console.log('CLI bundle built at dist/index.cjs (CommonJS)');
