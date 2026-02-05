import { ArrowFunction, FunctionDeclaration, FunctionExpression, MethodDeclaration, Node, SourceFile } from 'ts-morph';
export type FunctionLike = FunctionDeclaration | FunctionExpression | ArrowFunction | MethodDeclaration;
export interface TranslationImportConfig {
    moduleSpecifier: string;
    namedImport: string;
}
export interface DetectedImport {
    moduleSpecifier: string;
    namedImport: string;
    isDefault: boolean;
}
export interface UseTranslationBindingOptions {
    allowAncestorScope?: boolean;
    allowExpressionBody?: boolean;
}
/**
 * Detects existing translation imports in a source file.
 * Returns the first match found, prioritizing known modules.
 */
export declare function detectExistingTranslationImport(sourceFile: SourceFile): DetectedImport | null;
export declare function ensureUseTranslationImport(sourceFile: SourceFile, adapter: TranslationImportConfig): void;
export declare function ensureUseTranslationBinding(fn: FunctionLike, hookName: string): boolean;
export declare function hasUseTranslationBinding(fn: FunctionLike, hookName: string, includeAncestors?: boolean): boolean;
export declare function ensureUseTranslationBindingWithOptions(fn: FunctionLike, hookName: string, options?: UseTranslationBindingOptions): boolean;
export declare function isComponentLikeFunction(fn: FunctionLike): boolean;
export declare function ensureClientDirective(sourceFile: SourceFile): void;
export declare function findNearestFunctionScope(node: Node): FunctionLike | undefined;
//# sourceMappingURL=react-adapter.d.ts.map