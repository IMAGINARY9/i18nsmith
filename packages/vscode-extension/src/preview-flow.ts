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

export class PreviewPlanService implements vscode.Disposable {
  private currentPlan: PreviewPlan | null = null;
  private readonly previewUri = vscode.Uri.parse('i18nsmith-preview:Plan Preview');

  async executePlan(plan: PreviewPlan): Promise<void> {
    console.log('[i18nsmith] executePreviewPlan called with title:', plan.title);

    if (!plan.changes.length) {
      vscode.window.showInformationMessage(`${plan.title}: no changes required.`);
      await plan.cleanup?.().catch(() => {});
      return;
    }

    this.currentPlan = plan;
    this.updatePreview(plan);
    await vscode.window.showTextDocument(this.previewUri, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }

  async applyActivePlan(): Promise<void> {
    console.log('[i18nsmith] applyPreviewPlan triggered');
    if (!this.currentPlan) {
      console.log('[i18nsmith] No active plan found');
      vscode.window.showInformationMessage('No active plan to apply.');
      return;
    }

    try {
      console.log(`[i18nsmith] Applying ${this.currentPlan.changes.length} changes`);
      for (const change of this.currentPlan.changes) {
        await change.apply();
      }

      await this.currentPlan.onApply?.();
      vscode.window.showInformationMessage(`Applied ${this.currentPlan.changes.length} changes.`);
    } catch (error) {
      console.error('[i18nsmith] Failed to apply plan:', error);
      vscode.window.showErrorMessage(`Failed to apply plan: ${error}`);
    } finally {
      await this.currentPlan.cleanup?.().catch(() => {});
      this.clearPlan();
    }
  }

  clearPlan() {
    this.currentPlan = null;
    this.updatePreview(null);
  }

  dispose() {
    this.clearPlan();
  }

  private updatePreview(plan: PreviewPlan | null) {
    markdownPreviewProvider.update(this.previewUri, this.buildPreviewPlanMarkdown(plan));
  }

  private buildPreviewPlanMarkdown(plan: PreviewPlan | null): string {
    if (!plan) {
      return ['# Plan Preview', '', '_No active plan._'].join('\n');
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
}
