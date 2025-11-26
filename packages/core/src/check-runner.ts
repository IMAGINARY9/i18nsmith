import { EmptyValuePolicy, I18nConfig } from './config.js';
import { Syncer, SyncSummary } from './syncer.js';
import { diagnoseWorkspace, DiagnosisReport } from './diagnostics.js';
import { ActionableItem, ActionableSeverity } from './actionable.js';

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
}

export interface CheckSuggestedCommand {
  label: string;
  command: string;
  reason: string;
  severity: ActionableSeverity;
}

export interface CheckSummary {
  diagnostics: DiagnosisReport;
  sync: SyncSummary;
  actionableItems: ActionableItem[];
  suggestedCommands: CheckSuggestedCommand[];
  hasConflicts: boolean;
  hasDrift: boolean;
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

    const actionableItems = [...diagnostics.actionableItems, ...sync.actionableItems].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    );

    const suggestedCommands = buildSuggestedCommands(diagnostics, sync);
    const hasConflicts = diagnostics.conflicts.length > 0;
    const hasDrift =
      sync.missingKeys.length > 0 ||
      sync.unusedKeys.length > 0 ||
      sync.placeholderIssues.length > 0 ||
      sync.emptyValueViolations.length > 0;

    return {
      diagnostics,
      sync,
      actionableItems,
      suggestedCommands,
      hasConflicts,
      hasDrift,
      timestamp: new Date().toISOString(),
    };
  }
}

function buildSuggestedCommands(report: DiagnosisReport, sync: SyncSummary): CheckSuggestedCommand[] {
  const items: CheckSuggestedCommand[] = [];
  const diagKinds = new Set(report.actionableItems.map((item) => item.kind));

  const add = (entry: CheckSuggestedCommand) => {
    if (items.some((item) => item.command === entry.command)) {
      return;
    }
    items.push(entry);
  };

  const syncNeedsWrite = sync.missingKeys.length > 0 || sync.unusedKeys.length > 0;
  if (syncNeedsWrite) {
    add({
      label: 'Apply locale fixes',
      command: 'i18nsmith sync --write',
      reason: 'Missing or unused locale keys detected',
      severity: 'error',
    });
  }

  if (sync.placeholderIssues.length) {
    add({
      label: 'Fix placeholder mismatches',
      command: 'i18nsmith sync --write --validate-interpolations',
      reason: 'Placeholder mismatches detected across locales',
      severity: 'error',
    });
  }

  if (sync.emptyValueViolations.length) {
    add({
      label: 'Resolve empty translations',
      command: 'i18nsmith sync --write --no-empty-values',
      reason: 'Empty locale values found that violate policy',
      severity: 'warn',
    });
  }

  if (diagKinds.has('diagnostics-missing-source-locale') || diagKinds.has('diagnostics-missing-target-locales')) {
    add({
      label: 'Seed missing locale files',
      command: 'i18nsmith sync --write',
      reason: 'Missing locale files were detected in diagnostics',
      severity: 'error',
    });
  }

  if (diagKinds.has('diagnostics-runtime-missing')) {
    add({
      label: 'Install or scaffold runtime',
      command: 'i18nsmith scaffold-adapter --type react-i18next --install-deps',
      reason: 'No i18n runtime packages were detected',
      severity: 'warn',
    });
  }

  if (diagKinds.has('diagnostics-provider-missing')) {
    add({
      label: 'Generate provider shell',
      command: 'i18nsmith scaffold-adapter --type react-i18next',
      reason: 'No provider wrapping <I18nProvider> was detected',
      severity: 'info',
    });
  }

  if (diagKinds.has('diagnostics-adapter-detected')) {
    add({
      label: 'Merge existing runtime',
      command: 'i18nsmith init --merge',
      reason: 'Existing adapter/runtime files were found',
      severity: 'info',
    });
  }

  if (sync.dynamicKeyWarnings.length) {
    add({
      label: 'Whitelist runtime-only keys',
      command: 'i18nsmith sync --assume key1,key2',
      reason: 'Dynamic translation keys were detected in code',
      severity: 'warn',
    });
  }

  return items;
}
