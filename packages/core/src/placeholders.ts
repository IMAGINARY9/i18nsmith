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
