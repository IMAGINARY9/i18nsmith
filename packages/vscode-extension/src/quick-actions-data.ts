import * as path from 'path';
import type { SuspiciousKeyWarning } from '@i18nsmith/core';
import type { CheckReport } from './diagnostics';
import { summarizeReportIssues } from './report-utils';
import { parsePreviewableCommand, type PreviewableCommand } from './preview-intents';

export interface QuickActionDefinition {
  id: string;
  iconId: string;
  iconLabel?: string;
  title: string;
  description: string;
  detail?: string;
  command?: string;
  previewIntent?: PreviewableCommand;
  interactive?: boolean;
  confirmMessage?: string;
  longRunning?: boolean;
  postRunBehavior?: 'offer-output';
  children?: QuickActionChildDefinition[];
}

export interface QuickActionSection {
  title: string;
  actions: QuickActionDefinition[];
}

export interface QuickActionBuildRequest {
  report: CheckReport | null;
  hasSelection: boolean;
}

export interface QuickActionMetadata {
  issueCount: number;
  suggestionsCount: number;
  driftStats: { missing: number; unused: number } | null;
  runtimeReady: boolean;
  suspiciousWarnings: SuspiciousKeyWarning[];
}

export interface QuickActionBuildOutput {
  sections: QuickActionSection[];
  metadata: QuickActionMetadata;
}

export interface QuickActionChildDefinition {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  iconId?: string;
  command?: string;
  commandArgs?: unknown[];
}

type SuggestionCategory =
  | 'extraction'
  | 'sync'
  | 'translation'
  | 'setup'
  | 'validation'
  | 'quality';

type SuggestedCommandEntry = NonNullable<CheckReport['suggestedCommands']>[number];

const ICONS = {
  warning: { id: 'warning', label: 'Warning' },
  diff: { id: 'diff', label: 'Diff preview' },
  sync: { id: 'sync', label: 'Locale sync' },
  renameAll: { id: 'edit', label: 'Rename Suspicious Keys' },
  dynamic: { id: 'shield', label: 'Dynamic keys' },
  transform: { id: 'beaker', label: 'File transform' },
  analyze: { id: 'search', label: 'Analyze usage' },
  refreshFile: { id: 'repo-pull', label: 'Refresh diagnostics' },
  extractSelection: { id: 'pencil', label: 'Extract selection' },
  workspaceSync: { id: 'repo-sync', label: 'Workspace sync' },
  export: { id: 'cloud-upload', label: 'Export translations' },
  openLocale: { id: 'book', label: 'Open locale' },
  scaffold: { id: 'tools', label: 'Setup' },
  health: { id: 'pulse', label: 'Health check' },
  terminal: { id: 'terminal', label: 'Output channel' },
  suspiciousChild: { id: 'symbol-key', label: 'Suspicious key' },
};

const MAX_SUSPICIOUS_CHILDREN = 25;

export function buildQuickActionModel(request: QuickActionBuildRequest): QuickActionBuildOutput {
  const report = request.report;
  const summary = summarizeReportIssues(report);
  const actionableItems = summary.items;
  const driftStats = getDriftStatistics(report);
  const suggestions = Array.isArray(report?.suggestedCommands) ? report!.suggestedCommands : [];

  const dynamicWarningCount = Array.isArray(report?.sync?.dynamicKeyWarnings)
    ? report!.sync!.dynamicKeyWarnings.length
    : 0;
  const suspiciousWarnings = Array.isArray(report?.sync?.suspiciousKeys)
    ? (report!.sync!.suspiciousKeys as SuspiciousKeyWarning[])
    : [];
  const suspiciousWarningCount = suspiciousWarnings.length;
  const hardcodedCount = actionableItems.filter((item) => item.kind === 'hardcoded-text').length;
  const runtimeMissing = actionableItems.some((item) => item.kind === 'diagnostics-runtime-missing');
  const runtimeReady = !runtimeMissing;

  const metadata: QuickActionMetadata = {
    issueCount: summary.issueCount,
    suggestionsCount: suggestions.length,
    driftStats,
    runtimeReady,
    suspiciousWarnings,
  };

  const sections: QuickActionSection[] = [];

  if (!runtimeReady) {
    sections.push({
      title: '⚙️ Setup Required',
      actions: [
        createQuickAction({
          id: 'initialize-runtime',
          icon: ICONS.scaffold,
          title: 'Initialize i18n Project',
          description: 'Install runtime packages and scaffold the provider shell.',
          detail: 'Runs the scaffold adapter command with recommended defaults.',
          command: 'i18nsmith scaffold-adapter --type react-i18next --install-deps',
        }),
        createQuickAction({
          id: 'open-output-channel',
          icon: ICONS.terminal,
          title: 'Show i18nsmith Output Channel',
          description: 'Review CLI output and diagnostics.',
          command: 'i18nsmith.showOutput',
          longRunning: false,
        }),
      ].filter(Boolean) as QuickActionDefinition[],
    });
  }

  const suggestionBuckets = groupSuggestionsByCategory(suggestions);

  const problems: QuickActionDefinition[] = [];
  const driftTotal = (driftStats?.missing ?? 0) + (driftStats?.unused ?? 0);

  if (summary.issueCount > 0 || dynamicWarningCount || suspiciousWarningCount || hardcodedCount) {
    const extractionSuggestion = suggestionBuckets.get('extraction')?.[0];
    const extraction = createQuickAction({
      id: 'batch-extract',
      icon: ICONS.diff,
      title:
        hardcodedCount > 0 ? `Batch Extract Hardcoded Strings (${hardcodedCount})` : 'Batch Extract Hardcoded Strings',
      description:
        hardcodedCount > 0
          ? `Extract ${hardcodedCount} hardcoded string${hardcodedCount === 1 ? '' : 's'} into locale files.`
          : 'Extract detected hardcoded strings into locale files.',
      detail: extractionSuggestion?.reason,
      command: extractionSuggestion?.command ?? (hardcodedCount ? 'i18nsmith transform' : undefined),
    });
    if (extraction) {
      problems.push(extraction);
    }

    if (driftTotal > 0) {
      const driftParts: string[] = [];
      if (driftStats?.missing) driftParts.push(`${driftStats.missing} missing`);
      if (driftStats?.unused) driftParts.push(`${driftStats.unused} unused`);
      const syncSuggestion = suggestionBuckets.get('sync')?.[0];
      const driftAction = createQuickAction({
        id: 'fix-locale-drift',
        icon: ICONS.sync,
        title: `Fix Locale Drift (${driftTotal})`,
        description: driftParts.length
          ? `${driftParts.join(', ')} — preview adds/removals before applying.`
          : 'Review detected drift, then selectively add or prune keys.',
        detail: syncSuggestion?.reason,
        command: syncSuggestion?.command ?? 'i18nsmith.sync',
        postRunBehavior: 'offer-output',
      });
      if (driftAction) {
        problems.push(driftAction);
      }
    }

    const validationSuggestion = suggestionBuckets.get('validation')?.[0];
      const rpt = report as unknown as { sync?: { placeholderIssues?: unknown[] } };
      const placeholderIssuesCount = Array.isArray(rpt.sync?.placeholderIssues)
        ? (rpt.sync!.placeholderIssues!.length as number)
        : 0;

      // Only show the Resolve Placeholder Issues quick action when the report actually
      // contains placeholder mismatches. Don't show it just because a validation-style
      // suggestion exists (e.g. dynamic key warnings) — avoid noisy or irrelevant actions.
      if (validationSuggestion && placeholderIssuesCount > 0) {
      const validationAction = createQuickAction({
        id: 'resolve-placeholders',
        icon: ICONS.warning,
        title: 'Resolve Placeholder Issues',
        description: 'Fix interpolation mismatches before they break translations.',
        detail: validationSuggestion.reason,
        // Do not execute the suggested raw CLI command here.
        // Use a dedicated intent so the extension can render a placeholder-specific preview.
        previewIntent: { kind: 'validate-placeholders', extraArgs: ['--validate-interpolations'] },
        // Provide a no-op command so the action is still renderable via the existing factory.
        command: 'i18nsmith sync --validate-interpolations',
      });
      if (validationAction) {
        problems.push(validationAction);
      }
    }

    if (suspiciousWarningCount) {
      problems.push(
        createQuickAction({
          id: 'rename-suspicious',
          icon: ICONS.renameAll,
          title: `Rename All Suspicious Keys (${suspiciousWarningCount})`,
          description: 'Normalize flagged keys and update code references with preview.',
          command: 'i18nsmith.renameAllSuspiciousKeys',
          postRunBehavior: 'offer-output',
          children: buildSuspiciousKeyChildren(suspiciousWarnings),
        })!
      );
    }

    if (dynamicWarningCount) {
      problems.push(
        createQuickAction({
          id: 'whitelist-dynamic',
          icon: ICONS.dynamic,
          title: `Resolve Dynamic Keys (${dynamicWarningCount})`,
          description: 'Whitelist runtime expressions to silence false unused warnings.',
          command: 'i18nsmith.whitelistDynamicKeys',
        })!
      );
    }
  }

  if (problems.length) {
    sections.push({ title: '⚠️ Problems & Fixes', actions: problems });
  }

  const activeEditorSection = createActiveEditorSection(request);
  if (activeEditorSection) {
    sections.push(activeEditorSection);
  }

  const projectSection = createProjectHealthSection(report, suggestionBuckets);
  if (projectSection) {
    sections.push(projectSection);
  }

  const setupSection = createSetupSection(suggestionBuckets);
  if (setupSection) {
    sections.push(setupSection);
  }

  return { sections, metadata };
}

function createActiveEditorSection(request: QuickActionBuildRequest): QuickActionSection | null {
  const actions: QuickActionDefinition[] = [];

  actions.push(
    createQuickAction({
      id: 'transform-file',
      icon: ICONS.transform,
      title: 'Transform File',
      description: 'Auto-extract strings and wrap providers in the active editor.',
      command: 'i18nsmith.transformFile',
      postRunBehavior: 'offer-output',
    })!
  );

  actions.push(
    createQuickAction({
      id: 'analyze-file',
      icon: ICONS.analyze,
      title: 'Analyze Usage in Current File',
      description: 'Scan the active file for translation coverage and drift.',
      command: 'i18nsmith.syncFile',
      postRunBehavior: 'offer-output',
    })!
  );

  actions.push(
    createQuickAction({
      id: 'refresh-diagnostics',
      icon: ICONS.refreshFile,
      title: 'Refresh File Diagnostics',
      description: 'Reload diagnostics from the latest health report.',
      command: 'i18nsmith.refreshDiagnostics',
      longRunning: false,
    })!
  );

  if (request.hasSelection) {
    actions.push(
      createQuickAction({
        id: 'extract-selection',
          icon: ICONS.extractSelection,
        title: 'Extract Selection to Key',
        description: 'Turn highlighted text into a reusable translation key.',
        command: 'i18nsmith.extractSelection',
          longRunning: false,
      })!
    );
  }

  return actions.length ? { title: '✨ Current Editor', actions } : null;
}

function createProjectHealthSection(
  report: CheckReport | null,
  suggestionBuckets: Map<SuggestionCategory, SuggestedCommandEntry[]>
): QuickActionSection | null {
  const actions: QuickActionDefinition[] = [];
  const driftStats = getDriftStatistics(report);
  const missingCount = driftStats?.missing ?? 0;
  const translationSuggestion = suggestionBuckets.get('translation')?.[0];

  actions.push(
    createQuickAction({
      id: 'workspace-sync',
      icon: ICONS.workspaceSync,
      title: 'Full Workspace Sync',
      description: 'Run a comprehensive sync across the repository.',
      detail: 'Preview adds/removals and confirm before writing.',
      command: 'i18nsmith.sync',
      postRunBehavior: 'offer-output',
    })!
  );

  if (missingCount > 0 || translationSuggestion) {
    actions.push(
      createQuickAction({
        id: 'handoff-translators',
          icon: ICONS.export,
        title: missingCount > 0 ? `Handoff to Translators (${missingCount})` : 'Handoff to Translators',
        description:
          missingCount > 0
            ? `Export ${missingCount} missing/empty translation${missingCount === 1 ? '' : 's'} to CSV.`
            : 'Export missing translations for localization teams.',
        detail: translationSuggestion?.reason,
        command: 'i18nsmith.exportMissingTranslations',
          postRunBehavior: 'offer-output',
      })!
    );
  }

  actions.push(
    createQuickAction({
      id: 'open-locale',
      icon: ICONS.openLocale,
      title: 'Open Primary Locale',
      description: 'Jump to the configured source locale file.',
      command: 'i18nsmith.openLocaleFile',
      longRunning: false,
    })!
  );

  return actions.length ? { title: '🔄 Project Health', actions } : null;
}

function createSetupSection(
  suggestionBuckets: Map<SuggestionCategory, SuggestedCommandEntry[]>
): QuickActionSection | null {
  const actions: QuickActionDefinition[] = [];
  const setupSuggestion = suggestionBuckets.get('setup')?.[0];

  if (setupSuggestion) {
    actions.push(
      createQuickAction({
        id: 'scaffold-runtime',
        icon: ICONS.scaffold,
        title: 'Scaffold Runtime & Provider',
        description: 'Install runtime packages and generate the provider shell.',
        detail: setupSuggestion.reason,
        command: setupSuggestion.command,
      })!
    );
  }

  actions.push(
    createQuickAction({
      id: 'run-health-check',
      icon: ICONS.health,
      title: 'Run Full Health Check',
      description: 'Trigger a comprehensive scan and refresh diagnostics.',
      command: 'i18nsmith.check',
      postRunBehavior: 'offer-output',
    })!
  );

  actions.push(
    createQuickAction({
      id: 'show-output',
      icon: ICONS.terminal,
      title: 'Show i18nsmith Output Channel',
      description: 'Open the dedicated output pane for detailed logs.',
      command: 'i18nsmith.showOutput',
      longRunning: false,
    })!
  );

  return actions.length ? { title: '⚙️ Setup & Diagnostics', actions } : null;
}

interface CommandActionConfig {
  id: string;
  icon: { id: string; label: string };
  title: string;
  description: string;
  detail?: string;
  command?: string;
  previewIntent?: PreviewableCommand;
  confirmMessage?: string;
  longRunning?: boolean;
  postRunBehavior?: 'offer-output';
  children?: QuickActionChildDefinition[];
}

function createQuickAction(config: CommandActionConfig): QuickActionDefinition | null {
  if (!config.command && !config.previewIntent) {
    return null;
  }

  const rawCommand = config.command;
  const isVsCodeCommand = Boolean(rawCommand && rawCommand.startsWith('i18nsmith.'));
  const previewIntent = config.previewIntent ?? (!isVsCodeCommand && rawCommand ? parsePreviewableCommand(rawCommand) : null);

  return {
    id: config.id,
    iconId: config.icon.id,
    iconLabel: config.icon.label,
    title: config.title,
    description: config.description,
    detail: config.detail ?? (previewIntent && rawCommand ? formatPreviewIntentDetail(previewIntent, rawCommand) : config.detail),
    command: previewIntent ? undefined : rawCommand,
    previewIntent: previewIntent ?? undefined,
    interactive: Boolean(rawCommand && !isVsCodeCommand && isInteractiveCliCommand(rawCommand)),
    confirmMessage: config.confirmMessage,
    longRunning: config.longRunning !== false,
    postRunBehavior: config.postRunBehavior,
    children: config.children,
  };
}

function groupSuggestionsByCategory(
  suggestions: SuggestedCommandEntry[]
): Map<SuggestionCategory, SuggestedCommandEntry[]> {
  const buckets = new Map<SuggestionCategory, SuggestedCommandEntry[]>();
  for (const suggestion of suggestions) {
    if (!suggestion.category) {
      continue;
    }
    if (!buckets.has(suggestion.category)) {
      buckets.set(suggestion.category, []);
    }
    buckets.get(suggestion.category)!.push(suggestion);
  }
  return buckets;
}

export function getDriftStatistics(report: unknown): { missing: number; unused: number } | null {
  if (!report || typeof report !== 'object' || report === null) {
    return null;
  }

  const drift = (report as CheckReport).sync;
  if (!drift) {
    return null;
  }

  const missing = Array.isArray(drift.missingKeys) ? drift.missingKeys.length : 0;
  const unused = Array.isArray(drift.unusedKeys) ? drift.unusedKeys.length : 0;

  if (missing === 0 && unused === 0) {
    return null;
  }

  return { missing, unused };
}

function formatPreviewIntentDetail(intent: PreviewableCommand, _originalCommand: string): string {
  const lines: string[] = [];
  if (intent.kind === 'sync') {
    lines.push('Preview & apply locale fixes via VS Code sync flow.');
    if (intent.targets?.length) {
      lines.push(`Targets: ${intent.targets.join(', ')}`);
    } else {
      lines.push('Targets: Workspace');
    }
  } else if (intent.kind === 'transform') {
    lines.push('Preview transform candidates with diff controls before applying changes.');
    if (intent.targets?.length) {
      lines.push(`Targets: ${intent.targets.join(', ')}`);
    }
  } else if (intent.kind === 'rename-key') {
    lines.push(`Preview rename flow for ${intent.from} → ${intent.to}.`);
  } else if (intent.kind === 'translate') {
    lines.push('Preview translation estimates and apply via translate flow.');
    if (intent.options.locales?.length) {
      lines.push(`Locales: ${intent.options.locales.join(', ')}`);
    }
    if (intent.options.provider) {
      lines.push(`Provider: ${intent.options.provider}`);
    }
  }

  return lines.join('\n');
}

function isInteractiveCliCommand(command: string): boolean {
  return /\b(scaffold-adapter|init)\b/.test(command);
}

function buildSuspiciousKeyChildren(warnings: SuspiciousKeyWarning[]): QuickActionChildDefinition[] {
  if (!warnings.length) {
    return [];
  }

  return warnings.slice(0, MAX_SUSPICIOUS_CHILDREN).map((warning, index) => ({
    id: `suspicious-${index}-${warning.key}`,
    label: warning.key,
    description: warning.reason ? formatSuspiciousReason(warning.reason) : undefined,
    detail: warning.filePath ? path.basename(warning.filePath) : undefined,
    iconId: ICONS.suspiciousChild.id,
    command: 'i18nsmith.renameSuspiciousKey',
    commandArgs: [warning],
  }));
}

function formatSuspiciousReason(reason: string): string {
  return reason
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
