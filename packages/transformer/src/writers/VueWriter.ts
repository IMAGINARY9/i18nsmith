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

    // Parse Vue SFC to identify template and script sections
    // For now, we'll implement basic template transformation
    // In a full implementation, we'd use vue-eslint-parser or @vue/compiler-sfc

    for (const candidate of candidates) {
      if (candidate.status !== 'pending' && candidate.status !== 'existing') {
        continue;
      }

      // For Vue templates, we need to handle different types of text content
      if (candidate.kind === 'jsx-text') {
        // Convert JSX text to Vue interpolation
        // This is a simplified implementation - real implementation would need AST parsing
        const replacement = `{{ $t('${candidate.suggestedKey}') }}`;

        // Find and replace in template section (simplified)
        const templateMatch = content.match(/<template[^>]*>([\s\S]*?)<\/template>/);
        if (templateMatch) {
          const templateContent = templateMatch[1];
          const index = templateMatch.index! + templateMatch[0].indexOf(templateContent);

          // This is a very basic implementation - real implementation needs proper AST
          if (templateContent.includes(candidate.text)) {
            const relativeIndex = templateContent.indexOf(candidate.text);
            const absoluteIndex = index + relativeIndex;

            magicString.overwrite(absoluteIndex, absoluteIndex + candidate.text.length, replacement);
            candidate.status = 'applied';
            didMutate = true;
          }
        }
      }

      // Handle other candidate types...
      // jsx-attribute, jsx-expression, call-expression
    }

    return {
      content: didMutate ? magicString.toString() : content,
      didMutate
    };
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}