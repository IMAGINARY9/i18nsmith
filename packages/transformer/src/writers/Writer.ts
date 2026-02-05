import type { ScanCandidate } from '@i18nsmith/core';
import type { Project } from 'ts-morph';
import type { TransformCandidate } from '../types.js';

export interface I18nWriter {
  canHandle(filePath: string): boolean;
  prepare(candidate: ScanCandidate, project?: Project): Promise<TransformCandidate | null>;
  transform(candidate: TransformCandidate, project?: Project): Promise<{ content: string; didMutate: boolean }>;
}