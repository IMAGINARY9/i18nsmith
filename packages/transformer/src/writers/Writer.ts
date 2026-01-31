import type { TransformCandidate } from '../types.js';

export interface I18nWriter {
  canHandle(filePath: string): boolean;
  transform(filePath: string, content: string, candidates: TransformCandidate[]): Promise<{ content: string; didMutate: boolean }>;
}