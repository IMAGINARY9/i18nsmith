/**
 * Utility to manage .gitignore entries for i18nsmith artifacts.
 * Ensures cache, backup, and report directories are not committed.
 */

import fs from 'fs/promises';
import path from 'path';

/** Paths that should be in .gitignore (relative to workspace root) */
export const I18NSMITH_GITIGNORE_ENTRIES = [
  '# i18nsmith artifacts',
  '.i18nsmith/',
  '.i18nsmith-backup/',
];

/**
 * Ensures i18nsmith artifacts are listed in the project's .gitignore.
 * Creates .gitignore if it doesn't exist.
 * Only adds entries that are missing.
 * 
 * @param workspaceRoot - The root directory of the workspace
 * @returns Object with status info about what was added
 */
export async function ensureGitignore(workspaceRoot: string): Promise<{
  updated: boolean;
  added: string[];
  gitignorePath: string;
}> {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  const result = {
    updated: false,
    added: [] as string[],
    gitignorePath,
  };

  // Check if we're in a git repo (has .git folder)
  try {
    await fs.access(path.join(workspaceRoot, '.git'));
  } catch {
    // Not a git repo, skip
    return result;
  }

  let existingContent = '';
  try {
    existingContent = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // File doesn't exist, we'll create it
  }

  const linesToAdd: string[] = [];
  
  for (const entry of I18NSMITH_GITIGNORE_ENTRIES) {
    // Skip comment lines when checking for existence
    if (entry.startsWith('#')) {
      continue;
    }
    
    // Check if entry already exists (with or without trailing slash)
    const entryWithoutSlash = entry.replace(/\/$/, '');
    const patterns = [entry, entryWithoutSlash, `/${entry}`, `/${entryWithoutSlash}`];
    const alreadyExists = patterns.some(p => 
      existingContent.split('\n').some(line => line.trim() === p)
    );
    
    if (!alreadyExists) {
      linesToAdd.push(entry);
    }
  }

  if (linesToAdd.length > 0) {
    // Add comment header if we're adding entries and comment isn't there
    const commentLine = I18NSMITH_GITIGNORE_ENTRIES[0];
    if (!existingContent.includes(commentLine)) {
      linesToAdd.unshift('', commentLine);
    }

    const newContent = existingContent.trimEnd() + '\n' + linesToAdd.join('\n') + '\n';
    await fs.writeFile(gitignorePath, newContent, 'utf8');
    
    result.updated = true;
    result.added = linesToAdd.filter(l => !l.startsWith('#') && l.trim() !== '');
  }

  return result;
}

/**
 * Check if gitignore needs updating (dry run).
 * @returns List of entries that would be added
 */
export async function checkGitignore(workspaceRoot: string): Promise<string[]> {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');
  
  // Check if we're in a git repo
  try {
    await fs.access(path.join(workspaceRoot, '.git'));
  } catch {
    return [];
  }

  let existingContent = '';
  try {
    existingContent = await fs.readFile(gitignorePath, 'utf8');
  } catch {
    // File doesn't exist
  }

  const missing: string[] = [];
  
  for (const entry of I18NSMITH_GITIGNORE_ENTRIES) {
    if (entry.startsWith('#')) continue;
    
    const entryWithoutSlash = entry.replace(/\/$/, '');
    const patterns = [entry, entryWithoutSlash, `/${entry}`, `/${entryWithoutSlash}`];
    const alreadyExists = patterns.some(p => 
      existingContent.split('\n').some(line => line.trim() === p)
    );
    
    if (!alreadyExists) {
      missing.push(entry);
    }
  }

  return missing;
}
