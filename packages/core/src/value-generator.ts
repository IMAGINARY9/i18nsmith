const WORD_BREAK_PATTERN = /[._\-/]+/g;
const CAMEL_SPLIT_PATTERN = /([a-z0-9])([A-Z])/g;
const ACRONYM_SPLIT_PATTERN = /([A-Z]+)([A-Z][a-z])/g;
const NAMESPACE_DELIMITER = /\./;

const normalizeWhitespace = (input: string): string => input.replace(/\s+/g, ' ').trim();

const formatWord = (word: string): string => {
  if (!word) {
    return '';
  }

  const isAcronym = word.length > 1 && word === word.toUpperCase();
  if (isAcronym) {
    return word;
  }

  return word[0].toUpperCase() + word.slice(1).toLowerCase();
};

const extractLastSegment = (key: string): string => {
  const segments = key.split(NAMESPACE_DELIMITER);
  return segments[segments.length - 1] ?? key;
};

/**
 * Check if a string looks like a hash (hexadecimal characters, typical hash length)
 */
const looksLikeHash = (segment: string): boolean => {
  // Common hash lengths: 4, 6, 8, 12, 16, 32, 40, 64
  const commonHashLengths = [4, 6, 8, 12, 16, 32, 40, 64];
  if (!commonHashLengths.includes(segment.length)) {
    return false;
  }

  // Must contain only hexadecimal characters (case insensitive)
  return /^[0-9a-f]+$/i.test(segment);
};

/**
 * Extract a meaningful segment from a key, avoiding hash-like segments
 */
const extractMeaningfulSegment = (key: string): string => {
  const segments = key.split(NAMESPACE_DELIMITER);

  // Try segments from right to left, skipping hash-like ones
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!looksLikeHash(segment)) {
      return segment;
    }
  }

  // If all segments look like hashes, use the last one as fallback
  return segments[segments.length - 1] ?? key;
};

export function generateValueFromKey(key: string): string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return '';
  }

  // Use a meaningful segment, avoiding hash-like segments when possible
  const base = key.includes('.') ? extractMeaningfulSegment(key) : key;

  const punctuated = base
    .replace(WORD_BREAK_PATTERN, ' ')
    .replace(CAMEL_SPLIT_PATTERN, '$1 $2')
    .replace(ACRONYM_SPLIT_PATTERN, '$1 $2');

  const normalized = normalizeWhitespace(punctuated.replace(/[^a-zA-Z0-9 ]+/g, ' '));
  if (!normalized) {
    return '';
  }

  const tokens = normalized.split(' ').filter(Boolean);
  const formatted: string[] = [];
  let lastTokenLower: string | undefined;

  for (const token of tokens) {
    const word = formatWord(token);
    if (!word) {
      continue;
    }

    const lower = word.toLowerCase();
    if (lastTokenLower === lower) {
      continue;
    }

    formatted.push(word);
    lastTokenLower = lower;
  }

  return formatted.join(' ');
}
