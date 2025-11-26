import crypto from 'crypto';
import path from 'path';
import { CandidateKind } from './scanner.js';

export interface KeyGenerationContext {
  filePath: string;
  kind: CandidateKind;
  context?: string;
}

export interface GeneratedKey {
  key: string;
  hash: string;
  preview: string;
}

export interface KeyGeneratorOptions {
  namespace?: string;
  hashLength?: number;
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function slugify(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }

  const slug = input
    .replace(/<|>|\{|\}/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return slug || undefined;
}

export class KeyGenerator {
  private readonly namespace: string;
  private readonly hashLength: number;
  private readonly textCache = new Map<string, GeneratedKey>();
  private readonly hashCache = new Map<string, string>();

  constructor(options: KeyGeneratorOptions = {}) {
    this.namespace = options.namespace ?? 'common';
    this.hashLength = options.hashLength ?? 6;
  }

  public generate(text: string, context: KeyGenerationContext): GeneratedKey {
    const normalized = normalizeText(text);
    if (!normalized) {
      throw new Error('Cannot generate a key for empty text');
    }

    if (this.textCache.has(normalized)) {
      return this.textCache.get(normalized)!;
    }

    const digest = this.createDigest(normalized, context);
    const hash = this.allocateHash(digest, normalized);
    const scopeSlug = this.buildScopeSlug(context.filePath, context.context);
    const textSlug = this.buildTextSlug(normalized);
    const keySegments = [
      this.namespace,
      // 'auto', // Removed to simplify key structure
      scopeSlug,
      textSlug,
      hash,
    ].filter(Boolean) as string[];
    const key = keySegments.join('.');

    const generated: GeneratedKey = {
      key,
      hash,
      preview: normalized.slice(0, 80),
    };

    this.textCache.set(normalized, generated);
    return generated;
  }

  private createDigest(text: string, context: KeyGenerationContext): string {
    const base = [
      text,
      context.kind,
      context.context ?? '',
      path.normalize(context.filePath).replace(/\\+/g, '/'),
    ].join('|');

    return crypto.createHash('sha1').update(base).digest('hex');
  }

  private allocateHash(digest: string, normalizedText: string): string {
    const base = digest.slice(0, this.hashLength);
    let candidate = base;
    let attempt = 1;

    while (this.hashCache.has(candidate) && this.hashCache.get(candidate) !== normalizedText) {
      attempt += 1;
      candidate = `${base}${attempt}`;
    }

    this.hashCache.set(candidate, normalizedText);
    return candidate;
  }

  private buildScopeSlug(filePath: string, jsxContext?: string): string | undefined {
    const fileSlug = slugify(path.basename(filePath, path.extname(filePath)));
    const contextSlug = slugify(jsxContext);

    if (fileSlug && contextSlug) {
      return `${fileSlug}.${contextSlug}`;
    }

    return fileSlug ?? contextSlug ?? undefined;
  }

  private buildTextSlug(text: string): string | undefined {
    const slug = slugify(text);
    if (!slug) {
      return undefined;
    }

    const parts = slug.split('-').filter(Boolean).slice(0, 4);
    if (parts.length === 0) {
      return undefined;
    }

    return parts.join('-');
  }
}
