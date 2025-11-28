/**
 * Exit Code Reference for i18nsmith CLI
 *
 * This module centralizes all exit codes used by the CLI for consistent
 * behavior across commands and improved CI/CD integration.
 *
 * ## Exit Code Ranges
 *
 * | Range  | Category              | Description                           |
 * |--------|-----------------------|---------------------------------------|
 * | 0      | Success               | Command completed successfully        |
 * | 1      | General Error         | Unspecified error or crash            |
 * | 2-5    | Diagnostics           | Workspace diagnostic conflicts        |
 * | 10-19  | Check Command         | Health check warnings/conflicts       |
 * | 1-4    | Sync Command          | Sync drift/validation issues          |
 *
 * Note: Sync exit codes overlap with diagnostics for backward compatibility.
 * Use `--prefer-diagnostics-exit` in `check` command to disambiguate.
 *
 * ## Usage in CI/CD
 *
 * ```bash
 * # Basic CI check
 * npx i18nsmith check --fail-on conflicts
 * if [ $? -eq 11 ]; then
 *   echo "Blocking conflicts found"
 * fi
 *
 * # Strict sync check
 * npx i18nsmith sync --check --strict
 * case $? in
 *   0) echo "All clear" ;;
 *   1) echo "Locale drift detected" ;;
 *   2) echo "Placeholder mismatch" ;;
 *   4) echo "Suspicious keys found" ;;
 * esac
 * ```
 */

/**
 * Exit codes for the `sync` command.
 *
 * Used when running `i18nsmith sync --check` or `--strict` mode.
 */
export const SYNC_EXIT_CODES = {
  /** Locale drift detected (missing or unused keys) */
  DRIFT: 1,
  /** Placeholder/interpolation mismatch between locales */
  PLACEHOLDER_MISMATCH: 2,
  /** Empty or placeholder values in locale files */
  EMPTY_VALUES: 3,
  /** Suspicious key patterns detected (e.g., key=value, raw text keys) */
  SUSPICIOUS_KEYS: 4,
} as const;

/**
 * Exit codes for the `check` command.
 *
 * Used when running `i18nsmith check --fail-on <level>`.
 */
export const CHECK_EXIT_CODES = {
  /** Warnings detected (when --fail-on warnings) */
  WARNINGS: 10,
  /** Blocking conflicts detected (when --fail-on conflicts) */
  CONFLICTS: 11,
} as const;

/**
 * Exit codes for the `diagnose` command and diagnostic conflicts.
 *
 * These are also used by `check` when `--prefer-diagnostics-exit` is set.
 */
export const DIAGNOSTICS_EXIT_CODES = {
  /** Missing source locale file */
  MISSING_SOURCE_LOCALE: 2,
  /** Invalid JSON in locale file */
  INVALID_LOCALE_JSON: 3,
  /** Provider/adapter clash detected */
  UNSAFE_PROVIDER_CLASH: 4,
  /** General diagnostics conflict (fallback) */
  GENERAL_CONFLICT: 5,
} as const;

/**
 * General exit codes used across all commands.
 */
export const GENERAL_EXIT_CODES = {
  /** Success - no issues found */
  SUCCESS: 0,
  /** General error (catch-all for exceptions) */
  ERROR: 1,
} as const;

/**
 * Type for all sync exit codes
 */
export type SyncExitCode = (typeof SYNC_EXIT_CODES)[keyof typeof SYNC_EXIT_CODES];

/**
 * Type for all check exit codes
 */
export type CheckExitCode = (typeof CHECK_EXIT_CODES)[keyof typeof CHECK_EXIT_CODES];

/**
 * Type for all diagnostics exit codes
 */
export type DiagnosticsExitCode = (typeof DIAGNOSTICS_EXIT_CODES)[keyof typeof DIAGNOSTICS_EXIT_CODES];

/**
 * Human-readable descriptions for sync exit codes.
 */
export const SYNC_EXIT_DESCRIPTIONS: Record<number, string> = {
  [SYNC_EXIT_CODES.DRIFT]: 'Locale drift detected (missing or unused keys)',
  [SYNC_EXIT_CODES.PLACEHOLDER_MISMATCH]: 'Placeholder mismatch between locales',
  [SYNC_EXIT_CODES.EMPTY_VALUES]: 'Empty or placeholder values in locale files',
  [SYNC_EXIT_CODES.SUSPICIOUS_KEYS]: 'Suspicious key patterns detected',
};

/**
 * Human-readable descriptions for check exit codes.
 */
export const CHECK_EXIT_DESCRIPTIONS: Record<number, string> = {
  [CHECK_EXIT_CODES.WARNINGS]: 'Warnings detected',
  [CHECK_EXIT_CODES.CONFLICTS]: 'Blocking conflicts detected',
};

/**
 * Human-readable descriptions for diagnostics exit codes.
 */
export const DIAGNOSTICS_EXIT_DESCRIPTIONS: Record<number, string> = {
  [DIAGNOSTICS_EXIT_CODES.MISSING_SOURCE_LOCALE]: 'Missing source locale file',
  [DIAGNOSTICS_EXIT_CODES.INVALID_LOCALE_JSON]: 'Invalid JSON in locale file',
  [DIAGNOSTICS_EXIT_CODES.UNSAFE_PROVIDER_CLASH]: 'Provider/adapter clash detected',
  [DIAGNOSTICS_EXIT_CODES.GENERAL_CONFLICT]: 'General diagnostics conflict',
};

/**
 * All exit code descriptions by command context.
 */
export const EXIT_CODE_DESCRIPTIONS = {
  general: {
    [GENERAL_EXIT_CODES.SUCCESS]: 'Success - no issues found',
    [GENERAL_EXIT_CODES.ERROR]: 'General error',
  },
  sync: SYNC_EXIT_DESCRIPTIONS,
  check: CHECK_EXIT_DESCRIPTIONS,
  diagnostics: DIAGNOSTICS_EXIT_DESCRIPTIONS,
} as const;

/**
 * Get a human-readable description for an exit code.
 *
 * @param code - The exit code
 * @param context - Optional context to disambiguate overlapping codes
 * @returns Description string, or 'Unknown exit code' if not recognized
 */
export function getExitCodeDescription(
  code: number,
  context?: 'sync' | 'check' | 'diagnostics'
): string {
  // Check context-specific first
  if (context) {
    const contextMap = EXIT_CODE_DESCRIPTIONS[context];
    if (contextMap[code]) {
      return contextMap[code];
    }
  }

  // Try general codes
  if (code in EXIT_CODE_DESCRIPTIONS.general) {
    return EXIT_CODE_DESCRIPTIONS.general[code as keyof typeof EXIT_CODE_DESCRIPTIONS.general];
  }

  // Search all contexts
  for (const ctxMap of [SYNC_EXIT_DESCRIPTIONS, CHECK_EXIT_DESCRIPTIONS, DIAGNOSTICS_EXIT_DESCRIPTIONS]) {
    if (ctxMap[code]) {
      return ctxMap[code];
    }
  }

  return `Unknown exit code: ${code}`;
}

/**
 * Helper to set process exit code with optional logging.
 *
 * @param code - The exit code to set
 * @param options - Optional configuration
 */
export function setExitCode(
  code: number,
  options?: { silent?: boolean }
): void {
  process.exitCode = code;
  if (!options?.silent && code !== 0) {
    // Only log in development/debug mode
    if (process.env.DEBUG?.includes('i18nsmith')) {
      console.error(`[i18nsmith] Exit code ${code}: ${getExitCodeDescription(code)}`);
    }
  }
}
