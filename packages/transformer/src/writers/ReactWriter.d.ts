import { ScannerNodeCandidate } from '@i18nsmith/core';
import type { ScanCandidate } from '@i18nsmith/core';
import type { Project } from 'ts-morph';
import type { TransformCandidate } from '../types.js';
import type { I18nWriter } from './Writer.js';
interface InternalCandidate extends TransformCandidate {
    raw: ScannerNodeCandidate;
}
export declare class ReactWriter implements I18nWriter {
    canHandle(filePath: string): boolean;
    prepare(candidate: ScanCandidate, project?: Project): Promise<TransformCandidate | null>;
    transform(candidate: TransformCandidate, project?: Project): Promise<{
        content: string;
        didMutate: boolean;
    }>;
    applyCandidate(candidate: InternalCandidate): boolean;
    private normalizeTranslationSnippet;
    private getUnsafeJsxExpressionReason;
}
export {};
//# sourceMappingURL=ReactWriter.d.ts.map