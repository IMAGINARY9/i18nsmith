import {
  Node,
  JsxExpression,
} from 'ts-morph';
import { DEFAULT_TRANSLATABLE_ATTRIBUTES, ScannerNodeCandidate } from '@i18nsmith/core';
import type { ScanCandidate } from '@i18nsmith/core';
import type { Project } from 'ts-morph';
import type { TransformCandidate } from '../types.js';
import type { I18nWriter } from './Writer.js';

interface InternalCandidate extends TransformCandidate {
  raw: ScannerNodeCandidate;
}

export class ReactWriter implements I18nWriter {
  canHandle(filePath: string): boolean {
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ['ts', 'tsx', 'js', 'jsx'].includes(ext || '');
  }

  async prepare(candidate: ScanCandidate, project?: Project): Promise<TransformCandidate | null> {
    if (candidate.kind === 'jsx-text') {
      return {
        ...candidate,
        suggestedKey: candidate.suggestedKey || 'default.key',
        hash: candidate.hash || '',
        status: 'pending',
        raw: candidate as ScannerNodeCandidate,
      } as TransformCandidate & { raw: ScannerNodeCandidate };
    }
    // other kinds
    return null;
  }

  async transform(candidate: TransformCandidate, project?: Project): Promise<{ content: string; didMutate: boolean }> {
    if (!project) {
      return { didMutate: false, content: '' };
    }
    const sourceFile = project.getSourceFile(candidate.filePath);
    if (!sourceFile) {
      return { didMutate: false, content: '' };
    }
    const didMutate = this.applyCandidate(candidate as InternalCandidate);
    return { didMutate, content: sourceFile.getFullText() };
  }

  applyCandidate(candidate: InternalCandidate): boolean {
    const node = candidate.raw.node;
    const keyCall = `t('${candidate.suggestedKey}')`;

    if (candidate.kind === 'jsx-text') {
      if (!Node.isJsxText(node)) {
        throw new Error('Candidate node mismatch for jsx-text');
      }
      const replacement = `{${keyCall}}`;
      if (node.getText() === replacement) {
        return false;
      }
      node.replaceWithText(replacement);
      return true;
    }

    if (candidate.kind === 'jsx-attribute') {
      if (!Node.isJsxAttribute(node)) {
        throw new Error('Candidate node mismatch for jsx-attribute');
      }

      const newInitializer = `{${keyCall}}`;
      const initializer = node.getInitializer();
      if (
        initializer &&
        this.normalizeTranslationSnippet(initializer.getText()) ===
          this.normalizeTranslationSnippet(newInitializer)
      ) {
        return false;
      }
      node.setInitializer(newInitializer);
      return true;
    }

    if (candidate.kind === 'jsx-expression') {
      if (!Node.isJsxExpression(node)) {
        throw new Error('Candidate node mismatch for jsx-expression');
      }

      // Guardrail (Option A): skip pluralization/concat expressions.
      const unsafeReason = this.getUnsafeJsxExpressionReason(node);
      if (unsafeReason) {
        candidate.status = 'skipped';
        candidate.reason = unsafeReason;
        return false;
      }

      // Guardrail: if this expression is used as a JSX attribute initializer,
      // only transform it when that attribute is in the Scanner allowlist.
      const parent = node.getParent();
      if (Node.isJsxAttribute(parent)) {
        const attributeName = parent.getNameNode().getText();
        if (!DEFAULT_TRANSLATABLE_ATTRIBUTES.has(attributeName)) {
          candidate.status = 'skipped';
          candidate.reason = `Non-translatable attribute: ${attributeName}`;
          return false;
        }
      }

      const expression = node.getExpression();
      if (expression) {
        if (
          this.normalizeTranslationSnippet(expression.getText()) ===
          this.normalizeTranslationSnippet(keyCall)
        ) {
          return false;
        }
        expression.replaceWithText(keyCall);
        return true;
      }
      const wrapped = `{${keyCall}}`;
      if (
        this.normalizeTranslationSnippet(node.getText()) ===
        this.normalizeTranslationSnippet(wrapped)
      ) {
        return false;
      }
      node.replaceWithText(wrapped);
      return true;
    }

    if (candidate.kind === 'call-expression') {
      if (!Node.isCallExpression(node)) {
        throw new Error('Candidate node mismatch for call-expression');
      }

      const args = node.getArguments();
      if (args.length === 0) {
        return false;
      }

      const firstArg = args[0];
      const firstArgText = firstArg.getText();

      // Skip if already translated
      if (firstArgText.startsWith("'") && firstArgText.endsWith("'")) {
        const unquoted = firstArgText.slice(1, -1);
        if (unquoted === candidate.suggestedKey) {
          return false;
        }
      }

      firstArg.replaceWithText(`'${candidate.suggestedKey}'`);
      return true;
    }

    return false;
  }

  private normalizeTranslationSnippet(snippet: string): string {
    return snippet.replace(/\s+/g, ' ').trim();
  }

  private getUnsafeJsxExpressionReason(node: JsxExpression): string | null {
    const expression = node.getExpression();
    if (!expression) {
      return null;
    }

    const text = expression.getText();

    // Skip template literals with interpolation
    if (text.includes('${') && text.includes('`')) {
      return 'Template literal with interpolation';
    }

    // Skip complex expressions (binary, conditional, etc.)
    if (expression.getKindName() === 'BinaryExpression' ||
        expression.getKindName() === 'ConditionalExpression' ||
        expression.getKindName() === 'LogicalExpression') {
      return 'Complex expression';
    }

    // Skip function calls
    if (expression.getKindName() === 'CallExpression') {
      return 'Function call expression';
    }

    return null;
  }
}