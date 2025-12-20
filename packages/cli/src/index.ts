#!/usr/bin/env node
import { Command } from 'commander';
import { registerInit } from './commands/init.js';
import { registerScaffoldAdapter } from './commands/scaffold-adapter.js';
import { registerTranslate } from './commands/translate.js';
import { registerPreflight } from './commands/preflight.js';
import { registerDebugPatterns } from './commands/debug-patterns.js';
import { registerDiagnose } from './commands/diagnose.js';
import { registerAudit } from './commands/audit.js';
import { registerCheck } from './commands/check.js';
import { registerScan } from './commands/scan.js';
import { registerTransform } from './commands/transform.js';
import { registerSync } from './commands/sync.js';
import { registerBackup } from './commands/backup.js';
import { registerRename } from './commands/rename.js';
import { registerInstallHooks } from './commands/install-hooks.js';
import { registerConfig } from './commands/config.js';
import { registerReview } from './commands/review.js';

export const program = new Command();

program
  .name('i18nsmith')
  .description('Universal Automated i18n Library')
  .version('0.3.2');

registerInit(program);
registerScaffoldAdapter(program);
registerTranslate(program);
registerPreflight(program);
registerDebugPatterns(program);
registerDiagnose(program);
registerAudit(program);
registerCheck(program);
registerScan(program);
registerTransform(program);
registerSync(program);
registerBackup(program);
registerRename(program);
registerInstallHooks(program);
registerConfig(program);
registerReview(program);


program.parse();
