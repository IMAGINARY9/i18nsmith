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

export function generateValueFromKey(key: string): string {
  if (typeof key !== 'string' || key.trim().length === 0) {
    return '';
  }

  // Use only the last segment of dotted keys for cleaner output
  const base = key.includes('.') ? extractLastSegment(key) : key;

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
