import { DEFAULT_ADAPTER_MODULE } from './config/defaults.js';
import { EmptyValuePolicy, I18nConfig } from './config.js';
import { Syncer, SyncSummary } from './syncer.js';
import { diagnoseWorkspace, DiagnosisReport } from './diagnostics.js';
import { ActionableItem, ActionableSeverity } from './actionable.js';
import { Scanner, ScanCandidate, ScanSummary } from './scanner.js';

export interface CheckRunnerOptions {
  workspaceRoot?: string;
  syncer?: Syncer;
}

export interface CheckRunOptions {
  assumedKeys?: string[];
  validateInterpolations?: boolean;
  emptyValuePolicy?: EmptyValuePolicy;
  diff?: boolean;
  targets?: string[];
  invalidateCache?: boolean;
  /** Scan source files for hardcoded text candidates (default: true) */
  scanHardcoded?: boolean;
}

export interface CheckSuggestedCommand {
  label: string;
  command: string;
  reason: string;
  severity: ActionableSeverity;
  /** Category for grouping related commands */
  category?: 'extraction' | 'sync' | 'translation' | 'setup' | 'validation' | 'quality';
  /** Files this command is most relevant to */
  relevantFiles?: string[];
  /** Priority for sorting (lower = higher priority, default 50) */
  priority?: number;
}

export interface CheckSummary {
  diagnostics: DiagnosisReport;
  sync: SyncSummary;
  scan: ScanSummary;
  actionableItems: ActionableItem[];
  suggestedCommands: CheckSuggestedCommand[];
  hasConflicts: boolean;
  hasDrift: boolean;
  hasHardcodedText: boolean;
  timestamp: string;
}

const SEVERITY_ORDER: Record<ActionableSeverity, number> = {
  error: 0,
  warn: 1,
  info: 2,
};

export class CheckRunner {
  private readonly workspaceRoot: string;
  private readonly syncer: Syncer;

  constructor(private readonly config: I18nConfig, options: CheckRunnerOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.syncer = options.syncer ?? new Syncer(config, { workspaceRoot: this.workspaceRoot });
  }

  public async run(options: CheckRunOptions = {}): Promise<CheckSummary> {
    const diagnostics = await diagnoseWorkspace(this.config, { workspaceRoot: this.workspaceRoot });
    const sync = await this.syncer.run({
      write: false,
      validateInterpolations: options.validateInterpolations,
      emptyValuePolicy: options.emptyValuePolicy,
      assumedKeys: options.assumedKeys,
      diff: options.diff,
      targets: options.targets,
      invalidateCache: options.invalidateCache,
    });

    // Scan for hardcoded text candidates (unless explicitly disabled)
    const scanHardcoded = options.scanHardcoded ?? true;
    let scan: ScanSummary = {
      filesScanned: 0,
      filesExamined: [],
      candidates: [],
      buckets: {
        highConfidence: [],
        needsReview: [],
        skipped: [],
      },
    };
    if (scanHardcoded) {
      const scanner = new Scanner(this.config, { workspaceRoot: this.workspaceRoot });
      scan = options.targets?.length
        ? scanner.scan({ targets: options.targets })
        : scanner.scan();
    }

    // Build actionable items from all sources
    const hardcodedItems = scan.candidates.map((c) => candidateToActionable(c));
    const actionableItems = [
      ...diagnostics.actionableItems,
      ...sync.actionableItems,
      ...hardcodedItems,
    ].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const suggestedCommands = buildSuggestedCommands(
      diagnostics,
      sync,
      scan,
      this.config,
      this.workspaceRoot
    );
    const hasConflicts = diagnostics.conflicts.length > 0;
    const hasDrift =
      sync.missingKeys.length > 0 ||
      sync.unusedKeys.length > 0 ||
      sync.placeholderIssues.length > 0 ||
      sync.emptyValueViolations.length > 0;
    const hasHardcodedText = scan.candidates.length > 0;

    return {
      diagnostics,
      sync,
      scan,
      actionableItems,
      suggestedCommands,
      hasConflicts,
      hasDrift,
      hasHardcodedText,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Convert a scan candidate (hardcoded text) into an actionable item.
 */
function candidateToActionable(candidate: ScanCandidate): ActionableItem {
  const preview = candidate.text.length > 40
    ? `${candidate.text.slice(0, 37)}...`
    : candidate.text;
  return {
    kind: 'hardcoded-text',
    severity: 'warn',
    message: `Hardcoded text "${preview}" should be extracted to a translation key`,
    filePath: candidate.filePath,
    line: candidate.position.line,
    column: candidate.position.column,
    details: {
      text: candidate.text,
      context: candidate.context,
      candidateKind: candidate.kind,
    },
  };
}

function buildSuggestedCommands(
  report: DiagnosisReport,
  sync: SyncSummary,
  scan: ScanSummary,
  config: I18nConfig,
  _workspaceRoot: string
): CheckSuggestedCommand[] {
  const items: CheckSuggestedCommand[] = [];
  const diagKinds = new Set(report.actionableItems.map((item) => item.kind));

  // Check if user has a custom/working translation adapter
  // Note: If no translationAdapter is in the user's config, it defaults to 'react-i18next'
  // So we need to check if the user ACTUALLY configured a custom adapter vs just using defaults
  const adapterModule = config.translationAdapter?.module;
  const isDefaultAdapter = !adapterModule || adapterModule === DEFAULT_ADAPTER_MODULE;
  
  // User has explicitly configured a non-default adapter path
  const hasCustomAdapter = !isDefaultAdapter;
  
  // Adapter files exist that we detected
  // Runtime package is installed (react-i18next, i18next, etc.)
  const hasRuntimePackage = report.runtimePackages.length > 0;
  
  // User has a working setup if:
  // 1. They configured a custom adapter module (not default)
  // 2. Or they have a runtime package installed (which matches the default adapter)
  const hasWorkingSetup = hasCustomAdapter || hasRuntimePackage;

  const add = (entry: CheckSuggestedCommand) => {
    if (items.some((item) => item.command === entry.command)) {
      return;
    }
    items.push(entry);
  };

  // Helper: derive suggested command severity from actionable items in the sync summary
  const deriveSeverityForKinds = (kinds: string[], defaultSeverity: ActionableSeverity = 'warn'): ActionableSeverity => {
    // Find the highest-severity actionable item that matches any of the kinds
    const sevOrder: ActionableSeverity[] = ['error', 'warn', 'info'];
    for (const sev of sevOrder) {
      if (sync.actionableItems.some((it) => kinds.includes(it.kind) && it.severity === sev)) {
        return sev;
      }
    }
    return defaultSeverity;
  };

  // High priority: hardcoded text should be transformed
  if (scan.candidates.length > 0) {
    const relevantFiles = [...new Set(scan.candidates.map((c) => c.filePath))].slice(0, 5);
    add({
      label: 'Extract hardcoded text',
      command: 'i18nsmith transform',
      reason: `${scan.candidates.length} hardcoded string${scan.candidates.length === 1 ? '' : 's'} found that should be translated`,
      severity: 'warn',
      category: 'extraction',
      relevantFiles,
      priority: 10,
    });
  }

  // Only suggest sync actions if they will actually do something
  const hasMissingKeys = sync.missingKeys.length > 0;
  const hasUnusedKeys = sync.unusedKeys.length > 0;
  
  if (hasMissingKeys && hasUnusedKeys) {
    const missingKeyFiles = [...new Set(sync.missingKeys.flatMap((k) => k.references.map((r) => r.filePath)))].slice(0, 5);
    add({
      label: 'Apply locale fixes',
      command: 'i18nsmith sync --prune',
      reason: `${sync.missingKeys.length} missing key(s) to add, ${sync.unusedKeys.length} unused key(s) to remove`,
      severity: deriveSeverityForKinds(['missing-key', 'unused-key'], 'error'),
      category: 'sync',
      relevantFiles: missingKeyFiles,
      priority: 20,
    });
  } else if (hasMissingKeys) {
    const relevantFiles = [...new Set(sync.missingKeys.flatMap((k) => k.references.map((r) => r.filePath)))].slice(0, 5);
    add({
      label: 'Add missing keys',
      command: 'i18nsmith sync',
      reason: `${sync.missingKeys.length} key(s) used in code but missing from locale files`,
      severity: deriveSeverityForKinds(['missing-key'], 'error'),
      category: 'sync',
      relevantFiles,
      priority: 20,
    });
  } else if (hasUnusedKeys) {
    add({
      label: 'Prune unused keys',
      command: 'i18nsmith sync --prune',
      reason: `${sync.unusedKeys.length} key(s) in locale files but not used in code`,
      severity: deriveSeverityForKinds(['unused-key'], 'warn'),
      category: 'sync',
      priority: 30,
    });
  }

  if (sync.placeholderIssues.length) {
    add({
      label: 'Fix placeholder mismatches',
      command: 'i18nsmith sync --validate-interpolations',
      reason: `${sync.placeholderIssues.length} placeholder mismatch(es) detected across locales`,
      severity: deriveSeverityForKinds(['placeholder-mismatch'], 'error'),
      category: 'validation',
      priority: 25,
    });
  }

  if (sync.emptyValueViolations.length) {
    const emptyLocales = [...new Set(sync.emptyValueViolations.map((v) => v.locale))];
    const hasTranslationProvider = config.translation?.provider && config.translation.provider !== 'manual';
    
    if (hasTranslationProvider) {
      // User has a translation provider configured, suggest auto-translate
      add({
        label: 'Fill empty translations',
        command: 'i18nsmith translate',
        reason: `${sync.emptyValueViolations.length} empty translation value(s) in ${emptyLocales.join(', ')}`,
        severity: deriveSeverityForKinds(['empty-value'], 'warn'),
        category: 'translation',
        priority: 40,
      });
    } else {
      // No provider - suggest exporting to CSV for manual translation
      add({
        label: 'Export for translation',
        command: 'i18nsmith translate --export missing-translations.csv',
        reason: `${sync.emptyValueViolations.length} empty value(s) in ${emptyLocales.join(', ')} — export to CSV for manual translation`,
        severity: deriveSeverityForKinds(['empty-value'], 'warn'),
        category: 'translation',
        priority: 40,
      });
    }
  }

  if (diagKinds.has('diagnostics-missing-source-locale') || diagKinds.has('diagnostics-missing-target-locales')) {
    add({
      label: 'Create missing locale files',
      command: 'i18nsmith sync --seed-target-locales',
      reason: 'One or more locale files are missing from the locales directory',
      severity: 'error',
      category: 'setup',
      priority: 15,
    });
  }

  // Only suggest runtime/provider scaffolding if no working setup exists
  if (diagKinds.has('diagnostics-runtime-missing') && !hasWorkingSetup) {
    add({
      label: 'Install or scaffold runtime',
      command: 'i18nsmith scaffold-adapter --type react-i18next --install-deps',
      reason: 'No i18n runtime packages were detected',
      severity: 'warn',
      category: 'setup',
      priority: 50,
    });
  }

  if (diagKinds.has('diagnostics-provider-missing') && !hasWorkingSetup) {
    add({
      label: 'Generate provider shell',
      command: 'i18nsmith scaffold-adapter --type react-i18next',
      reason: 'No provider wrapping <I18nProvider> was detected',
      severity: 'info',
      category: 'setup',
      priority: 55,
    });
  }

  // Only suggest configuring adapter if adapter files exist but config doesn't reference them
  if (diagKinds.has('diagnostics-adapter-detected') && !hasCustomAdapter) {
    const adapterPath = report.adapterFiles[0]?.path;
    if (adapterPath) {
      add({
        label: 'Configure detected adapter',
        command: `i18nsmith config init-adapter "${adapterPath}"`,
        reason: `Existing adapter file "${adapterPath}" detected but not configured in i18n.config.json`,
        severity: 'info',
        category: 'setup',
        relevantFiles: [adapterPath],
        priority: 45,
      });
    }
  }

  if (sync.dynamicKeyWarnings.length) {
    const relevantFiles = [...new Set(sync.dynamicKeyWarnings.map((w) => w.filePath))].slice(0, 5);
    add({
      label: 'Whitelist dynamic keys',
      command: 'i18nsmith sync --assume key1,key2',
      reason: `${sync.dynamicKeyWarnings.length} dynamic translation key(s) detected that may need whitelisting`,
      severity: 'info',
      category: 'validation',
      relevantFiles,
      priority: 60,
    });
  }

  if (sync.suspiciousKeys.length) {
    const relevantFiles = [...new Set(sync.suspiciousKeys.map((w) => w.filePath))].slice(0, 5);
    add({
      label: 'Rename suspicious keys',
      command: 'i18nsmith sync --auto-rename-suspicious --write',
      reason: `${sync.suspiciousKeys.length} key${sync.suspiciousKeys.length === 1 ? '' : 's'} flagged as raw text`,
      severity: 'info',
      category: 'quality',
      relevantFiles,
      priority: 35,
    });
  }

  return items;
}
