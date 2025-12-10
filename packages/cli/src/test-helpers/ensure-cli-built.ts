import { stat } from 'fs/promises';

const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_DELAY_MS = 300;
const MIN_FILE_SIZE_BYTES = 1024;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function ensureCliBuilt(cliPath: string): Promise<void> {
  const maxAttempts = Number(process.env.I18NSMITH_TEST_CLI_ATTEMPTS ?? DEFAULT_MAX_ATTEMPTS);
  const delayMs = Number(process.env.I18NSMITH_TEST_CLI_DELAY_MS ?? DEFAULT_DELAY_MS);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const stats = await stat(cliPath);
      if (stats.size >= MIN_FILE_SIZE_BYTES) {
        return;
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
