import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  detectLocaleFormat,
  expandLocaleTree,
  flattenLocaleTree,
  LocalePersistenceFormat,
  sortNestedObject,
} from './utils/locale-shape.js';

export interface LocaleFileStats {
  locale: string;
  path: string;
  totalKeys: number;
  added: string[];
  updated: string[];
  removed: string[];
}

export interface LocaleStoreOptions {
  format?: 'flat' | 'nested' | 'auto';
  delimiter?: string;
  /**
   * Key sorting behavior when writing locale files.
   * - 'alphabetical': Sort keys alphabetically (default, deterministic output)
   * - 'preserve': Preserve existing key order, append new keys at end
   * - 'insertion': Order keys by insertion order (new keys appended)
   */
  sortKeys?: 'alphabetical' | 'preserve' | 'insertion';
}

const DEFAULT_LOCALE_STORE_OPTIONS = {
  format: 'auto' as const,
  delimiter: '.',
  sortKeys: 'alphabetical' as const,
};

interface LocaleCacheEntry {
  locale: string;
  path: string;
  data: Record<string, string>;
  /** Original key order from when file was loaded (for preserve mode) */
  originalKeyOrder: string[];
  dirty: boolean;
  added: Set<string>;
  updated: Set<string>;
  removed: Set<string>;
  format: LocalePersistenceFormat;
}

export class LocaleStore {
  private readonly cache = new Map<string, LocaleCacheEntry>();

  private readonly formatMode: 'flat' | 'nested' | 'auto';
  private readonly delimiter: string;
  private readonly sortKeysMode: 'alphabetical' | 'preserve' | 'insertion';

  constructor(private readonly localesDir: string, options: LocaleStoreOptions = {}) {
    this.formatMode = options.format ?? DEFAULT_LOCALE_STORE_OPTIONS.format;
    this.delimiter = options.delimiter ?? DEFAULT_LOCALE_STORE_OPTIONS.delimiter;
    this.sortKeysMode = options.sortKeys ?? DEFAULT_LOCALE_STORE_OPTIONS.sortKeys;
  }

  public getFilePath(locale: string): string {
    return path.join(this.localesDir, `${locale}.json`);
  }

  public async get(locale: string): Promise<Record<string, string>> {
    const entry = await this.ensureLocale(locale);
    return { ...entry.data };
  }

  public async getValue(locale: string, key: string): Promise<string | undefined> {
    const entry = await this.ensureLocale(locale);
    return entry.data[key];
  }

  public async upsert(locale: string, key: string, value: string): Promise<'added' | 'updated' | 'unchanged'> {
    const entry = await this.ensureLocale(locale);
    const existing = entry.data[key];

    if (existing === value) {
      return 'unchanged';
    }

    entry.data[key] = value;
    entry.dirty = true;
    entry.removed.delete(key);

    if (typeof existing === 'undefined') {
      entry.added.add(key);
      return 'added';
    }

    entry.updated.add(key);
    return 'updated';
  }

  public async remove(locale: string, key: string): Promise<boolean> {
    const entry = await this.ensureLocale(locale);
    if (typeof entry.data[key] === 'undefined') {
      return false;
    }

    delete entry.data[key];
    entry.dirty = true;
    entry.added.delete(key);
    entry.updated.delete(key);
    entry.removed.add(key);
    return true;
  }

  public async renameKey(
    locale: string,
    oldKey: string,
    newKey: string
  ): Promise<'missing' | 'unchanged' | 'renamed' | 'duplicate'> {
    if (oldKey === newKey) {
      return 'unchanged';
    }

    const entry = await this.ensureLocale(locale);
    if (typeof entry.data[oldKey] === 'undefined') {
      return 'missing';
    }

    if (typeof entry.data[newKey] !== 'undefined') {
      return 'duplicate';
    }

    const value = entry.data[oldKey];
    delete entry.data[oldKey];
    entry.data[newKey] = value;
    entry.dirty = true;
    entry.removed.add(oldKey);
    entry.added.add(newKey);
    entry.updated.delete(oldKey);
    entry.updated.delete(newKey);

    return 'renamed';
  }

  public async ensureFilesExist(locales: string[]): Promise<void> {
    for (const locale of locales) {
      const entry = await this.ensureLocale(locale);
      try {
        await fs.access(entry.path);
      } catch {
        entry.dirty = true;
      }
    }
  }

  public async checkKeyCollision(
    locale: string,
    key: string
  ): Promise<'parent-is-leaf' | 'key-is-container' | null> {
    const entry = await this.ensureLocale(locale);
    const keys = Object.keys(entry.data);

    // Check if any parent path is already a leaf key
    const parts = key.split(this.delimiter);
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join(this.delimiter);
      if (Object.prototype.hasOwnProperty.call(entry.data, parentPath)) {
        return 'parent-is-leaf';
      }
    }

    // Check if this key is a prefix of any existing key (meaning it would be a container)
    const prefix = key + this.delimiter;
    for (const existingKey of keys) {
      if (existingKey.startsWith(prefix)) {
        return 'key-is-container';
      }
    }

    return null;
  }

  public async flush(): Promise<LocaleFileStats[]> {
    const summaries: LocaleFileStats[] = [];

    for (const entry of this.cache.values()) {
      if (!entry.dirty) {
        continue;
      }

      await fs.mkdir(path.dirname(entry.path), { recursive: true });
      const sortedData = this.sortKeysForEntry(entry.data, entry);
      const format = this.resolvePersistenceFormat(entry);
      const structured =
        format === 'flat'
          ? sortedData
          : sortNestedObject(expandLocaleTree(sortedData, this.delimiter));
      const serialized = JSON.stringify(structured, null, 2);
      const tempPath = this.createTempPath(entry.path);
      await fs.writeFile(tempPath, `${serialized}\n`, 'utf8');

      try {
        await fs.rename(tempPath, entry.path);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EEXIST' || err.code === 'EPERM') {
          await fs.rm(entry.path, { force: true }).catch(() => {});
          await fs.rename(tempPath, entry.path);
        } else {
          throw error;
        }
      } finally {
        await fs.rm(tempPath, { force: true }).catch(() => {});
      }

      entry.dirty = false;

      summaries.push({
        locale: entry.locale,
        path: entry.path,
  totalKeys: Object.keys(sortedData).length,
        added: Array.from(entry.added).sort(),
        updated: Array.from(entry.updated).sort(),
        removed: Array.from(entry.removed).sort(),
      });

      entry.added.clear();
      entry.updated.clear();
      entry.removed.clear();
    }

    return summaries;
  }

  /**
   * Rewrite all cached locales to a specific shape format.
   * This forces all locale files to use the same format (flat or nested).
   */
  public async rewriteShape(
    targetFormat: 'flat' | 'nested',
    options: { delimiter?: string } = {}
  ): Promise<LocaleFileStats[]> {
    const delimiter = options.delimiter ?? this.delimiter;
    const summaries: LocaleFileStats[] = [];

    for (const entry of this.cache.values()) {
      const sortedData = this.sortKeysForEntry(entry.data, entry);
      const structured =
        targetFormat === 'flat'
          ? sortedData
          : sortNestedObject(expandLocaleTree(sortedData, delimiter));

      await fs.mkdir(path.dirname(entry.path), { recursive: true });
      const serialized = JSON.stringify(structured, null, 2);
      const tempPath = this.createTempPath(entry.path);
      await fs.writeFile(tempPath, `${serialized}\n`, 'utf8');

      try {
        await fs.rename(tempPath, entry.path);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EEXIST' || err.code === 'EPERM') {
          await fs.rm(entry.path, { force: true }).catch(() => {});
          await fs.rename(tempPath, entry.path);
        } else {
          throw error;
        }
      } finally {
        await fs.rm(tempPath, { force: true }).catch(() => {});
      }

      // Update the entry's format for future operations
      entry.format = targetFormat;
      entry.dirty = false;

      summaries.push({
        locale: entry.locale,
        path: entry.path,
        totalKeys: Object.keys(sortedData).length,
        added: [],
        updated: [],
        removed: [],
      });
    }

    return summaries;
  }

  public async getStoredLocales(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.localesDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => path.basename(entry.name, '.json'));
    } catch {
      return [];
    }
  }

  public getLocalesInMemory(): string[] {
    return Array.from(this.cache.keys());
  }

  private async loadLocaleData(filePath: string): Promise<{
    data: Record<string, string>;
    format: LocalePersistenceFormat;
    originalKeyOrder: string[];
  }> {
    try {
      const contents = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(contents);
      if (!parsed || typeof parsed !== 'object') {
        return { data: {}, format: this.resolveFormatPreference('flat'), originalKeyOrder: [] };
      }

      const detected = detectLocaleFormat(parsed);
      const data =
        detected === 'nested'
          ? flattenLocaleTree(parsed, this.delimiter)
          : this.normalizeFlatRecord(parsed);

      // Capture original key order for 'preserve' mode
      const originalKeyOrder = Object.keys(data);

      return {
        data,
        format: this.resolveFormatPreference(detected),
        originalKeyOrder,
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { data: {}, format: this.resolveFormatPreference('flat'), originalKeyOrder: [] };
      }
      throw error;
    }
  }

  private resolveFormatPreference(detected: LocalePersistenceFormat): LocalePersistenceFormat {
    if (this.formatMode === 'auto') {
      return detected;
    }
    return this.formatMode;
  }

  private resolvePersistenceFormat(entry: LocaleCacheEntry): LocalePersistenceFormat {
    if (this.formatMode === 'auto') {
      return entry.format;
    }
    entry.format = this.formatMode;
    return entry.format;
  }

  private normalizeFlatRecord(input: unknown): Record<string, string> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return {};
    }

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (typeof value === 'string') {
        normalized[key] = value;
        continue;
      }

      if (typeof value === 'number' || typeof value === 'boolean') {
        normalized[key] = String(value);
        continue;
      }

      if (value === null || typeof value === 'undefined') {
        normalized[key] = '';
        continue;
      }

      if (Array.isArray(value) || typeof value === 'object') {
        const flattened = flattenLocaleTree({ [key]: value }, this.delimiter);
        Object.assign(normalized, flattened);
        continue;
      }

      normalized[key] = String(value);
    }

    return normalized;
  }

  private async ensureLocale(locale: string): Promise<LocaleCacheEntry> {
    if (this.cache.has(locale)) {
      return this.cache.get(locale)!;
    }

    const filePath = this.getFilePath(locale);
    const { data, format, originalKeyOrder } = await this.loadLocaleData(filePath);

    const entry: LocaleCacheEntry = {
      locale,
      path: filePath,
      data,
      originalKeyOrder,
      dirty: false,
      added: new Set(),
      updated: new Set(),
      removed: new Set(),
      format,
    };

    this.cache.set(locale, entry);
    return entry;
  }

  /**
   * Sort keys based on the configured sortKeys mode.
   * - 'alphabetical': Sort keys alphabetically (deterministic)
   * - 'preserve': Keep original order, append new keys at end
   * - 'insertion': Use current object order (new keys appended)
   */
  private sortKeysForEntry(
    data: Record<string, string>,
    entry: LocaleCacheEntry
  ): Record<string, string> {
    const keys = Object.keys(data);

    switch (this.sortKeysMode) {
      case 'preserve': {
        // Use original order for existing keys, append new keys at the end
        const originalSet = new Set(entry.originalKeyOrder);
        const orderedKeys = entry.originalKeyOrder.filter((k) => k in data);
        const newKeys = keys.filter((k) => !originalSet.has(k)).sort((a, b) => a.localeCompare(b));
        const finalOrder = [...orderedKeys, ...newKeys];
        return finalOrder.reduce<Record<string, string>>((acc, key) => {
          acc[key] = data[key];
          return acc;
        }, {});
      }

      case 'insertion':
        // Just return as-is (object insertion order)
        return { ...data };

      case 'alphabetical':
      default:
        // Sort alphabetically
        return keys
          .sort((a, b) => a.localeCompare(b))
          .reduce<Record<string, string>>((acc, key) => {
            acc[key] = data[key];
            return acc;
          }, {});
    }
  }

  private createTempPath(filePath: string): string {
    const unique = crypto.randomBytes(6).toString('hex');
    return `${filePath}.${unique}.tmp`;
  }
}
