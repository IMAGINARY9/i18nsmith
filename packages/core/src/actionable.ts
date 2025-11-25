export type ActionableSeverity = 'info' | 'warn' | 'error';

export interface ActionableItem {
  kind: string;
  severity: ActionableSeverity;
  message: string;
  key?: string;
  locale?: string;
  filePath?: string;
  details?: Record<string, unknown>;
}
