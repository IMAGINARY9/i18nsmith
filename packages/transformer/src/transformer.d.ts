import { I18nConfig } from '@i18nsmith/core';
import { TransformRunOptions, TransformSummary, TransformerOptions } from './types.js';
export declare class Transformer {
    private readonly config;
    private readonly workspaceRoot;
    private readonly project;
    private readonly keyGenerator;
    private readonly keyValidator;
    private readonly localeStore;
    private readonly defaultWrite;
    private readonly sourceLocale;
    private readonly targetLocales;
    private readonly usesExternalProject;
    private readonly seenHashes;
    private readonly translationAdapter;
    private readonly writers;
    constructor(config: I18nConfig, options?: TransformerOptions);
    private processReactFile;
    private processVueFile;
    run(runOptions?: TransformRunOptions): Promise<TransformSummary>;
    private normalizeTargetPath;
    private generateDiffs;
    /**
     * Known adapter module -> required dependencies mapping.
     * Only warn about dependencies for known adapters.
     */
    private static readonly ADAPTER_DEPENDENCIES;
    private checkDependencies;
    private prepareCandidates;
    private buildContext;
    /**
     * Option A guardrail (docs/extraction-edge-cases.md):
     * reject JSX expressions that look like pluralization/concatenation logic.
     *
     * We skip these because they typically require manual i18n logic
     * (plural rules, ICU messages, or separate keys) and naive replacement would
     * produce awkward seed values like "item(s)".
     */
    private getUnsafeJsxExpressionReason;
    private containsConditionalOrLogical;
    private applyCandidate;
    private normalizeTranslationAdapter;
    private findLegacyLocaleValue;
    private buildLegacyKeyCandidates;
    private getRelativeModulePath;
    private normalizeTranslationSnippet;
}
//# sourceMappingURL=transformer.d.ts.map