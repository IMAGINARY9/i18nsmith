/**
 * Suspicious Key Renamer Module
 *
 * Provides utilities for automatically proposing and applying normalized
 * key names for suspicious translation keys detected during sync.
 */

import { KeyNormalizationOptions, normalizeToKey, SuspiciousKeyReason } from './key-validator.js';
import { SuspiciousKeyWarning } from './syncer.js';
import { KeyGenerator } from './key-generator.js';

export interface SuspiciousKeyRenameProposal {
  /** Original suspicious key */
  originalKey: string;
  /** Proposed normalized key */
  proposedKey: string;
  /** Reason why the key was flagged as suspicious */
  reason: SuspiciousKeyReason | string;
  /** Source file path where the key was found */
  filePath: string;
  /** Position in the source file */
  position: { line: number; column: number };
  /** Whether this proposal has a conflict (proposed key already exists) */
  hasConflict?: boolean;
  /** Existing key that conflicts with the proposal */
  conflictsWith?: string;
}

export interface SuspiciousKeyRenameReport {
  /** Total suspicious keys found */
  totalSuspicious: number;
  /** Proposals that can be safely applied */
  safeProposals: SuspiciousKeyRenameProposal[];
  /** Proposals with conflicts (proposed key already exists) */
  conflictProposals: SuspiciousKeyRenameProposal[];
  /** Keys that couldn't be normalized (edge cases) */
  skippedKeys: string[];
  /** Mapping from original to proposed keys (for --map file) */
  renameMapping: Record<string, string>;
}

export interface AutoRenameOptions extends KeyNormalizationOptions {
  /** Existing keys to check for conflicts */
  existingKeys?: Set<string>;
  /** Filter to specific reasons */
  filterReasons?: SuspiciousKeyReason[];
  /** Workspace root for key generation context */
  workspaceRoot?: string;
  /** Allow proposals that conflict with existing keys */
  allowExistingConflicts?: boolean;
}

/**
 * Process suspicious key warnings and generate rename proposals.
 */
export function generateRenameProposals(
  suspiciousKeys: SuspiciousKeyWarning[],
  options: AutoRenameOptions = {}
): SuspiciousKeyRenameReport {
  const existingKeys = options.existingKeys ?? new Set<string>();
  const filterReasons = options.filterReasons
    ? new Set(options.filterReasons)
    : undefined;

  const seenOriginals = new Set<string>();
  const proposedKeySet = new Set<string>();
  const safeProposals: SuspiciousKeyRenameProposal[] = [];
  const conflictProposals: SuspiciousKeyRenameProposal[] = [];
  const skippedKeys: string[] = [];
  const renameMapping: Record<string, string> = {};

  const keyGenerator = new KeyGenerator({
    namespace: options.defaultNamespace,
    workspaceRoot: options.workspaceRoot,
  });

  for (const warning of suspiciousKeys) {
    // Skip if we've already processed this key
    if (seenOriginals.has(warning.key)) {
      continue;
    }
    seenOriginals.add(warning.key);

    // Filter by reason if specified
    if (filterReasons && !filterReasons.has(warning.reason as SuspiciousKeyReason)) {
      continue;
    }

    // Generate proposed key using KeyGenerator for consistent hashing
    let proposedKey: string;
    try {
      // Check if filePath is a locale file (which shouldn't be used for key generation)
      const isLocaleFile = warning.filePath.includes('/locales/') || 
                           warning.filePath.includes('\\locales\\') ||
                           /\.(json|yaml|yml)$/.test(warning.filePath);
      
      if (isLocaleFile) {
        // For locale file entries without source references, use simple normalization
        // to preserve the original key structure rather than generating a new namespace
        proposedKey = normalizeToKey(warning.key, {
          defaultNamespace: options.defaultNamespace,
          namingConvention: options.namingConvention,
          maxWords: options.maxWords,
        });
      } else {
        const generated = keyGenerator.generate(warning.key, {
          filePath: warning.filePath,
          kind: 'call-expression', // Assume call expression for suspicious keys
        });
        proposedKey = generated.key;
      }
    } catch (e) {
      // Fallback to simple normalization if generator fails
      proposedKey = normalizeToKey(warning.key, {
        defaultNamespace: options.defaultNamespace,
        namingConvention: options.namingConvention,
        maxWords: options.maxWords,
      });
    }

    // Skip if the normalized key is the same as original
    if (proposedKey === warning.key) {
      skippedKeys.push(warning.key);
      continue;
    }

    const proposal: SuspiciousKeyRenameProposal = {
      originalKey: warning.key,
      proposedKey,
      reason: warning.reason,
      filePath: warning.filePath,
      position: warning.position,
    };

    // Check for conflicts
    const hasExistingConflict = existingKeys.has(proposedKey);
    const hasSelfConflict = proposedKeySet.has(proposedKey);

    if (hasExistingConflict || hasSelfConflict) {
      if (hasExistingConflict && options.allowExistingConflicts) {
        // Allow existing conflicts - treat as safe
        safeProposals.push(proposal);
        proposedKeySet.add(proposedKey);
        renameMapping[warning.key] = proposedKey;
      } else {
        proposal.hasConflict = true;
        proposal.conflictsWith = hasExistingConflict
          ? proposedKey
          : `(duplicate proposal from "${[...seenOriginals].find((k) => renameMapping[k] === proposedKey)}")`;
        conflictProposals.push(proposal);
      }
    } else {
      safeProposals.push(proposal);
      proposedKeySet.add(proposedKey);
      renameMapping[warning.key] = proposedKey;
    }
  }

  return {
    totalSuspicious: seenOriginals.size,
    safeProposals,
    conflictProposals,
    skippedKeys,
    renameMapping,
  };
}

/**
 * Create a mapping file content for the `rename-keys --map` command.
 */
export function createRenameMappingFile(
  mapping: Record<string, string>,
  options: { includeComments?: boolean } = {}
): string {
  if (options.includeComments) {
    const lines: string[] = [
      '# i18nsmith auto-rename mapping',
      '# Generated from suspicious keys detected during sync',
      '#',
      '# Format: "originalKey" = "proposedKey"',
      '# Review and edit as needed before applying with:',
      '#   npx i18nsmith rename-keys --map <this-file> --write',
      '',
    ];

    for (const [original, proposed] of Object.entries(mapping)) {
      lines.push(`"${original}" = "${proposed}"`);
    }

    return lines.join('\n') + '\n';
  }

  // JSON format for programmatic use
  return JSON.stringify(mapping, null, 2) + '\n';
}

/**
 * Parse a rename mapping file (supports both TOML-like and JSON formats).
 */
export function parseRenameMappingFile(content: string): Record<string, string> {
  const trimmed = content.trim();

  // Try JSON first
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed);
  }

  // TOML-like format: "original" = "proposed"
  const mapping: Record<string, string> = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip comments and empty lines
    if (trimmedLine.startsWith('#') || trimmedLine.length === 0) {
      continue;
    }

    // Parse "key" = "value" format
    const match = trimmedLine.match(/^"([^"]+)"\s*=\s*"([^"]+)"$/);
    if (match) {
      mapping[match[1]] = match[2];
    }
  }

  return mapping;
}
