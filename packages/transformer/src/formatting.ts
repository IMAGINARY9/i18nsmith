import fs from 'fs/promises';

function isModuleNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as NodeJS.ErrnoException;
  if (err.code === 'MODULE_NOT_FOUND') {
    return true;
  }

  const message = 'message' in err ? String(err.message) : '';
  return message.includes("Cannot find module 'prettier'");
}

export async function formatFileWithPrettier(filePath: string) {
  try {
    const prettier = await import('prettier');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const config = await prettier.resolveConfig(filePath).catch(() => null);
    const formatted = await prettier.format(fileContent, {
      ...(config ?? {}),
      filepath: filePath,
    });

    if (formatted !== fileContent) {
      await fs.writeFile(filePath, formatted, 'utf8');
    }
  } catch (error) {
    if (isModuleNotFound(error)) {
      return;
    }

    console.warn(`[i18nsmith] Prettier formatting skipped for ${filePath}: ${(error as Error).message}`);
  }
}
