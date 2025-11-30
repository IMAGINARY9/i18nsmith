#!/usr/bin/env node
/**
 * Phase 5: Simple schema doc generator.
 * Reads selected TypeScript source files and emits a markdown summary of public summary interfaces.
 * For now we do minimal parsing (regex) to avoid compiler dependency overhead; upgrade to TS compiler later.
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';

const targets = [
  'packages/core/src/check-runner.ts',
  'packages/core/src/syncer.ts',
  'packages/cli/src/commands/translate/types.ts'
];

function extractInterface(source, name) {
  const pattern = new RegExp(`export interface ${name} {([\\s\\S]*?)}`);
  const match = source.match(pattern);
  if (!match) return null;
  const body = match[1]
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !l.startsWith('//'));
  return body;
}

async function main() {
  const schemaSections = [];
  for (const rel of targets) {
    const full = resolve(process.cwd(), rel);
    const src = await readFile(full, 'utf8');
    const interfaces = [
      'CheckSummary',
      'SyncSummary',
      'TranslateSummary'
    ];
    for (const name of interfaces) {
      if (!src.includes(`interface ${name} `)) continue;
      const body = extractInterface(src, name);
      if (!body) continue;
      schemaSections.push({ name, body });
    }
  }

  const lines = [];
  lines.push('# CLI Report Schemas');
  lines.push('');
  lines.push('schemaVersion: 1');
  lines.push('');
  for (const section of schemaSections) {
    lines.push(`## ${section.name}`);
    lines.push('```ts');
    lines.push(`interface ${section.name} {`);
    for (const entry of section.body) {
      lines.push(`  ${entry}`);
    }
    lines.push('}');
    lines.push('```');
    lines.push('');
  }

  const outPath = resolve(process.cwd(), 'docs/schema.md');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join('\n'), 'utf8');
  console.log('Generated docs/schema.md');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
