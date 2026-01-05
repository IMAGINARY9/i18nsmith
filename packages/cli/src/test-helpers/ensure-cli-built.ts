import { stat } from 'fs/promises';
import path from 'path';

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_DELAY_MS = 300;
// dist/index.js is an ESM shim that re-exports dist/index.cjs.
// It's intentionally small, so we validate the underlying bundle size instead.
const MIN_FILE_SIZE_BYTES = 1024;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function ensureCliBuilt(cliPath: string): Promise<void> {
  const maxAttempts = Number(process.env.I18NSMITH_TEST_CLI_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS);
  const delayMs = Number(process.env.I18NSMITH_TEST_CLI_DELAY_MS ?? DEFAULT_DELAY_MS);

  const cjsFallbackPath = cliPath.endsWith(`${path.sep}index.js`)
    ? cliPath.slice(0, -'index.js'.length) + 'index.cjs'
    : cliPath;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const stats = await stat(cliPath);
      // Accept either:
      // 1) a full bundle directly at cliPath, or
      // 2) a tiny ESM shim at cliPath + a full CJS bundle at index.cjs
      if (stats.size >= MIN_FILE_SIZE_BYTES) {
        return;
      }

      // If it's the shim, validate the underlying bundle.
      if (cjsFallbackPath !== cliPath) {
        const cjsStats = await stat(cjsFallbackPath);
        if (cjsStats.size >= MIN_FILE_SIZE_BYTES) {
          return;
        }
      }
    } catch {
      // ignore and retry
    }

    await sleep(delayMs);
  }

  throw new Error(
    `CLI not found at ${cliPath} after ${maxAttempts} attempts. ` +
      "Ensure 'pnpm build' completes successfully before running tests."
  );
}
