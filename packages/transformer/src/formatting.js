import fs from 'fs/promises';
const defaultLoader = () => import('prettier');
function isModuleNotFound(error) {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const err = error;
    if (err.code === 'MODULE_NOT_FOUND') {
        return true;
    }
    const message = 'message' in err ? String(err.message) : '';
    return message.includes("Cannot find module 'prettier'");
}
export async function formatFileWithPrettier(filePath, loadPrettier = defaultLoader) {
    try {
        const prettier = await loadPrettier();
        const fileContent = await fs.readFile(filePath, 'utf8');
        const config = await prettier.resolveConfig(filePath).catch(() => null);
        const formatted = await prettier.format(fileContent, {
            ...(config ?? {}),
            filepath: filePath,
        });
        if (formatted !== fileContent) {
            await fs.writeFile(filePath, formatted, 'utf8');
        }
    }
    catch (error) {
        if (isModuleNotFound(error)) {
            return;
        }
        console.warn(`[i18nsmith] Prettier formatting skipped for ${filePath}: ${error.message}`);
    }
}
//# sourceMappingURL=formatting.js.map