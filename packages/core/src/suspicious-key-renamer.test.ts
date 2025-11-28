import { describe, expect, it } from 'vitest';
import {
  generateRenameProposals,
  createRenameMappingFile,
  parseRenameMappingFile,
} from './suspicious-key-renamer.js';
import { SuspiciousKeyWarning } from './syncer.js';

describe('generateRenameProposals', () => {
  it('generates proposals for suspicious keys', () => {
    const suspiciousKeys: SuspiciousKeyWarning[] = [
      {
        key: 'When to Use Categorized View',
        filePath: 'src/app.tsx',
        position: { line: 10, column: 5 },
        reason: 'contains-spaces',
      },
      {
        key: 'Found',
        filePath: 'src/search.tsx',
        position: { line: 20, column: 10 },
        reason: 'single-word-no-namespace',
      },
    ];

    const report = generateRenameProposals(suspiciousKeys);

    expect(report.totalSuspicious).toBe(2);
    expect(report.safeProposals).toHaveLength(2);
    expect(report.conflictProposals).toHaveLength(0);
    expect(report.renameMapping).toEqual({
      'When to Use Categorized View': 'common.when-to-use-categorized',
      'Found': 'common.found',
    });
  });

  it('detects conflicts with existing keys', () => {
    const suspiciousKeys: SuspiciousKeyWarning[] = [
      {
        key: 'Submit Button',
        filePath: 'src/form.tsx',
        position: { line: 10, column: 5 },
        reason: 'contains-spaces',
      },
    ];

    const existingKeys = new Set(['common.submit-button']);

    const report = generateRenameProposals(suspiciousKeys, { existingKeys });

    expect(report.safeProposals).toHaveLength(0);
    expect(report.conflictProposals).toHaveLength(1);
    expect(report.conflictProposals[0].hasConflict).toBe(true);
    expect(report.conflictProposals[0].conflictsWith).toBe('common.submit-button');
  });

  it('detects conflicts between proposals with same normalized output', () => {
    const suspiciousKeys: SuspiciousKeyWarning[] = [
      {
        key: 'Submit Button',
        filePath: 'src/form.tsx',
        position: { line: 10, column: 5 },
        reason: 'contains-spaces',
      },
      {
        // This will also normalize to 'common.submit-button'
        key: 'submit button',
        filePath: 'src/other.tsx',
        position: { line: 20, column: 5 },
        reason: 'contains-spaces',
      },
    ];

    const report = generateRenameProposals(suspiciousKeys);

    expect(report.safeProposals).toHaveLength(1);
    expect(report.conflictProposals).toHaveLength(1);
    expect(report.conflictProposals[0].originalKey).toBe('submit button');
    expect(report.conflictProposals[0].hasConflict).toBe(true);
  });

  it('skips duplicate original keys', () => {
    const suspiciousKeys: SuspiciousKeyWarning[] = [
      {
        key: 'Hello World',
        filePath: 'src/a.tsx',
        position: { line: 1, column: 1 },
        reason: 'contains-spaces',
      },
      {
        key: 'Hello World',
        filePath: 'src/b.tsx',
        position: { line: 5, column: 1 },
        reason: 'contains-spaces',
      },
    ];

    const report = generateRenameProposals(suspiciousKeys);

    expect(report.totalSuspicious).toBe(1);
    expect(report.safeProposals).toHaveLength(1);
  });

  it('applies naming convention option', () => {
    const suspiciousKeys: SuspiciousKeyWarning[] = [
      {
        key: 'Submit Button',
        filePath: 'src/form.tsx',
        position: { line: 10, column: 5 },
        reason: 'contains-spaces',
      },
    ];

    const report = generateRenameProposals(suspiciousKeys, {
      namingConvention: 'camelCase',
    });

    expect(report.renameMapping['Submit Button']).toBe('common.submitButton');
  });

  it('filters by reason', () => {
    const suspiciousKeys: SuspiciousKeyWarning[] = [
      {
        key: 'Submit Button',
        filePath: 'src/form.tsx',
        position: { line: 10, column: 5 },
        reason: 'contains-spaces',
      },
      {
        key: 'Found',
        filePath: 'src/search.tsx',
        position: { line: 20, column: 10 },
        reason: 'single-word-no-namespace',
      },
    ];

    const report = generateRenameProposals(suspiciousKeys, {
      filterReasons: ['contains-spaces'],
    });

    expect(report.safeProposals).toHaveLength(1);
    expect(report.safeProposals[0].originalKey).toBe('Submit Button');
  });
});

describe('createRenameMappingFile', () => {
  it('creates JSON format by default', () => {
    const mapping = {
      'Hello World': 'common.hello-world',
      'Submit': 'common.submit',
    };

    const content = createRenameMappingFile(mapping);
    const parsed = JSON.parse(content);

    expect(parsed).toEqual(mapping);
  });

  it('creates commented format with includeComments', () => {
    const mapping = {
      'Hello World': 'common.hello-world',
    };

    const content = createRenameMappingFile(mapping, { includeComments: true });

    expect(content).toContain('# i18nsmith auto-rename mapping');
    expect(content).toContain('"Hello World" = "common.hello-world"');
  });
});

describe('parseRenameMappingFile', () => {
  it('parses JSON format', () => {
    const content = JSON.stringify({
      'Hello World': 'common.hello-world',
      'Submit': 'common.submit',
    });

    const mapping = parseRenameMappingFile(content);

    expect(mapping['Hello World']).toBe('common.hello-world');
    expect(mapping['Submit']).toBe('common.submit');
  });

  it('parses TOML-like format', () => {
    const content = `
# This is a comment
"Hello World" = "common.hello-world"
"Submit Button" = "common.submit-button"
`;

    const mapping = parseRenameMappingFile(content);

    expect(mapping['Hello World']).toBe('common.hello-world');
    expect(mapping['Submit Button']).toBe('common.submit-button');
  });

  it('ignores empty lines and comments', () => {
    const content = `
# Comment line
"key1" = "value1"

# Another comment
"key2" = "value2"
`;

    const mapping = parseRenameMappingFile(content);

    expect(Object.keys(mapping)).toHaveLength(2);
  });
});
