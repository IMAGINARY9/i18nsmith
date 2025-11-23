#!/usr/bin/env node
import { Command } from 'commander';
import { registerInitCommand } from './commands/init';

const program = new Command();

program
  .name('i18nsmith')
  .description('Universal Automated i18n Library')
  .version('0.1.0');

registerInitCommand(program);

program
  .command('scan')
  .description('Scan project for strings to translate')
  .action(async () => {
    console.log('Starting scan...');
    // TODO: Load config
    // const scanner = new Scanner(config);
    // await scanner.scan();
  });

program.parse();
