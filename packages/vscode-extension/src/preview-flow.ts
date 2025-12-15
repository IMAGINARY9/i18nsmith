import * as vscode from 'vscode';
import { markdownPreviewProvider } from './markdown-preview';

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
  onApply?: () => Promise<void>;
}

let currentPlan: PreviewPlan | null = null;

export async function applyPreviewPlan(): Promise<void> {
  if (!currentPlan) {
    vscode.window.showInformationMessage('No active plan to apply.');
    return;
  }

  try {
    for (const change of currentPlan.changes) {
      await change.apply();
    }
    
    if (currentPlan.onApply) {
      await currentPlan.onApply();
    }
    
    vscode.window.showInformationMessage(`Applied ${currentPlan.changes.length} changes.`);
  } catch (e) {
    vscode.window.showErrorMessage(`Failed to apply plan: ${e}`);
  } finally {
    if (currentPlan.cleanup) {
      await currentPlan.cleanup().catch(() => {});
    }
    currentPlan = null;
    markdownPreviewProvider.update(vscode.Uri.parse('i18nsmith-preview:Plan Preview'), buildPreviewPlanMarkdown(null));
  }
}

export async function executePreviewPlan(plan: PreviewPlan): Promise<void> {
  console.log("[i18nsmith] executePreviewPlan called with title:", plan.title);

  if (!plan.changes.length) {
    vscode.window.showInformationMessage(`${plan.title}: no changes required.`);
    if (plan.cleanup) {
      await plan.cleanup().catch(() => {});
    }
    return;
  }

  currentPlan = plan;
  const uri = vscode.Uri.parse('i18nsmith-preview:Plan Preview');
  markdownPreviewProvider.update(uri, buildPreviewPlanMarkdown(plan));
  
  await vscode.window.showTextDocument(uri, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

function buildPreviewPlanMarkdown(plan: PreviewPlan | null): string {
  if (!plan) {
    return [
      '# Plan Preview',
      '',
      '_No active plan._'
    ].join('\n');
  }
  
  const lines = [`# ${plan.title}`];
  if (plan.detail) {
    lines.push('', plan.detail);
  }
  
  lines.push('');
  lines.push(`[Apply ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'}](command:i18nsmith.applyPreviewPlan)`);
  
  lines.push('', `## Changes (${plan.changes.length})`);
  for (const change of plan.changes) {
    lines.push(`- ${change.label}`);
  }
  
  return lines.join('\n');
}
