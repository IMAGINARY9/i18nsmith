import * as vscode from 'vscode';

export interface PlannedChange {
  label: string;
  beforeUri: vscode.Uri;
  afterUri: vscode.Uri;
  apply: () => Promise<void>;
  summary?: string;
}

export interface PreviewPlan {
  title: string;
  detail?: string;
  changes: PlannedChange[];
  cleanup?: () => Promise<void>;
}

export async function executePreviewPlan(plan: PreviewPlan): Promise<boolean> {
  if (!plan.changes.length) {
    vscode.window.showInformationMessage(`${plan.title}: no changes required.`);
    if (plan.cleanup) {
      await plan.cleanup().catch(() => {});
    }
    return false;
  }

  const detail = plan.detail ?? plan.changes.map((change) => `• ${change.label}`).join('\n');

  try {
    const previewChoice = await vscode.window.showInformationMessage(
      `${plan.title} – review ${plan.changes.length} file${plan.changes.length === 1 ? '' : 's'}`,
      { modal: true, detail },
      'Preview Changes',
      'Cancel'
    );

    if (previewChoice !== 'Preview Changes') {
      return false;
    }

    for (const change of plan.changes) {
      await vscode.commands.executeCommand(
        'vscode.diff',
        change.beforeUri,
        change.afterUri,
        `${plan.title}: ${change.label}`,
        { preview: true }
      );
    }

    const applyChoice = await vscode.window.showInformationMessage(
      `Apply ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'}?`,
      { modal: true, detail },
      'Apply Changes',
      'Cancel'
    );

    if (applyChoice !== 'Apply Changes') {
      return false;
    }

    for (const change of plan.changes) {
      await change.apply();
    }

    return true;
  } finally {
    if (plan.cleanup) {
      await plan.cleanup().catch(() => {});
    }
  }
}
