import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const external = Object.keys(pkg.dependencies || {});

console.log('Cleaning dist/');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

console.log('Emitting type declarations via tsc...');
execSync('pnpm exec tsc -p tsconfig.json --emitDeclarationOnly', {
  stdio: 'inherit',
});

console.log('Bundling CLI with external dependencies:', external);

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: ['node18'],
  outfile: 'dist/index.js',
  external,
  sourcemap: false,
  minify: false,
});

console.log('CLI bundle built at dist/index.js');
