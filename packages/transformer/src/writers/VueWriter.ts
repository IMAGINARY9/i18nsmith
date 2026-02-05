import MagicString from 'magic-string';
import type { TransformCandidate } from '../types.js';
import type { I18nWriter } from './Writer.js';

export class VueWriter implements I18nWriter {
  canHandle(filePath: string): boolean {
    return filePath.endsWith('.vue');
  }

  async transform(filePath: string, content: string, candidates: TransformCandidate[]): Promise<{ content: string; didMutate: boolean }> {
    const magicString = new MagicString(content);
    let didMutate = false;

    // Sort candidates by position in reverse order to avoid offset issues
    const sortedCandidates = [...candidates].sort((a, b) => {
      if (a.position.line !== b.position.line) {
        return b.position.line - a.position.line;
      }
      return b.position.column - a.position.column;
    });

    // Process each candidate using position information
    for (const candidate of sortedCandidates) {
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

  /**
   * Find the absolute character offset of the candidate text in the content.
   * Handles both 0-based and 1-based column numbering from different parsers.
   * Also handles cases where the candidate text was cleaned (whitespace trimmed).
   */
  private findCandidateOffset(candidate: TransformCandidate, content: string): { start: number; end: number } | null {
    let lineStart = 0;
    // Walk to the start of the line (1-based line numbers)
    for (let i = 1; i < candidate.position.line; i++) {
        const nextNewline = content.indexOf('\n', lineStart);
        if (nextNewline === -1) break;
        lineStart = nextNewline + 1;
    }

    // Get the full line for searching
    const lineEnd = content.indexOf('\n', lineStart);
    const lineContent = lineEnd === -1 ? content.substring(lineStart) : content.substring(lineStart, lineEnd);

    // Strategy 1: Try exact position with 0-based column (standard AST like vue-eslint-parser)
    let absoluteIndex = lineStart + candidate.position.column;
    if (absoluteIndex >= 0 && absoluteIndex < content.length) {
      if (content.substr(absoluteIndex, candidate.text.length) === candidate.text) {
        return { start: absoluteIndex, end: absoluteIndex + candidate.text.length };
      }
    }
    
    // Strategy 2: Try 1-based column (fallback parsers)
    absoluteIndex = lineStart + candidate.position.column - 1;
    if (absoluteIndex >= 0 && absoluteIndex < content.length) {
      if (content.substr(absoluteIndex, candidate.text.length) === candidate.text) {
        return { start: absoluteIndex, end: absoluteIndex + candidate.text.length };
      }
    }

    // Strategy 3: Search for the text anywhere on the line (handles cleaned/trimmed text)
    const indexInLine = lineContent.indexOf(candidate.text);
    if (indexInLine !== -1) {
      const start = lineStart + indexInLine;
      return { start, end: start + candidate.text.length };
    }

    // Strategy 4: Search for text with possible surrounding whitespace
    // The candidate.text might be trimmed but original has whitespace
    const escapedText = candidate.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const whitespaceAwarePattern = new RegExp(`(\\s*)(${escapedText})(\\s*)`, 'g');
    let match;
    
    // Search near the expected position first (within a few lines)
    const searchStart = Math.max(0, lineStart - 200);
    const searchEnd = Math.min(content.length, lineStart + 500);
    const searchContent = content.substring(searchStart, searchEnd);
    
    whitespaceAwarePattern.lastIndex = 0;
    while ((match = whitespaceAwarePattern.exec(searchContent)) !== null) {
      const matchStart = searchStart + match.index + match[1].length;
      const matchEnd = matchStart + candidate.text.length;
      // Prefer matches closer to the expected line
      if (Math.abs(matchStart - lineStart) < 500) {
        return { start: matchStart, end: matchEnd };
      }
    }

    return null;
  }

  private transformText(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Vue text content becomes {{ $t('key') }}
    const replacement = `{{ $t('${candidate.suggestedKey}') }}`;
    const offset = this.findCandidateOffset(candidate, content);

    if (offset) {
      magicString.overwrite(offset.start, offset.end, replacement);
      return true;
    }

    return false;
  }

  private transformAttribute(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Vue attributes can be static or dynamic (v-bind:)
    // We need to convert static attribute to bound attribute
    // e.g. title="This is a tooltip" -> :title="$t('key')"
    
    // The candidate position points to the text content (after opening quote)
    // We need to find the full attribute and replace it
    const offset = this.findCandidateOffset(candidate, content);
    if (!offset) return false;

    // Find the attribute name by looking backwards from the position
    let attrStart = offset.start;
    while (attrStart > 0 && content[attrStart - 1] !== ' ' && content[attrStart - 1] !== '\t' && content[attrStart - 1] !== '\n' && content[attrStart - 1] !== '<') {
      attrStart--;
    }
    
    // Extract the attribute name
    const attrText = content.substring(attrStart, offset.end + 1); // +1 for closing quote
    const attrNameMatch = attrText.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
    if (!attrNameMatch) return false;
    
    const attrName = attrNameMatch[1];
    
    // Replace the entire attribute with dynamic binding
    const replacement = `:${attrName}="$t('${candidate.suggestedKey}')"`;
    magicString.overwrite(attrStart, attrStart + attrText.length, replacement);
    return true;
  }

  private transformExpression(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Vue expressions in {{ }} become $t('key')
    const replacement = `$t('${candidate.suggestedKey}')`;
    const offset = this.findCandidateOffset(candidate, content);

    if (offset) {
      magicString.overwrite(offset.start, offset.end, replacement);
      return true;
    }

    return false;
  }

  private transformCallExpression(candidate: TransformCandidate, content: string, magicString: MagicString): boolean {
    // Handle existing i18n calls or string literals in script sections
    const replacement = `$t('${candidate.suggestedKey}')`;
    const offset = this.findCandidateOffset(candidate, content);

    if (offset) {
      magicString.overwrite(offset.start, offset.end, replacement);
      return true;
    }

    return false;
  }
}