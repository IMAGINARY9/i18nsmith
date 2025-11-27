import { PlaceholderFormat } from './config.js';

export type PlaceholderPatternKind = 'named' | 'positional';

interface PlaceholderPatternDescriptor {
  format: PlaceholderFormat;
  source: RegExp;
  type: PlaceholderPatternKind;
}

const PRESET_PLACEHOLDER_PATTERNS: Record<PlaceholderFormat, PlaceholderPatternDescriptor> = {
  doubleCurly: {
    format: 'doubleCurly',
    source: /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g,
    type: 'named',
  },
  percentCurly: {
    format: 'percentCurly',
    source: /%\{([A-Za-z0-9_.-]+)\}/g,
    type: 'named',
  },
  percentSymbol: {
    format: 'percentSymbol',
    source: /%s/g,
    type: 'positional',
  },
};

export interface PlaceholderPatternInstance {
  source: RegExp;
  type: PlaceholderPatternKind;
}

export function buildPlaceholderPatterns(formats: PlaceholderFormat[]): PlaceholderPatternInstance[] {
  return formats.map((format) => {
    const descriptor = PRESET_PLACEHOLDER_PATTERNS[format] ?? PRESET_PLACEHOLDER_PATTERNS.doubleCurly;
    return {
      source: descriptor.source,
      type: descriptor.type,
    };
  });
}

export function extractPlaceholders(value: string, patterns: PlaceholderPatternInstance[]): string[] {
  if (!value || !patterns.length) {
    return [];
  }

  const results: string[] = [];
  let positionalIndex = 0;

  for (const pattern of patterns) {
    const flags = pattern.source.flags.includes('g') ? pattern.source.flags : `${pattern.source.flags}g`;
    const regex = new RegExp(pattern.source.source, flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value)) !== null) {
      if (pattern.type === 'named') {
        const name = match[1]?.trim();
        if (name) {
          results.push(name);
        }
      } else {
        positionalIndex += 1;
        results.push(`__positional__${positionalIndex}`);
      }
    }
  }

  return Array.from(new Set(results));
}

/**
 * Result of comparing placeholders between source and target values.
 */
export interface PlaceholderComparisonResult {
  /** Placeholders present in source but missing from target */
  missing: string[];
  /** Placeholders present in target but not in source */
  extra: string[];
  /** Whether the comparison passed (no missing or extra placeholders) */
  valid: boolean;
}

/**
 * PlaceholderValidator provides methods for comparing placeholders
 * between source and target translation values.
 */
export class PlaceholderValidator {
  private readonly patterns: PlaceholderPatternInstance[];

  constructor(formats: PlaceholderFormat[] = ['doubleCurly']) {
    this.patterns = buildPlaceholderPatterns(formats);
  }

  /**
   * Extract placeholders from a value.
   */
  public extract(value: string): Set<string> {
    if (!value || typeof value !== 'string') {
      return new Set();
    }
    return new Set(extractPlaceholders(value, this.patterns));
  }

  /**
   * Compare placeholders between source and target values.
   */
  public compare(sourceValue: string, targetValue: string): PlaceholderComparisonResult {
    const sourceSet = this.extract(sourceValue);
    const targetSet = this.extract(targetValue);

    const missing = Array.from(sourceSet).filter((token) => !targetSet.has(token));
    const extra = Array.from(targetSet).filter((token) => !sourceSet.has(token));

    return {
      missing,
      extra,
      valid: missing.length === 0 && extra.length === 0,
    };
  }

  /**
   * Validate that a target value contains all placeholders from source.
   */
  public validate(sourceValue: string, targetValue: string): boolean {
    const result = this.compare(sourceValue, targetValue);
    return result.valid;
  }
}

