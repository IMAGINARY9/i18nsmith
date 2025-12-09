import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// Externalize all runtime dependencies (chalk, commander, etc.)
// Workspace dependencies (@i18nsmith/*) will be moved to devDependencies
// and thus will NOT be in pkg.dependencies, so they will be bundled.
const external = Object.keys(pkg.dependencies || {});

console.log('Bundling CLI with external dependencies:', external);

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/index.js',
  external,
  banner: {
    js: '#!/usr/bin/env node',
  },
  sourcemap: true,
  minify: false, // Keep readable for now, or minify if preferred
});
