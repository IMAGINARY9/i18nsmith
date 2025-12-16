import type {
  KeyGenerator,
  LocaleDiffEntry,
  LocaleFileStats,
  LocaleStore,
  ScanCandidate,
  SourceFileDiffEntry,
} from '@i18nsmith/core';

export type CandidateStatus =
  | 'pending'
  | 'duplicate'
  | 'existing'
  | 'applied'
  | 'skipped';

export interface TransformCandidate extends ScanCandidate {
  suggestedKey: string;
  hash: string;
  status: CandidateStatus;
  reason?: string;
}

export interface TransformSummary {
  filesScanned: number;
  filesChanged: string[];
  candidates: TransformCandidate[];
  localeStats: LocaleFileStats[];
  diffs: LocaleDiffEntry[];
  sourceDiffs?: SourceFileDiffEntry[];
  skippedFiles: Array<{ filePath: string; reason: string }>;
  write: boolean;
}

export type TransformProgressStage = 'scan' | 'apply' | 'locales';

export interface TransformProgress {
  stage: TransformProgressStage;
  processed: number;
  total: number;
  percent: number;
  applied?: number;
  skipped?: number;
  remaining?: number;
  errors?: number;
  message?: string;
}

export interface TransformRunOptions {
  write?: boolean;
  targets?: string[];
  diff?: boolean;
  migrateTextKeys?: boolean;
  onProgress?: (progress: TransformProgress) => void;
}

export interface TransformerOptions {
  workspaceRoot?: string;
  project?: import('ts-morph').Project;
  keyNamespace?: string;
  keyGenerator?: KeyGenerator;
  localeStore?: LocaleStore;
  write?: boolean;
}

export interface FileTransformRecord {
  filePath: string;
  reason: string;
}
