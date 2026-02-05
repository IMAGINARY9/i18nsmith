type PrettierModule = {
    resolveConfig(filePath: string): Promise<Record<string, unknown> | null>;
    format(content: string, options: Record<string, unknown>): Promise<string> | string;
};
type PrettierLoader = () => Promise<PrettierModule>;
export declare function formatFileWithPrettier(filePath: string, loadPrettier?: PrettierLoader): Promise<void>;
export {};
//# sourceMappingURL=formatting.d.ts.map