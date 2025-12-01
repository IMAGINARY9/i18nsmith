export type ActionableSeverity = 'info' | 'warn' | 'error';

export interface ActionableItem {
  kind: string;
  severity: ActionableSeverity;
  message: string;
  key?: string;
  locale?: string;
  filePath?: string;
  line?: number;
  column?: number;
  details?: Record<string, unknown>;
}
