import MagicString from 'magic-string';
import { parse } from 'vue-eslint-parser';
import type { TransformCandidate } from '../types.js';
import type { I18nWriter } from './Writer.js';

export class VueWriter implements I18nWriter {
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.vue');
  }

  async transform(filePath: string, content: string, candidates: TransformCandidate[]): Promise<{ content: string; didMutate: boolean }> {
    const magicString = new MagicString(content);
    let didMutate = false;

    // Process each candidate using position information
    for (const candidate of candidates) {
      if (candidate.status !== 'pending' && candidate.status !== 'existing') {
        continue;
      }

      const success = this.applyCandidate(candidate, content, magicString);
      if (success) {
        candidate.status = 'applied';
        didMutate = true;
      }
    }

    return {
      content: didMutate ? magicString.toString() : content,
      didMutate
    };
  }

  private applyCandidate(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // For Vue files, we need to handle different types of content based on the candidate kind
    switch (candidate.kind) {
      case 'jsx-text':
        return this.transformText(candidate, content, magicString);

      case 'jsx-attribute':
        return this.transformAttribute(candidate, content, magicString);

      case 'jsx-expression':
        return this.transformExpression(candidate, content, magicString);

      case 'call-expression':
        return this.transformCallExpression(candidate, content, magicString);

      default:
        return false;
    }
  }

  private transformText(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Vue text content becomes {{ $t('key') }}
    const replacement = `{{ $t('${candidate.suggestedKey}') }}`;

    // Find the text at the specified position
    const lines = content.split('\n');
    if (candidate.position.line > lines.length) {
      return false;
    }

    const line = lines[candidate.position.line - 1]; // position.line is 1-based
    const lineStart = content.indexOf(line);
    const absoluteIndex = lineStart + candidate.position.column - 1; // position.column is 1-based

    // Check if the text matches at this position
    if (content.substr(absoluteIndex, candidate.text.length) === candidate.text) {
      magicString.overwrite(absoluteIndex, absoluteIndex + candidate.text.length, replacement);
      return true;
    }

    return false;
  }

  private transformAttribute(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Vue attributes can be static or dynamic (v-bind:)
    const replacement = `{{ $t('${candidate.suggestedKey}') }}`;

    // Find the attribute value at the specified position
    const lines = content.split('\n');
    if (candidate.position.line > lines.length) {
      return false;
    }

    const line = lines[candidate.position.line - 1];
    const lineStart = content.indexOf(line);
    const absoluteIndex = lineStart + candidate.position.column - 1;

    // Check if the text matches at this position
    if (content.substr(absoluteIndex, candidate.text.length) === candidate.text) {
      magicString.overwrite(absoluteIndex, absoluteIndex + candidate.text.length, replacement);
      return true;
    }

    return false;
  }

  private transformExpression(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Vue expressions in {{ }} become $t('key')
    const replacement = `$t('${candidate.suggestedKey}')`;

    // Find the expression at the specified position
    const lines = content.split('\n');
    if (candidate.position.line > lines.length) {
      return false;
    }

    const line = lines[candidate.position.line - 1];
    const lineStart = content.indexOf(line);
    const absoluteIndex = lineStart + candidate.position.column - 1;

    // Check if the text matches at this position
    if (content.substr(absoluteIndex, candidate.text.length) === candidate.text) {
      magicString.overwrite(absoluteIndex, absoluteIndex + candidate.text.length, replacement);
      return true;
    }

    return false;
  }

  private transformCallExpression(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Handle existing i18n calls or string literals in script sections
    const replacement = `$t('${candidate.suggestedKey}')`;

    // Find the call/string at the specified position
    const lines = content.split('\n');
    if (candidate.position.line > lines.length) {
      return false;
    }

    const line = lines[candidate.position.line - 1];
    const lineStart = content.indexOf(line);
    const absoluteIndex = lineStart + candidate.position.column - 1;

    // Check if the text matches at this position
    if (content.substr(absoluteIndex, candidate.text.length) === candidate.text) {
      magicString.overwrite(absoluteIndex, absoluteIndex + candidate.text.length, replacement);
      return true;
    }

    return false;
  }
}