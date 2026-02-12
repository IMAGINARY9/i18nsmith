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
  workspaceRoot?: string;
  deduplicateByValue?: boolean;
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
  private readonly workspaceRoot: string;
  private readonly deduplicateByValue: boolean;
  private readonly textCache = new Map<string, GeneratedKey>();
  private readonly hashCache = new Map<string, string>();

  constructor(options: KeyGeneratorOptions = {}) {
    this.namespace = options.namespace ?? 'common';
    this.hashLength = options.hashLength ?? 6;
    this.workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : process.cwd();
    this.deduplicateByValue = options.deduplicateByValue ?? false;
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
      this.deduplicateByValue ? '' : path.normalize(context.filePath).replace(/\\+/g, '/'),
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
    const pathSlug = this.buildPathScopeSlug(filePath);
    const contextSlug = slugify(jsxContext);

    if (pathSlug && contextSlug) {
      return `${pathSlug}.${contextSlug}`;
    }

    return pathSlug ?? contextSlug ?? undefined;
  }

  private buildPathScopeSlug(filePath?: string): string | undefined {
    if (!filePath) {
      return undefined;
    }

    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(this.workspaceRoot, filePath);
    const normalized = path.normalize(absolutePath).replace(/\\+/g, '/');
    const relative = path.relative(this.workspaceRoot, normalized) || normalized;
    const withoutExt = relative.replace(/\.[^/.]+$/, '');
    const rawSegments = withoutExt
      .split(/[\\/]/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    const slugSegments = rawSegments
      .map((segment) => slugify(segment))
      .filter((segment): segment is string => Boolean(segment));

    const filtered = slugSegments.filter(
      (segment, index) => !this.shouldSkipScopeSegment(segment, index)
    );

    const tail = filtered.slice(-4);
    if (!tail.length) {
      return undefined;
    }

    return tail.join('.');
  }

  private shouldSkipScopeSegment(segment: string, index: number): boolean {
    if (!segment) {
      return true;
    }

    if (index === 0 && segment === 'src') {
      return true;
    }

    if (segment === 'index') {
      return true;
    }

    return false;
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
