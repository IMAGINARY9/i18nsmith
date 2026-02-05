import type { Node, Project, SourceFile } from 'ts-morph';
import type { ScanCandidate } from '../scanner.js';

export type ParserNodeRecorder = (
  candidate: ScanCandidate,
  node: Node,
  sourceFile: SourceFile
) => void;

export interface FileParser {
  canHandle(filePath: string): boolean;
  parse(
    filePath: string,
    content: string,
    project?: Project,
    options?: { scanCalls?: boolean; recordDetailed?: ParserNodeRecorder }
  ): ScanCandidate[];
  getSkippedCandidates?(): import('../scanner.js').SkippedCandidate[];
}