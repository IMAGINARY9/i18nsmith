import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { listBackups, restoreBackup } from '@i18nsmith/core';

/**
 * Registers backup-related commands (backup-list, backup-restore)
 */
export function registerBackup(program: Command): void {
  program
    .command('backup-list')
    .description('List available locale file backups')
    .option('--backup-dir <path>', 'Custom backup directory (default: .i18nsmith-backup)')
    .action(async (options: { backupDir?: string }) => {
      try {
        const workspaceRoot = process.cwd();
        const backups = await listBackups(workspaceRoot, { backupDir: options.backupDir });

        if (backups.length === 0) {
          console.log(chalk.yellow('No backups found.'));
          console.log(chalk.gray('Backups are created automatically when using --write --prune'));
          return;
        }

        console.log(chalk.blue(`Found ${backups.length} backup(s):\n`));

        for (const backup of backups) {
          const date = new Date(backup.createdAt);
          const formattedDate = date.toLocaleString();
          console.log(`  ${chalk.cyan(backup.timestamp)}  ${formattedDate}  (${backup.fileCount} files)`);
        }

        console.log(chalk.gray(`\nRestore a backup with: i18nsmith backup-restore <timestamp>`));
      } catch (err) {
        console.error(chalk.red('Error listing backups:'), err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });

  program
    .command('backup-restore')
    .description('Restore locale files from a previous backup')
    .argument('<timestamp>', 'Backup timestamp (from backup-list) or "latest" for most recent')
    .option('--backup-dir <path>', 'Custom backup directory (default: .i18nsmith-backup)')
    .action(async (timestamp: string, options: { backupDir?: string }) => {
      try {
        const workspaceRoot = process.cwd();
        const backups = await listBackups(workspaceRoot, { backupDir: options.backupDir });

        if (backups.length === 0) {
          console.error(chalk.red('No backups found.'));
          process.exitCode = 1;
          return;
        }

        let targetBackup = timestamp === 'latest'
          ? backups[0]
          : backups.find((b) => b.timestamp === timestamp);

        if (!targetBackup) {
          console.error(chalk.red(`Backup not found: ${timestamp}`));
          console.log(chalk.gray('Available backups:'));
          for (const b of backups.slice(0, 5)) {
            console.log(`  ${b.timestamp}`);
          }
          process.exitCode = 1;
          return;
        }

        // Confirm restore
        const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
          {
            type: 'confirm',
            name: 'confirmed',
            message: `Restore ${targetBackup.fileCount} locale files from backup ${targetBackup.timestamp}? This will overwrite current locale files.`,
            default: false,
          },
        ]);

        if (!confirmed) {
          console.log(chalk.yellow('Restore cancelled.'));
          return;
        }

        const result = await restoreBackup(targetBackup.path, workspaceRoot);

        console.log(chalk.green(`\n✅ ${result.summary}`));
        for (const file of result.restored) {
          console.log(chalk.gray(`   Restored: ${file}`));
        }
      } catch (err) {
        console.error(chalk.red('Error restoring backup:'), err instanceof Error ? err.message : err);
        process.exitCode = 1;
      }
    });
}
