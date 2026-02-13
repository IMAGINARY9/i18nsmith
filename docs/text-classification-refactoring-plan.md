# Text Classification Refactoring Plan

## Current Architecture
- Single monolithic `shouldExtractText()` function
- Pattern-based heuristics (regex, keywords)
- No semantic/structural context awareness

## Proposed Improvements

### 1. **Tiered Classification System**

```typescript
interface ClassificationContext {
  // DOM/AST context
  elementType?: string;        // 'cite', 'code', 'pre', 'script', etc.
  parentElements?: string[];    // Ancestor chain
  attributes?: Record<string, string>;
  
  // Positional context
  isFirstChild?: boolean;
  isLastChild?: boolean;
  hasAdjacentExpressions?: boolean;
  
  // Content context
  surroundingText?: string;     // Text before/after for context
  documentLanguage?: string;    // Detected primary language
}

class TextClassifier {
  // Tier 1: Fast filters (regex, length, obvious non-text)
  quickFilter(text: string): FilterResult;
  
  // Tier 2: Pattern matching (URLs, code, CSS, etc.)
  patternFilter(text: string): FilterResult;
  
  // Tier 3: Semantic analysis (with context)
  semanticFilter(text: string, context: ClassificationContext): FilterResult;
  
  // Tier 4: ML/heuristic scoring (optional, for edge cases)
  scoreTranslatability(text: string, context: ClassificationContext): number;
}
```

### 2. **Context-Aware Rules**

Add element-specific rules:
- `<cite>`, `<code>`, `<pre>` → Skip by default
- `<time datetime="...">` → Skip if matches ISO date format
- `<data value="...">` → Skip machine-readable values
- Text starting with "-" or "—" inside `<cite>` → Skip (attribution)

### 3. **Pattern Improvements**

```typescript
// Add citation/attribution patterns
const CITATION_PATTERN = /^[-–—]\s*[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/;  // "- Peter Drucker"
const AUTHOR_PATTERN = /^by\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/i;      // "by John Smith"

// Add proper name detection (naive)
const PROPER_NAME_PATTERN = /^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,3}$/;   // "John Smith"

// Add mathematical/scientific notation
const MATH_NOTATION = /^[a-z]\s*[=<>≤≥]\s*[\d.]+|^\d+\s*[+\-×÷]\s*\d+/i;

// Add measurement units
const MEASUREMENT_PATTERN = /^\d+(\.\d+)?\s*(kg|lb|km|mi|°C|°F|cm|in|mm)$/i;
```

### 4. **Configurable Policy System**

```typescript
interface ExtractionPolicy {
  // Allow users to configure extraction behavior
  extractCitations: boolean;           // Default: false
  extractProperNames: boolean;         // Default: false
  extractMeasurements: boolean;        // Default: false
  extractSingleSentences: boolean;     // Default: true
  
  // Minimum quality thresholds
  minWordCount: number;                // Default: 1
  minTranslatableWordRatio: number;    // % of words that look translatable
  
  // Custom rules
  customSkipPatterns: RegExp[];
  customAllowPatterns: RegExp[];
  
  // Element-specific overrides
  elementRules: Record<string, 'always' | 'never' | 'default'>;
}
```

### 5. **Heuristic Scoring**

```typescript
function scoreText(text: string, context: ClassificationContext): number {
  let score = 50;  // Neutral starting point
  
  // Positive signals (increase score)
  if (hasMultipleSentences(text)) score += 20;
  if (containsCommonWords(text)) score += 15;
  if (hasProperPunctuation(text)) score += 10;
  if (context.elementType === 'p' || context.elementType === 'h1') score += 10;
  
  // Negative signals (decrease score)
  if (context.elementType === 'cite') score -= 30;
  if (context.elementType === 'code') score -= 40;
  if (text.length < 3) score -= 20;
  if (isAllCaps(text)) score -= 15;
  if (containsSpecialSymbols(text)) score -= 10;
  
  return Math.max(0, Math.min(100, score));
}

// Extract if score >= threshold (configurable, default 60)
```

### 6. **Machine Learning Integration** (Future)

For advanced classification:
- Train on labeled dataset of translatable vs. non-translatable text
- Use lightweight models (e.g., fastText, TinyBERT)
- Cache classification results for performance
- Fall back to heuristics if ML unavailable

```typescript
class MLTextClassifier {
  private model?: any;
  
  async classify(text: string, context: ClassificationContext): Promise<{
    isTranslatable: boolean;
    confidence: number;
    reasoning: string[];
  }> {
    if (!this.model) {
      return this.fallbackToHeuristics(text, context);
    }
    
    const features = this.extractFeatures(text, context);
    const prediction = await this.model.predict(features);
    return prediction;
  }
}
```

### 7. **Debugging & Observability**

```typescript
interface ClassificationResult {
  shouldExtract: boolean;
  confidence: number;
  reasons: Array<{
    rule: string;
    impact: number;  // +/- score contribution
    matched: boolean;
  }>;
  suggestions?: string[];  // Hints for user if borderline
}

// Example output:
{
  shouldExtract: false,
  confidence: 0.85,
  reasons: [
    { rule: 'citation-pattern', impact: -30, matched: true },
    { rule: 'element-type-cite', impact: -20, matched: true },
    { rule: 'has-letters', impact: +10, matched: true }
  ],
  suggestions: [
    'Text appears to be a citation. Set extractCitations: true to include it.'
  ]
}
```

## Implementation Phases

### Phase 1 (Immediate) ✅
- Add citation/attribution patterns
- Add context-aware filtering for specific elements
- Improve documentation of existing heuristics

### Phase 2 (Short-term)
- Implement tiered classification system
- Add configurable policy system
- Add scoring-based approach

### Phase 3 (Medium-term)
- Build comprehensive test suite with labeled examples
- Add ML classification (optional, opt-in)
- Performance optimization

### Phase 4 (Long-term)
- Interactive classification tool (CLI/UI)
- Community-contributed patterns
- Multi-language detection & filtering

## Breaking Changes to Consider

1. **Stricter by default**: Some previously extracted text (like citations) would be skipped
2. **Opt-in for aggressive extraction**: Users need explicit config for edge cases
3. **API changes**: `shouldExtractText()` → `classify(text, context)`

## Migration Path

```typescript
// v1 (current) - Simple function
shouldExtractText(text, config) → boolean

// v2 (proposed) - Backward compatible wrapper
shouldExtractText(text, config, context?) → ClassificationResult
// Still returns .shouldExtract for compatibility

// v3 (future) - Full API
classifier.classify(text, context, policy) → DetailedResult
```

## Testing Strategy

```typescript
describe('TextClassifier', () => {
  it('should extract clear translatable content', () => {
    const cases = [
      'Welcome to our application',
      'This is a paragraph with multiple sentences. It should be extracted.',
      'Click here to continue',
    ];
    cases.forEach(text => {
      expect(classifier.classify(text, {}).shouldExtract).toBe(true);
    });
  });
  
  it('should skip citations and attributions', () => {
    const cases = [
      '- Peter Drucker',
      '— Albert Einstein',
      'by John Smith',
    ];
    cases.forEach(text => {
      expect(classifier.classify(text, { elementType: 'cite' }).shouldExtract).toBe(false);
    });
  });
  
  it('should use context for decisions', () => {
    const text = 'data';
    expect(classifier.classify(text, {}).shouldExtract).toBe(false); // too short
    expect(classifier.classify(text, { elementType: 'th' }).shouldExtract).toBe(true); // table header
  });
});
```

## Metrics to Track

- **Precision**: % of extracted text that truly needs translation
- **Recall**: % of translatable text that was extracted
- **False positives**: Non-translatable text extracted (CSS classes, code, etc.)
- **False negatives**: Translatable text skipped (like your original concern)

## Recommended Immediate Action

Add these patterns to `text-filters.ts`:

```typescript
// Citations and attributions
const CITATION_ATTRIBUTION_PATTERN = /^[-–—]\s*[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/;

// In shouldExtractText, add:
if (CITATION_ATTRIBUTION_PATTERN.test(trimmedText)) {
  return { shouldExtract: false, skipReason: 'citation-attribution' };
}

// Context-aware: skip text in <cite> elements
if (attributeContext === 'cite' || context?.elementType === 'cite') {
  return { shouldExtract: false, skipReason: 'citation-element' };
}
```
