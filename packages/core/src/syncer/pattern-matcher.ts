/**
 * Glob pattern compilation and matching utilities for dynamic key detection
 */

/**
 * Escapes special regex characters in a string
 */
export function escapeRegexChar(char: string): string {
  return char.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&');
}

/**
 * Compiles a glob pattern into a RegExp
 * Supports:
 * - `*` matches any characters except dots
 * - `**` matches any characters including dots
 * - `?` matches a single character
 */
export function compileGlob(pattern: string): RegExp {
  let regex = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        regex += '.*';
        i += 1;
      } else {
        regex += '[^.]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '.';
      continue;
    }

    regex += escapeRegexChar(char);
  }

  return new RegExp(`^${regex}$`);
}

/**
 * Compiles multiple glob patterns into an array of RegExp matchers
 */
export function compileGlobPatterns(patterns: string[]): RegExp[] {
  return patterns.map(compileGlob);
}

/**
 * Tests if a key matches any of the glob matchers
 */
export function matchesAnyGlob(key: string, matchers: RegExp[]): boolean {
  return matchers.some((matcher) => matcher.test(key));
}

/**
 * Collects keys from locale data that match dynamic key glob patterns
 */
export function collectPatternMatchedKeys(
  localeData: Map<string, Record<string, string>>,
  matchers: RegExp[]
): Set<string> {
  const matched = new Set<string>();
  if (!matchers.length) {
    return matched;
  }

  for (const data of localeData.values()) {
    for (const key of Object.keys(data)) {
      if (matchesAnyGlob(key, matchers)) {
        matched.add(key);
      }
    }
  }

  return matched;
}
