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
  localeStats: LocaleFileStats[];
  localePreview: LocaleDiffPreview[];
  diffs: LocaleDiffEntry[];
  placeholderIssues: PlaceholderIssue[];
  emptyValueViolations: EmptyValueViolation[];
  dynamicKeyWarnings: DynamicKeyWarning[];
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
