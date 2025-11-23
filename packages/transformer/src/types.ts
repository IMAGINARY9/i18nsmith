import type {
  CandidateKind,
  KeyGenerator,
  LocaleFileStats,
  LocaleStore,
  ScanCandidate,
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
  skippedFiles: Array<{ filePath: string; reason: string }>;
  write: boolean;
}

export interface TransformRunOptions {
  write?: boolean;
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
