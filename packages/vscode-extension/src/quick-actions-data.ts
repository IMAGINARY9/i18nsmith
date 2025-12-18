import type { CheckReport } from './diagnostics';
import { summarizeReportIssues } from './report-utils';
import { parsePreviewableCommand, type PreviewableCommand } from './preview-intents';

export interface QuickActionDefinition {
  id: string;
  iconId: string;
  title: string;
  description: string;
  detail?: string;
  command?: string;
  previewIntent?: PreviewableCommand;
  interactive?: boolean;
  confirmMessage?: string;
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
}

export interface QuickActionBuildOutput {
  sections: QuickActionSection[];
  metadata: QuickActionMetadata;
}

type SuggestionCategory =
  | 'extraction'
  | 'sync'
  | 'translation'
  | 'setup'
  | 'validation'
  | 'quality';

type SuggestedCommandEntry = NonNullable<CheckReport['suggestedCommands']>[number];

export function buildQuickActionModel(request: QuickActionBuildRequest): QuickActionBuildOutput {
  const report = request.report;
  const summary = summarizeReportIssues(report);
  const actionableItems = summary.items;
  const driftStats = getDriftStatistics(report);
  const suggestions = Array.isArray(report?.suggestedCommands) ? report!.suggestedCommands : [];

  const dynamicWarningCount = Array.isArray(report?.sync?.dynamicKeyWarnings)
    ? report!.sync!.dynamicKeyWarnings.length
    : 0;
  const suspiciousWarningCount = Array.isArray(report?.sync?.suspiciousKeys)
    ? report!.sync!.suspiciousKeys.length
    : 0;
  const hardcodedCount = actionableItems.filter((item) => item.kind === 'hardcoded-text').length;
  const runtimeMissing = actionableItems.some((item) => item.kind === 'diagnostics-runtime-missing');
  const runtimeReady = !runtimeMissing;

  const metadata: QuickActionMetadata = {
    issueCount: summary.issueCount,
    suggestionsCount: suggestions.length,
    driftStats,
    runtimeReady,
  };

  const sections: QuickActionSection[] = [];

  if (!runtimeReady) {
    sections.push({
      title: '⚙️ Setup Required',
      actions: [
        createQuickAction({
          id: 'initialize-runtime',
          iconId: 'tools',
          title: 'Initialize i18n Project',
          description: 'Install runtime packages and scaffold the provider shell.',
          detail: 'Runs the scaffold adapter command with recommended defaults.',
          command: 'i18nsmith scaffold-adapter --type react-i18next --install-deps',
        }),
        createQuickAction({
          id: 'open-output-channel',
          iconId: 'terminal',
          title: 'Show i18nsmith Output Channel',
          description: 'Review CLI output and diagnostics.',
          command: 'i18nsmith.showOutput',
        }),
      ].filter(Boolean) as QuickActionDefinition[],
    });

    return { sections, metadata };
  }

  const suggestionBuckets = groupSuggestionsByCategory(suggestions);

  const problems: QuickActionDefinition[] = [];
  const driftTotal = (driftStats?.missing ?? 0) + (driftStats?.unused ?? 0);

  if (summary.issueCount > 0 || dynamicWarningCount || suspiciousWarningCount || hardcodedCount) {
    const extractionSuggestion = suggestionBuckets.get('extraction')?.[0];
    const extraction = createQuickAction({
      id: 'batch-extract',
      iconId: 'diff',
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
        iconId: 'sync',
        title: `Fix Locale Drift (${driftTotal})`,
        description: driftParts.length
          ? `${driftParts.join(', ')} — preview adds/removals before applying.`
          : 'Review detected drift, then selectively add or prune keys.',
        detail: syncSuggestion?.reason,
        command: syncSuggestion?.command ?? 'i18nsmith.sync',
      });
      if (driftAction) {
        problems.push(driftAction);
      }
    }

    const validationSuggestion = suggestionBuckets.get('validation')?.[0];
    if (validationSuggestion) {
      const validationAction = createQuickAction({
        id: 'resolve-placeholders',
        iconId: 'check',
        title: 'Resolve Placeholder Issues',
        description: 'Fix interpolation mismatches before they break translations.',
        detail: validationSuggestion.reason,
        command: validationSuggestion.command,
      });
      if (validationAction) {
        problems.push(validationAction);
      }
    }

    if (suspiciousWarningCount) {
      problems.push(
        createQuickAction({
          id: 'rename-suspicious',
          iconId: 'list-flat',
          title: `Rename All Suspicious Keys (${suspiciousWarningCount})`,
          description: 'Normalize flagged keys and update code references with preview.',
          command: 'i18nsmith.renameAllSuspiciousKeys',
        })!
      );
    }

    if (dynamicWarningCount) {
      problems.push(
        createQuickAction({
          id: 'whitelist-dynamic',
          iconId: 'shield',
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
      iconId: 'beaker',
      title: 'Magic Transform File',
      description: 'Auto-extract strings and wrap providers in the active editor.',
      command: 'i18nsmith.transformFile',
    })!
  );

  actions.push(
    createQuickAction({
      id: 'analyze-file',
      iconId: 'search',
      title: 'Analyze Usage in Current File',
      description: 'Scan the active file for translation coverage and drift.',
      command: 'i18nsmith.syncFile',
    })!
  );

  actions.push(
    createQuickAction({
      id: 'refresh-diagnostics',
      iconId: 'repo-pull',
      title: 'Refresh File Diagnostics',
      description: 'Reload diagnostics from the latest health report.',
      command: 'i18nsmith.refreshDiagnostics',
    })!
  );

  if (request.hasSelection) {
    actions.push(
      createQuickAction({
        id: 'extract-selection',
        iconId: 'pencil',
        title: 'Extract Selection to Key',
        description: 'Turn highlighted text into a reusable translation key.',
        command: 'i18nsmith.extractSelection',
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
      iconId: 'repo-sync',
      title: 'Full Workspace Sync',
      description: 'Run a comprehensive sync across the repository.',
      detail: 'Preview adds/removals and confirm before writing.',
      command: 'i18nsmith.sync',
    })!
  );

  if (missingCount > 0 || translationSuggestion) {
    actions.push(
      createQuickAction({
        id: 'handoff-translators',
        iconId: 'cloud-upload',
        title: missingCount > 0 ? `Handoff to Translators (${missingCount})` : 'Handoff to Translators',
        description:
          missingCount > 0
            ? `Export ${missingCount} missing key${missingCount === 1 ? '' : 's'} to CSV.`
            : 'Export missing translations for localization teams.',
        detail: translationSuggestion?.reason,
        command: 'i18nsmith.exportMissingTranslations',
      })!
    );
  }

  actions.push(
    createQuickAction({
      id: 'open-locale',
      iconId: 'book',
      title: 'Open Primary Locale',
      description: 'Jump to the configured source locale file.',
      command: 'i18nsmith.openLocaleFile',
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
        iconId: 'tools',
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
      iconId: 'pulse',
      title: 'Run Full Health Check',
      description: 'Trigger a comprehensive scan and refresh diagnostics.',
      command: 'i18nsmith.check',
    })!
  );

  actions.push(
    createQuickAction({
      id: 'show-output',
      iconId: 'terminal',
      title: 'Show i18nsmith Output Channel',
      description: 'Open the dedicated output pane for detailed logs.',
      command: 'i18nsmith.showOutput',
    })!
  );

  return actions.length ? { title: '⚙️ Setup & Diagnostics', actions } : null;
}

function createQuickAction(config: {
  id: string;
  iconId: string;
  title: string;
  description: string;
  detail?: string;
  command?: string;
  confirmMessage?: string;
}): QuickActionDefinition | null {
  if (!config.command) {
    return null;
  }

  const isVsCodeCommand = config.command.startsWith('i18nsmith.');
  const previewIntent = !isVsCodeCommand ? parsePreviewableCommand(config.command) : null;

  return {
    id: config.id,
    iconId: config.iconId,
    title: config.title,
    description: config.description,
    detail: config.detail ?? (previewIntent ? formatPreviewIntentDetail(previewIntent, config.command) : undefined),
    command: previewIntent ? undefined : config.command,
    previewIntent: previewIntent ?? undefined,
    interactive: !isVsCodeCommand && isInteractiveCliCommand(config.command),
    confirmMessage: config.confirmMessage,
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
