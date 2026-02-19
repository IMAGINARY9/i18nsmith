import fs from 'fs/promises';
import path from 'path';
import ts from 'typescript';

const PACKAGES_TO_SCAN = [
  'packages/core/src',
  'packages/transformer/src',
  'packages/translation/src',
  'packages/translator-mock/src',
  'packages/cli/src',
  // The VS Code extension is bundled as CommonJS by esbuild — include it
  // in the scan so top-level await cannot accidentally be introduced there.
  'packages/vscode-extension/src',
];

function isTestFile(file) {
  return /(?:\.test\.|__tests__|test-fixtures|\.spec\.)/.test(file);
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'dist' || e.name === 'node_modules' || e.name === 'test-fixtures') continue;
      files.push(...await collectFiles(full));
    } else if (e.isFile()) {
      if (!/\.(ts|js|mjs|tsx|jsx)$/.test(e.name)) continue;
      if (isTestFile(full)) continue;
      files.push(full);
    }
  }
  return files;
}

function hasTopLevelAwait(sourceFile) {
  let found = [];
  const stack = [];

  function visit(node) {
    // push node to ancestor stack
    stack.push(node);

    if (node.kind === ts.SyntaxKind.AwaitExpression) {
      // Check if any ancestor is a function-like construct
      const inFunction = stack.some((n) => ts.isFunctionLike(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n));
      if (!inFunction) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        found.push({ line: line + 1, column: character + 1 });
      }
    }

    ts.forEachChild(node, visit);
    stack.pop();
  }

  visit(sourceFile);
  return found;
}

async function run() {
  const errors = [];

  for (const pkgPath of PACKAGES_TO_SCAN) {
    const abs = path.join(process.cwd(), pkgPath);
    try {
      const files = await collectFiles(abs);
      for (const file of files) {
        const text = await fs.readFile(file, 'utf8');
        const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, kind);
        const hits = hasTopLevelAwait(sf);
        if (hits.length) errors.push({ file, hits });
      }
    } catch (err) {
      // ignore missing package source dirs
    }
  }

  if (errors.length) {
    console.error('\nTop-level await found in files that are bundled as CommonJS.');
    console.error('Top-level await is not supported by esbuild when producing CJS bundles.');
    console.error('Please move the await inside an async function or convert to a synchronous import.');
    for (const e of errors) {
      for (const h of e.hits) {
        console.error(`  - ${e.file}:${h.line}:${h.column}`);
      }
    }
    process.exitCode = 1;
    throw new Error('Top-level await check failed');
  }

  console.log('No top-level await detected in scanned packages.');
}

if (process.argv[1] && process.argv[1].endsWith('check-no-top-level-await.mjs')) {
  // run when executed directly
  run().catch((err) => { console.error(err); process.exit(1); });
}

export default run;
