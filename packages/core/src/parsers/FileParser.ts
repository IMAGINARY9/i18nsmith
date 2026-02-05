import type { Project } from 'ts-morph';
import type { ScanCandidate } from '../scanner.js';

export interface FileParser {
  canHandle(filePath: string): boolean;
  parse(
    filePath: string,
    content: string,
    project?: Project,
    options?: { scanCalls?: boolean }
  ): ScanCandidate[];
  getSkippedCandidates?(): import('../scanner.js').SkippedCandidate[];
}