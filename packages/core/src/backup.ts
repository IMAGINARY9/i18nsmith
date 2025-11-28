/**
 * Backup utility for locale files.
 * Creates timestamped backups before destructive operations to enable recovery.
 */

import fs from 'fs/promises';
import path from 'path';

export interface BackupOptions {
  /** Directory where backups are stored. Defaults to .i18nsmith-backup */
  backupDir?: string;
  /** Maximum number of backup sets to retain. Defaults to 5 */
  maxBackups?: number;
}

export interface BackupResult {
  /** Timestamp of this backup */
  timestamp: string;
  /** Full path to the backup directory for this run */
  backupPath: string;
  /** List of files that were backed up */
  files: string[];
  /** Human-readable summary */
  summary: string;
}

interface BackupManifest {
  version: number;
  timestamp: string;
  createdAt: string;
  files: Array<{
    originalPath: string;
    backupPath: string;
    size: number;
  }>;
  command?: string;
}

const DEFAULT_BACKUP_DIR = '.i18nsmith-backup';
const DEFAULT_MAX_BACKUPS = 5;
const MANIFEST_VERSION = 1;

/**
 * Creates a backup of all locale files in the specified directory.
 * Each backup is stored in a timestamped subdirectory.
 */
export async function createBackup(
  localesDir: string,
  workspaceRoot: string,
  options: BackupOptions = {},
  command?: string
): Promise<BackupResult | null> {
  const backupBaseDir = path.resolve(workspaceRoot, options.backupDir ?? DEFAULT_BACKUP_DIR);
  const maxBackups = options.maxBackups ?? DEFAULT_MAX_BACKUPS;

  // Check if locales directory exists
  try {
    await fs.access(localesDir);
  } catch {
    // No locales to back up
    return null;
  }

  // Find all JSON locale files
  const files = await fs.readdir(localesDir);
  const localeFiles = files.filter((f) => f.endsWith('.json'));

  if (localeFiles.length === 0) {
    return null;
  }

  // Create timestamp for this backup
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const backupPath = path.join(backupBaseDir, timestamp);

  // Ensure backup directory exists
  await fs.mkdir(backupPath, { recursive: true });

  // Copy each locale file
  const manifest: BackupManifest = {
    version: MANIFEST_VERSION,
    timestamp,
    createdAt: now.toISOString(),
    files: [],
    command,
  };

  for (const file of localeFiles) {
    const sourcePath = path.join(localesDir, file);
    const destPath = path.join(backupPath, file);

    const content = await fs.readFile(sourcePath);
    await fs.writeFile(destPath, content);

    const stats = await fs.stat(sourcePath);
    manifest.files.push({
      originalPath: path.relative(workspaceRoot, sourcePath),
      backupPath: path.relative(workspaceRoot, destPath),
      size: stats.size,
    });
  }

  // Write manifest
  await fs.writeFile(
    path.join(backupPath, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // Prune old backups
  await pruneOldBackups(backupBaseDir, maxBackups);

  return {
    timestamp,
    backupPath,
    files: localeFiles,
    summary: `Backed up ${localeFiles.length} locale file(s) to ${path.relative(workspaceRoot, backupPath)}`,
  };
}

/**
 * Lists all available backups in the backup directory.
 */
export async function listBackups(
  workspaceRoot: string,
  options: BackupOptions = {}
): Promise<Array<{ timestamp: string; path: string; fileCount: number; createdAt: string }>> {
  const backupBaseDir = path.resolve(workspaceRoot, options.backupDir ?? DEFAULT_BACKUP_DIR);

  try {
    await fs.access(backupBaseDir);
  } catch {
    return [];
  }

  const entries = await fs.readdir(backupBaseDir, { withFileTypes: true });
  const backups: Array<{ timestamp: string; path: string; fileCount: number; createdAt: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = path.join(backupBaseDir, entry.name, 'manifest.json');
    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf8');
      const manifest: BackupManifest = JSON.parse(manifestContent);
      backups.push({
        timestamp: manifest.timestamp,
        path: path.join(backupBaseDir, entry.name),
        fileCount: manifest.files.length,
        createdAt: manifest.createdAt,
      });
    } catch {
      // Skip directories without valid manifests
    }
  }

  // Sort by timestamp (newest first)
  return backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/**
 * Restores locale files from a specific backup.
 */
export async function restoreBackup(
  backupPath: string,
  workspaceRoot: string
): Promise<{ restored: string[]; summary: string }> {
  const manifestPath = path.join(backupPath, 'manifest.json');

  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest: BackupManifest = JSON.parse(manifestContent);

  const restored: string[] = [];

  for (const file of manifest.files) {
    const sourcePath = path.join(backupPath, path.basename(file.backupPath));
    const destPath = path.resolve(workspaceRoot, file.originalPath);

    // Ensure destination directory exists
    await fs.mkdir(path.dirname(destPath), { recursive: true });

    const content = await fs.readFile(sourcePath);
    await fs.writeFile(destPath, content);
    restored.push(file.originalPath);
  }

  return {
    restored,
    summary: `Restored ${restored.length} locale file(s) from backup ${manifest.timestamp}`,
  };
}

/**
 * Removes old backups, keeping only the most recent N backups.
 */
async function pruneOldBackups(backupBaseDir: string, maxBackups: number): Promise<void> {
  const entries = await fs.readdir(backupBaseDir, { withFileTypes: true });
  const backupDirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .reverse(); // Newest first

  // Delete old backups beyond the limit
  for (const dir of backupDirs.slice(maxBackups)) {
    const dirPath = path.join(backupBaseDir, dir);
    await fs.rm(dirPath, { recursive: true, force: true });
  }
}

/**
 * Formats a date as YYYYMMDD-HHmmss for backup directory names.
 */
function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}
