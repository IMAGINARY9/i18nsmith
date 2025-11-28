/**
 * Syncer module - utilities for locale synchronization
 */

// Reference caching utilities
export {
  type FileFingerprint,
  type ReferenceCacheEntry,
  REFERENCE_CACHE_VERSION,
  loadReferenceCache,
  saveReferenceCache,
  clearReferenceCache,
  computeFileFingerprint,
  getCachedEntry,
} from './reference-cache.js';

// Validation utilities
export {
  type PlaceholderIssue,
  type EmptyValueViolation,
  type EmptyValueViolationReason,
  collectPlaceholderIssues,
  collectEmptyValueViolations,
} from './sync-validator.js';

// Reporting utilities
export {
  type MissingKeyRecord,
  type UnusedKeyRecord,
  type SuspiciousKeyWarning,
  type SyncValidationState,
  type BuildActionableItemsInput,
  buildActionableItems,
} from './sync-reporter.js';
