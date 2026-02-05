import MagicString from 'magic-string';
export class VueWriter {
    canHandle(filePath) {
        return filePath.endsWith('.vue');
    }
    async transform(filePath, content, candidates) {
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
    applyCandidate(candidate, content, magicString) {
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
    findCandidateOffset(candidate, content, options = {}) {
        const lines = content.split('\n');
        if (candidate.position.line < 1 || candidate.position.line > lines.length) {
            return null;
        }
        const lineIndex = candidate.position.line - 1;
        const lineStarts = [0];
        for (let i = 0; i < lines.length - 1; i++) {
            lineStarts.push(lineStarts[i] + lines[i].length + 1);
        }
        const lineStart = lineStarts[lineIndex] ?? 0;
        const lineContent = lines[lineIndex] ?? '';
        const lineEnd = lineStart + lineContent.length;
        const tryExactAt = (column) => {
            if (column < 0 || column > lineContent.length) {
                return null;
            }
            const absoluteIndex = lineStart + column;
            if (content.substr(absoluteIndex, candidate.text.length) === candidate.text) {
                return { start: absoluteIndex, end: absoluteIndex + candidate.text.length };
            }
            return null;
        };
        const findQuotedMatch = () => {
            if (!options.includeQuotes) {
                return null;
            }
            const searchLineStart = Math.max(0, lineIndex - 2);
            const searchLineEnd = Math.min(lines.length - 1, lineIndex + 2);
            const searchStart = lineStarts[searchLineStart] ?? 0;
            const searchContent = lines.slice(searchLineStart, searchLineEnd + 1).join('\n');
            const targetIndex = lineStart + Math.max(candidate.position.column - 1, 0);
            const quoteVariants = ["'", '"', '`']
                .map((quote) => `${quote}${candidate.text.replace(/\\/g, '\\\\')}${quote}`);
            let bestMatch = null;
            for (const variant of quoteVariants) {
                let searchIndex = 0;
                while (searchIndex < searchContent.length) {
                    const found = searchContent.indexOf(variant, searchIndex);
                    if (found === -1) {
                        break;
                    }
                    const absoluteStart = searchStart + found;
                    const absoluteEnd = absoluteStart + variant.length;
                    const distance = Math.abs(absoluteStart - targetIndex);
                    if (!bestMatch || distance < bestMatch.distance) {
                        bestMatch = { start: absoluteStart, end: absoluteEnd, distance };
                    }
                    searchIndex = found + variant.length;
                }
            }
            const maxDistance = Math.max(lineContent.length * 2, 120);
            if (bestMatch && bestMatch.distance <= maxDistance) {
                return { start: bestMatch.start, end: bestMatch.end };
            }
            return null;
        };
        if (options.preferQuoted) {
            const quoted = findQuotedMatch();
            if (quoted) {
                return quoted;
            }
        }
        // Strategy 1: Try exact position with 0-based column
        const exactZero = tryExactAt(candidate.position.column);
        if (exactZero) {
            return exactZero;
        }
        // Strategy 2: Try 1-based column
        const exactOne = tryExactAt(candidate.position.column - 1);
        if (exactOne) {
            return exactOne;
        }
        // Strategy 3: Search for quoted literals near the expected line when requested
        const quotedFallback = findQuotedMatch();
        if (quotedFallback) {
            return quotedFallback;
        }
        // Strategy 4: Search for multi-line text around the expected line
        if (candidate.text.includes('\n')) {
            const windowStart = Math.max(0, lineStart - 200);
            const windowEnd = Math.min(content.length, lineEnd + 200);
            const windowContent = content.slice(windowStart, windowEnd);
            const indexInWindow = windowContent.indexOf(candidate.text);
            if (indexInWindow !== -1) {
                const start = windowStart + indexInWindow;
                return { start, end: start + candidate.text.length };
            }
        }
        // Strategy 5: Search for the text on the same line
        const indexInLine = lineContent.indexOf(candidate.text);
        if (indexInLine !== -1) {
            const start = lineStart + indexInLine;
            return { start, end: start + candidate.text.length };
        }
        // Strategy 6: Search nearby lines for slight line mismatches
        const neighborStart = Math.max(0, lineIndex - 1);
        const neighborEnd = Math.min(lines.length - 1, lineIndex + 1);
        const neighborContent = lines.slice(neighborStart, neighborEnd + 1).join('\n');
        const neighborOffset = lineStarts[neighborStart] ?? 0;
        const targetIndex = lineStart + Math.max(candidate.position.column - 1, 0);
        let searchIndex = 0;
        let bestNeighbor = null;
        while (searchIndex < neighborContent.length) {
            const found = neighborContent.indexOf(candidate.text, searchIndex);
            if (found === -1) {
                break;
            }
            const absoluteStart = neighborOffset + found;
            const absoluteEnd = absoluteStart + candidate.text.length;
            const distance = Math.abs(absoluteStart - targetIndex);
            if (!bestNeighbor || distance < bestNeighbor.distance) {
                bestNeighbor = { start: absoluteStart, end: absoluteEnd, distance };
            }
            searchIndex = found + candidate.text.length;
        }
        if (bestNeighbor && bestNeighbor.distance <= lineContent.length + 5) {
            return { start: bestNeighbor.start, end: bestNeighbor.end };
        }
        // Strategy 7: Limited whitespace-aware search on the same line
        const escapedText = candidate.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const whitespaceAwarePattern = new RegExp(`(\\s*)(${escapedText})(\\s*)`, 'g');
        let match;
        while ((match = whitespaceAwarePattern.exec(lineContent)) !== null) {
            const matchStart = lineStart + match.index + match[1].length;
            const matchEnd = matchStart + candidate.text.length;
            return { start: matchStart, end: matchEnd };
        }
        return null;
    }
    transformText(candidate, content, magicString) {
        // Vue text content becomes {{ $t('key') }}
        const replacement = `{{ $t('${candidate.suggestedKey}') }}`;
        const offset = this.findCandidateOffset(candidate, content, { includeQuotes: true, preferQuoted: true });
        if (offset) {
            magicString.overwrite(offset.start, offset.end, replacement);
            return true;
        }
        return false;
    }
    transformAttribute(candidate, content, magicString) {
        // Vue attributes can be static or dynamic (v-bind:)
        // We need to convert static attribute to bound attribute
        // e.g. title="This is a tooltip" -> :title="$t('key')"
        // The candidate position points to the text content (after opening quote)
        // We need to find the full attribute and replace it
        const offset = this.findCandidateOffset(candidate, content, { includeQuotes: true, preferQuoted: true });
        if (!offset)
            return false;
        // Find the attribute name by looking backwards from the position
        let attrStart = offset.start;
        while (attrStart > 0 && content[attrStart - 1] !== ' ' && content[attrStart - 1] !== '\t' && content[attrStart - 1] !== '\n' && content[attrStart - 1] !== '<') {
            attrStart--;
        }
        // Extract the attribute name
        const attrText = content.substring(attrStart, offset.end + 1); // +1 for closing quote
        const attrNameMatch = attrText.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
        if (!attrNameMatch)
            return false;
        const attrName = attrNameMatch[1];
        // Replace the entire attribute with dynamic binding
        const replacement = `:${attrName}="$t('${candidate.suggestedKey}')"`;
        magicString.overwrite(attrStart, attrStart + attrText.length, replacement);
        return true;
    }
    transformExpression(candidate, content, magicString) {
        // Vue expressions in {{ }} become $t('key')
        const replacement = `$t('${candidate.suggestedKey}')`;
        const offset = this.findCandidateOffset(candidate, content, { includeQuotes: true, preferQuoted: true });
        if (offset) {
            const expanded = this.expandToSurroundingQuotes(offset, content);
            magicString.overwrite(expanded.start, expanded.end, replacement);
            return true;
        }
        return false;
    }
    transformCallExpression(candidate, content, magicString) {
        // Handle existing i18n calls or string literals in script sections
        const replacement = `$t('${candidate.suggestedKey}')`;
        const offset = this.findCandidateOffset(candidate, content, { includeQuotes: true, preferQuoted: true });
        if (offset) {
            const expanded = this.expandToSurroundingQuotes(offset, content);
            magicString.overwrite(expanded.start, expanded.end, replacement);
            return true;
        }
        return false;
    }
    expandToSurroundingQuotes(offset, content) {
        const before = content[offset.start - 1];
        const after = content[offset.end];
        if (before && after && before === after && ['"', "'", '`'].includes(before)) {
            return { start: offset.start - 1, end: offset.end + 1 };
        }
        return offset;
    }
}
//# sourceMappingURL=VueWriter.js.map