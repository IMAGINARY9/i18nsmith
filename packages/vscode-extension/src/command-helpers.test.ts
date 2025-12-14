import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  buildExportMissingTranslationsCommand,
  buildSyncApplyCommand,
  normalizeTargetForCli,
} from './command-helpers';

describe('command-helpers', () => {
  it('buildSyncApplyCommand always enables prune with quoted relative paths', () => {
    const workspace = path.join('/tmp', 'workspace');
    const previewPath = path.join(workspace, '.i18nsmith', 'previews', 'sync-preview.json');
    const selectionPath = path.join(workspace, '.i18nsmith', 'previews', 'selection.json');

    const command = buildSyncApplyCommand(previewPath, selectionPath, workspace);

    expect(command).toContain('--apply-preview');
    expect(command).toContain('--selection-file');
  expect(command.includes('--prune')).toBe(true);
  expect(command.trim().endsWith('--yes')).toBe(true);
    expect(command).toContain('.i18nsmith/previews/sync-preview.json');
    expect(command).toContain('.i18nsmith/previews/selection.json');
  });

  it('normalizeTargetForCli returns absolute path for files outside workspace', () => {
    const workspace = '/repo/workspace';
    const outside = '/other/project/file.json';
    expect(normalizeTargetForCli(outside, workspace)).toBe(outside);
  });

  it('normalizeTargetForCli uses posix separators for relative paths', () => {
    const workspace = path.join('/tmp', 'workspace');
    const target = path.join(workspace, 'nested', 'file.json');
    expect(normalizeTargetForCli(target, workspace)).toBe('nested/file.json');
  });

  it('buildExportMissingTranslationsCommand quotes relative paths', () => {
    const workspace = path.join('/tmp', 'workspace');
    const csvPath = path.join(workspace, '.i18nsmith', 'missing translations.csv');
    const command = buildExportMissingTranslationsCommand(csvPath, workspace);
    expect(command).toContain('i18nsmith translate --export');
    expect(command).toContain('".i18nsmith/missing translations.csv"');
  });

  it('buildExportMissingTranslationsCommand leaves absolute path outside workspace', () => {
    const workspace = path.join('/tmp', 'workspace');
    const csvPath = path.join('/var', 'tmp', 'missing.csv');
    const command = buildExportMissingTranslationsCommand(csvPath, workspace);
    expect(command).toContain(`"${csvPath}"`);
  });
});
