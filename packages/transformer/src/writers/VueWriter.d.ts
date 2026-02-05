import type { TransformCandidate } from '../types.js';
import type { I18nWriter } from './Writer.js';
export declare class VueWriter implements I18nWriter {
    canHandle(filePath: string): boolean;
    transform(filePath: string, content: string, candidates: TransformCandidate[]): Promise<{
        content: string;
        didMutate: boolean;
    }>;
    private applyCandidate;
    /**
     * Find the absolute character offset of the candidate text in the content.
     * Handles both 0-based and 1-based column numbering from different parsers.
     * Also handles cases where the candidate text was cleaned (whitespace trimmed).
     */
    private findCandidateOffset;
    private transformText;
    private transformAttribute;
    private transformExpression;
    private transformCallExpression;
    private expandToSurroundingQuotes;
}
//# sourceMappingURL=VueWriter.d.ts.map