// Public API - Core functionality used by CLI and extension
export * from './config.js';
export * from './scanner.js';
export * from './key-generator.js';
export * from './key-validator.js';
export * from './locale-store.js';
export * from './syncer.js';
export * from './key-renamer.js';
export * from './diagnostics.js';
export * from './check-runner.js';
export * from './diff-utils.js';
export * from './translation-service.js';
export * from './suspicious-key-renamer.js';
export * from './backup.js';
export * from './gitignore.js';
export * from './utils/dependency-resolution.js';

// Framework Support
export * from './framework/index.js';

// Project Intelligence
export * from './project-intelligence/index.js';

// Internal API - Implementation details (not recommended for external use)
export * from './reference-extractor.js';
export * from './placeholders.js';
export * from './actionable.js';
export * from './locale-validator.js';
export * from './value-generator.js';
export * from './project-factory.js';
