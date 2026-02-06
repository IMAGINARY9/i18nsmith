import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { createPatch } from 'diff';
import { ServiceContainer } from '../services/container';
import { loadConfigWithMeta, LocaleStore, KeyGenerator, LocaleDiffEntry, SourceFileDiffEntry } from '@i18nsmith/core';
import { PlannedChange } from '../preview-flow';

const fsp = fs.promises;

interface SourcePreviewPlan {
  change: PlannedChange;
  cleanup: () => Promise<void>;
  relativePath: string;
  diffEntry: SourceFileDiffEntry;
}

interface LocalePreviewPlanResult {
  changes: PlannedChange[];
  cleanup: () => Promise<void>;
  detailLines: string[];
  primaryLocalePath?: string;
  diffs: LocaleDiffEntry[];
}

export class ExtractionController implements vscode.Disposable {
  constructor(private readonly services: ServiceContainer) {}

  dispose() {
    // No resources to dispose
  }

  public async extractKeyFromSelection(uri: vscode.Uri, range: vscode.Range, text: string) {
    this.services.logVerbose(`extractKeyFromSelection called with: ${uri.fsPath}`);

    const document = await vscode.workspace.openTextDocument(uri);
    const selectionText = document.getText(range) || text;
    
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder found');
      return;
    }

    let meta: Awaited<ReturnType<typeof loadConfigWithMeta>>;
    try {
      meta = await loadConfigWithMeta(undefined, { cwd: workspaceFolder.uri.fsPath });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to load i18nsmith config: ${error}`);
      return;
    }

    // Use KeyGenerator to propose a key
    const generator = new KeyGenerator({
      namespace: meta.config.keyGeneration?.namespace,
      hashLength: meta.config.keyGeneration?.shortHashLen,
      workspaceRoot: workspaceFolder.uri.fsPath,
    });

    const generated = generator.generate(selectionText, {
      filePath: uri.fsPath,
      kind: 'jsx-text', // Default assumption, could be refined
    });

    const key = await vscode.window.showInputBox({
      prompt: 'Enter the translation key',
      value: generated.key,
      placeHolder: 'e.g., common.greeting',
    });

    if (!key) {
      return;
    }

    const literalValue = this.normalizeSelectedLiteral(selectionText || text);
    const replacement = this.buildReplacement(document, range, selectionText, key);

    const sourceChange = await this.createSourceFilePreviewChange(document, range, replacement, workspaceFolder.uri.fsPath);

    const localeValues = new Map<string, string>();
    const sourceLocale = meta.config.sourceLanguage ?? 'en';
    localeValues.set(sourceLocale, literalValue);
    const placeholderSeed = meta.config.sync?.seedValue ?? `[TODO: ${key}]`;
    for (const locale of meta.config.targetLanguages ?? []) {
      if (!locale || localeValues.has(locale)) {
        continue;
      }
      localeValues.set(locale, placeholderSeed);
    }

    const localePlan = await this.createLocalePreviewPlan(meta, key, localeValues, { primaryLocale: sourceLocale });
    if (!localePlan) {
      await sourceChange.cleanup();
      vscode.window.showWarningMessage(`Key '${key}' already exists in the configured locale files.`);
      return;
    }

    const cleanupTasks = [sourceChange.cleanup, localePlan.cleanup];
    
    // Use the shared DiffPreviewService
    this.services.previewShown = true;
    await this.services.diffPreviewService.showPreview(
      [sourceChange.diffEntry, ...localePlan.diffs],
      async () => {
        try {
          await sourceChange.change.apply();
          for (const change of localePlan.changes) {
            await change.apply();
          }
          this.services.hoverProvider.clearCache();
          this.services.reportWatcher.refresh();
          vscode.window.showInformationMessage(`Extracted as '${key}'`);
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to apply extraction: ${e}`);
        } finally {
          await Promise.all(cleanupTasks.map((fn) => fn().catch(() => {})));
        }
      },
      {
        title: 'Extract Key Preview',
        detail: `Extract '${key}' and update ${localePlan.changes.length} locale files. Apply changes?`,
      }
    );
  }

  private normalizeSelectedLiteral(text: string): string {
    const trimmed = text.trim();
    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      return trimmed.slice(1, -1);
    }
    if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  /**
   * Build the replacement string based on the document type and cursor position.
   * - JSX files: `{t('key')}` for JSX text, `t('key')` for attributes
   * - Vue template: `{{ $t('key') }}` for text, `$t('key')` for attributes
   * - Vue script / other: `t('key')`
   */
  private buildReplacement(
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string,
    key: string
  ): string {
    if (document.languageId === 'vue') {
      const inTemplate = this.isInsideVueTemplate(document, range.start);
      if (inTemplate) {
        const trimmed = selectedText.trim();
        const isPlainText = !/^['"`]/.test(trimmed) && /[A-Za-z0-9]/.test(trimmed);
        const charBefore = this.getCharBefore(document, range.start);
        const charAfter = this.getCharAfter(document, range.end);
        const isBoundary =
          (!charBefore || charBefore === '>' || /\s/.test(charBefore)) &&
          (!charAfter || charAfter === '<' || /\s/.test(charAfter));
        if (isPlainText && isBoundary) {
          return `{{ $t('${key}') }}`;
        }
        return `$t('${key}')`;
      }
      // Inside <script> – use standard t()
      return `t('${key}')`;
    }

    const wrapInJsx = this.shouldWrapSelectionInJsx(document, range, selectedText);
    return wrapInJsx ? `{t('${key}')}` : `t('${key}')`;
  }

  /**
   * Rough heuristic: check if the position is inside a <template> block in a Vue SFC.
   */
  private isInsideVueTemplate(document: vscode.TextDocument, position: vscode.Position): boolean {
    const text = document.getText();
    const offset = document.offsetAt(position);

    // Find the last <template...> before offset
    const templateOpenRe = /<template[^>]*>/gi;
    const templateCloseRe = /<\/template>/gi;

    let lastTemplateOpen = -1;
    let lastTemplateClose = -1;

    let m: RegExpExecArray | null;
    while ((m = templateOpenRe.exec(text)) !== null) {
      if (m.index + m[0].length <= offset) {
        lastTemplateOpen = m.index + m[0].length;
      }
    }
    while ((m = templateCloseRe.exec(text)) !== null) {
      if (m.index <= offset) {
        lastTemplateClose = m.index;
      }
    }

    // If the last <template> open tag is after the last </template> close tag
    // and both are before our offset, we're inside the template
    return lastTemplateOpen > -1 && lastTemplateOpen > lastTemplateClose;
  }

  private shouldWrapSelectionInJsx(
    document: vscode.TextDocument,
    range: vscode.Range,
    selectedText: string
  ): boolean {
    const trimmed = selectedText.trim();
    if (!trimmed) {
      return false;
    }

    if (/^['"`]/.test(trimmed)) {
      return false;
    }

    if (!['typescriptreact', 'javascriptreact'].includes(document.languageId)) {
      return false;
    }

    if (!/[A-Za-z0-9]/.test(trimmed)) {
      return false;
    }

    const charBefore = this.getCharBefore(document, range.start);
    const charAfter = this.getCharAfter(document, range.end);
    const beforeIsBoundary = !charBefore || charBefore === '>' || /\s/.test(charBefore);
    const afterIsBoundary = !charAfter || charAfter === '<' || /\s/.test(charAfter);

    return beforeIsBoundary && afterIsBoundary;
  }

  private getCharBefore(document: vscode.TextDocument, position: vscode.Position): string | undefined {
    if (position.character > 0) {
      const start = position.translate(0, -1);
      return document.getText(new vscode.Range(start, position));
    }
    if (position.line === 0) {
      return undefined;
    }
    return '\n';
  }

  private getCharAfter(document: vscode.TextDocument, position: vscode.Position): string | undefined {
    const line = document.lineAt(position.line);
    if (position.character < line.text.length) {
      const end = position.translate(0, 1);
      return document.getText(new vscode.Range(position, end));
    }
    if (position.line >= document.lineCount - 1) {
      return undefined;
    }
    return '\n';
  }

  private async createSourceFilePreviewChange(
    document: vscode.TextDocument,
    range: vscode.Range,
    replacement: string,
    workspaceRoot?: string
  ): Promise<SourcePreviewPlan> {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-extract-source-'));
    const baseName = path.basename(document.uri.fsPath) || 'source';
    const beforePath = path.join(tempDir, `before-${baseName}`);
    const afterPath = path.join(tempDir, `after-${baseName}`);
    const beforeText = document.getText();
    const startOffset = document.offsetAt(range.start);
    const endOffset = document.offsetAt(range.end);
    const afterText = beforeText.slice(0, startOffset) + replacement + beforeText.slice(endOffset);

    await fsp.writeFile(beforePath, beforeText, 'utf8');
    await fsp.writeFile(afterPath, afterText, 'utf8');

    const relativePath = workspaceRoot ? path.relative(workspaceRoot, document.uri.fsPath) : document.uri.fsPath;

    const diff = createPatch(relativePath, beforeText, afterText);
    const diffEntry: SourceFileDiffEntry = {
      path: document.uri.fsPath,
      relativePath,
      diff,
      changes: 1,
    };

    const change: PlannedChange = {
      label: relativePath,
      beforeUri: vscode.Uri.file(beforePath),
      afterUri: vscode.Uri.file(afterPath),
      summary: 'Source',
      apply: async () => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, replacement);
        const success = await vscode.workspace.applyEdit(edit);
        if (!success) {
          throw new Error('Failed to update source file.');
        }
      },
    };

    const cleanup = async () => {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    };

    return { change, cleanup, relativePath, diffEntry };
  }

  private async createLocalePreviewPlan(
    meta: Awaited<ReturnType<typeof loadConfigWithMeta>>,
    key: string,
    localeValues: Map<string, string>,
    options: { primaryLocale?: string } = {}
  ): Promise<LocalePreviewPlanResult | null> {
    if (!localeValues.size) {
      return null;
    }

    const localesDir = path.join(meta.projectRoot, meta.config.localesDir ?? 'locales');
    const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-locale-preview-'));
    const previewLocalesDir = path.join(tempRoot, 'locales');
    await fsp.mkdir(previewLocalesDir, { recursive: true });

    const store = new LocaleStore(previewLocalesDir, {
      format: meta.config.locales?.format ?? 'auto',
      delimiter: meta.config.locales?.delimiter ?? '.',
      sortKeys: meta.config.locales?.sortKeys ?? 'alphabetical',
    });

    const beforeSnapshots = new Map<string, string>();

    for (const locale of localeValues.keys()) {
      const originalPath = path.join(localesDir, `${locale}.json`);
      let originalContent: string;
      try {
        originalContent = await fsp.readFile(originalPath, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          originalContent = '{}\n';
        } else {
          await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
      }

      beforeSnapshots.set(locale, originalContent);
      const previewPath = path.join(previewLocalesDir, `${locale}.json`);
      await fsp.mkdir(path.dirname(previewPath), { recursive: true });
      await fsp.writeFile(previewPath, originalContent, 'utf8');
    }

    for (const [locale, value] of localeValues) {
      await store.upsert(locale, key, value);
    }
    await store.flush();

    const changes: PlannedChange[] = [];
    const detailLines: string[] = ['Locale files:'];
    const diffs: LocaleDiffEntry[] = [];

    for (const locale of localeValues.keys()) {
      const originalContent = beforeSnapshots.get(locale) || '';
      const previewPath = path.join(previewLocalesDir, `${locale}.json`);
      const newContent = await fsp.readFile(previewPath, 'utf8');
      
      // Create temp files for diff
      const localeTempDir = await fsp.mkdtemp(path.join(os.tmpdir(), `i18nsmith-diff-${locale}-`));
      const beforeFile = path.join(localeTempDir, `before-${locale}.json`);
      const afterFile = path.join(localeTempDir, `after-${locale}.json`);
      
      await fsp.writeFile(beforeFile, originalContent, 'utf8');
      await fsp.writeFile(afterFile, newContent, 'utf8');

      changes.push({
        label: `${locale}.json`,
        beforeUri: vscode.Uri.file(beforeFile),
        afterUri: vscode.Uri.file(afterFile),
        summary: locale === options.primaryLocale ? 'Source Locale' : 'Target Locale',
        apply: async () => {
          const targetPath = path.join(localesDir, `${locale}.json`);
          await fsp.mkdir(path.dirname(targetPath), { recursive: true });
          await fsp.writeFile(targetPath, newContent, 'utf8');
        },
      });
      
      // Generate diff entry for preview
      const patch = createPatch(`${locale}.json`, originalContent, newContent);
      diffs.push({
        locale,
        path: path.join(localesDir, `${locale}.json`),
        diff: patch,
        added: [key],
        updated: [],
        removed: [],
      });

      detailLines.push(`- ${locale}.json: +1 key`);
    }

    const cleanup = async () => {
      await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    };

    return { changes, cleanup, detailLines, diffs };
  }
}
