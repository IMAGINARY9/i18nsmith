import type { I18nConfig } from './types.js';

export interface ConfigValidationIssue {
  field: string;
  message: string;
}
function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}
const SHELL_META_PATTERN = /[;"'`|&<>$]/;
const LANGUAGE_TAG_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const NAMESPACE_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_PATH_LIKE_LENGTH = 320;
const MAX_GLOB_LENGTH = 512;
export function hasUnsafeConfigValue(value: string): boolean {
  return containsControlCharacters(value) || SHELL_META_PATTERN.test(value);
}

export function isSafeLanguageTag(value: string): boolean {
  return LANGUAGE_TAG_PATTERN.test(value);
}

export function isSafeTranslationIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

export function isSafeNamespace(value: string): boolean {
  return NAMESPACE_PATTERN.test(value);
}

function validatePathLike(field: string, value: string, issues: ConfigValidationIssue[]) {
  if (!value.trim()) {
    issues.push({ field, message: 'must not be empty' });
    return;
  }
  if (value.length > MAX_PATH_LIKE_LENGTH) {
    issues.push({ field, message: `must be shorter than ${MAX_PATH_LIKE_LENGTH} characters` });
    return;
  }
  if (hasUnsafeConfigValue(value)) {
    issues.push({ field, message: 'contains control characters or shell metacharacters' });
  }
}

function validateLanguage(field: string, value: string, issues: ConfigValidationIssue[]) {
  if (!value.trim()) {
    issues.push({ field, message: 'must not be empty' });
    return;
  }
  if (!isSafeLanguageTag(value)) {
    issues.push({ field, message: 'must be an alphanumeric language tag (letters, numbers, "-", "_")' });
  }
}

function validateIdentifier(field: string, value: string, issues: ConfigValidationIssue[]) {
  if (!value.trim()) {
    issues.push({ field, message: 'must not be empty' });
    return;
  }
  if (!isSafeTranslationIdentifier(value)) {
    issues.push({ field, message: 'must be a valid JavaScript identifier' });
  }
}

function validateNamespace(field: string, value: string, issues: ConfigValidationIssue[]) {
  if (!value.trim()) {
    issues.push({ field, message: 'must not be empty' });
    return;
  }
  if (!isSafeNamespace(value)) {
    issues.push({ field, message: 'may only contain letters, numbers, dot, dash, or underscore' });
  }
}

function validateStringList(field: string, values: string[] | undefined, issues: ConfigValidationIssue[]) {
  if (!values?.length) {
    return;
  }
  values.forEach((entry, index) => {
    const targetField = `${field}[${index}]`;
    if (!entry.trim()) {
      issues.push({ field: targetField, message: 'must not be empty' });
      return;
    }
    if (entry.length > MAX_GLOB_LENGTH) {
      issues.push({ field: targetField, message: `must be shorter than ${MAX_GLOB_LENGTH} characters` });
      return;
    }
    if (hasUnsafeConfigValue(entry)) {
      issues.push({ field: targetField, message: 'contains control characters or shell metacharacters' });
    }
  });
}

export function validateConfig(config: I18nConfig): ConfigValidationIssue[] {
  const issues: ConfigValidationIssue[] = [];
  const sync = config.sync ?? {
    translationIdentifier: 't',
    dynamicKeyAssumptions: [],
    dynamicKeyGlobs: [],
  };
  const keyGeneration = config.keyGeneration ?? {
    namespace: 'common',
    shortHashLen: 6,
  };

  validatePathLike('localesDir', config.localesDir, issues);
  validateLanguage('sourceLanguage', config.sourceLanguage, issues);
    config.targetLanguages.forEach((lang, index) => {
      validateLanguage(`targetLanguages[${index}]`, lang, issues);
    });

    const translationIdentifier = sync.translationIdentifier ?? 't';
    const namespace = keyGeneration.namespace ?? 'common';
  const hashLength = keyGeneration.shortHashLen ?? 6;

    validateIdentifier('sync.translationIdentifier', translationIdentifier, issues);
    validateNamespace('keyGeneration.namespace', namespace, issues);

  if (hashLength < 4 || hashLength > 32) {
    issues.push({
      field: 'keyGeneration.shortHashLen',
      message: 'must be between 4 and 32 characters to keep hashes practical',
    });
  }

  validateStringList('include', config.include, issues);
  validateStringList('exclude', config.exclude, issues);
  validateStringList('sync.dynamicKeyAssumptions', sync.dynamicKeyAssumptions, issues);
  validateStringList('sync.dynamicKeyGlobs', sync.dynamicKeyGlobs, issues);

  if (config.frameworks) {
    validateStringList('frameworks', config.frameworks, issues);
  }

  return issues;
}

export function assertConfigValid(config: I18nConfig): void {
  const issues = validateConfig(config);
  if (!issues.length) {
    return;
  }

  const details = issues.map((issue) => `• ${issue.field}: ${issue.message}`).join('\n');
  throw new Error(`Invalid i18nsmith configuration:\n${details}`);
}
