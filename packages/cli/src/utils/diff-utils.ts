/**
 * CLI presentation layer for diff utilities.
 * This module handles printing and writing locale diffs for CLI commands.
 * Core diff building logic is in packages/core/src/diff-utils.ts.
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import type { SyncSummary } from '@i18nsmith/core';

export function printLocaleDiffs(diffs: SyncSummary['diffs']) {
  if (!diffs.length) {
    console.log(chalk.gray('No locale diffs to display.'));
    return;
  }

  console.log(chalk.blue('\nUnified locale diffs:'));
  diffs.forEach((entry) => {
    console.log(chalk.yellow(`\n--- ${entry.locale} (${entry.path})`));
    console.log(entry.diff.trimEnd());
  });
}

export async function writeLocaleDiffPatches(diffs: SyncSummary['diffs'], directory: string) {
  if (!diffs.length) {
    console.log(chalk.gray('No locale diffs to write.'));
    return;
  }

  const targetDir = path.isAbsolute(directory) ? directory : path.resolve(process.cwd(), directory);
  await fs.mkdir(targetDir, { recursive: true });

  await Promise.all(
    diffs.map((entry) => {
      const safeLocale = entry.locale.replace(/[^a-z0-9_-]/gi, '-');
      const fileName = `${safeLocale || 'locale'}.patch`;
      const filePath = path.join(targetDir, fileName);
      return fs.writeFile(filePath, `${entry.diff.trimEnd()}\n`, 'utf8');
    })
  );

  console.log(
    chalk.green(
      `Wrote ${diffs.length} locale patch file${diffs.length === 1 ? '' : 's'} to ${targetDir}.`
    )
  );
}
