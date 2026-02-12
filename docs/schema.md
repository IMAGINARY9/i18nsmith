# CLI Report Schemas

schemaVersion: 1

## CheckSummary
```ts
interface CheckSummary {
  diagnostics: DiagnosisReport;
  sync: SyncSummary;
  actionableItems: ActionableItem[];
  suggestedCommands: CheckSuggestedCommand[];
  hasConflicts: boolean;
  hasDrift: boolean;
  hasHardcodedText: boolean;
  timestamp: string;
}
```

## SyncSummary
```ts
interface SyncSummary {
  filesScanned: number;
  references: TranslationReference[];
  missingKeys: MissingKeyRecord[];
  unusedKeys: UnusedKeyRecord[];
  untranslatedKeys: UnusedKeyRecord[];
  localeStats: LocaleFileStats[];
  localePreview: LocaleDiffPreview[];
  diffs: LocaleDiffEntry[];
  localeDiffs?: LocaleDiffEntry[];
  renameDiffs?: SourceFileDiffEntry[];
  placeholderIssues: PlaceholderIssue[];
  emptyValueViolations: EmptyValueViolation[];
  dynamicKeyWarnings: DynamicKeyWarning[];
  dynamicKeyCoverage: DynamicKeyCoverage[];
  suspiciousKeys: SuspiciousKeyWarning[];
  validation: SyncValidationState;
  assumedKeys: string[];
  write: boolean;
  actionableItems: ActionableItem[];
  backup?: BackupResult;
}
```

## TranslateSummary
```ts
interface TranslateSummary {
  provider: string;
  dryRun: boolean;
  plan: TranslationPlan;
  locales: TranslateLocaleResult[];
  localeStats: Awaited<ReturnType<TranslationService['flush']>>;
  totalCharacters: number;
}
```
