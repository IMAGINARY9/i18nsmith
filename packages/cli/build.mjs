import * as esbuild from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

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
// Run a static check to prevent accidentally introducing top-level await in
// packages that are bundled into the CJS CLI. Top-level await breaks esbuild
// when producing `format: 'cjs'` bundles.
await import('../../scripts/check-no-top-level-await.mjs').then((m) => m.default());

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs', // CommonJS output avoids ESM dynamic-require limitations
  target: ['node18'],
  outfile: 'dist/index.cjs',
  // Produce a self-contained bundle for npx installs
  external: ['vue-eslint-parser', 'eslint', 'espree'],
  sourcemap: false,
  minify: false,
});

// Add shebang was above to make the CJS bundle executable when installed via npm/npx
// (esbuild supports banner to prepend text).
console.log('CLI bundle built at dist/index.cjs (CommonJS)');

// Emit a small ESM shim that forwards imports to the CJS bundle. This satisfies
// `exports.import` consumers while keeping the runtime CLI as CommonJS.
const shim = `import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);\nconst cjs = require('./index.cjs');\nexport default cjs;\nfor (const k of Object.keys(cjs)) { try { Object.defineProperty(exports, k, { enumerable: true, get: () => cjs[k] }); } catch (e) {} }\n`;
writeFileSync('dist/index.js', shim, 'utf8');
console.log('ESM shim written to dist/index.js');
