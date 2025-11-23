import fs from 'fs/promises';
import path from 'path';

export interface LocaleFileStats {
  locale: string;
  path: string;
  totalKeys: number;
  added: string[];
  updated: string[];
}

interface LocaleCacheEntry {
  locale: string;
  path: string;
  data: Record<string, string>;
  dirty: boolean;
  added: Set<string>;
  updated: Set<string>;
}

export class LocaleStore {
  private readonly cache = new Map<string, LocaleCacheEntry>();

  constructor(private readonly localesDir: string) {}

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

    if (typeof existing === 'undefined') {
      entry.added.add(key);
      return 'added';
    }

    entry.updated.add(key);
    return 'updated';
  }

  public async flush(): Promise<LocaleFileStats[]> {
    const summaries: LocaleFileStats[] = [];

    for (const entry of this.cache.values()) {
      if (!entry.dirty) {
        continue;
      }

      await fs.mkdir(path.dirname(entry.path), { recursive: true });
      const sortedData = this.sortKeys(entry.data);
      const serialized = JSON.stringify(sortedData, null, 2);
      const tempPath = `${entry.path}.tmp`;
      await fs.writeFile(tempPath, `${serialized}\n`, 'utf8');

      try {
        await fs.rename(tempPath, entry.path);
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'EEXIST') {
          await fs.rm(entry.path, { force: true });
          await fs.rename(tempPath, entry.path);
        } else {
          throw error;
        }
      }

      entry.dirty = false;

      summaries.push({
        locale: entry.locale,
        path: entry.path,
        totalKeys: Object.keys(sortedData).length,
        added: Array.from(entry.added).sort(),
        updated: Array.from(entry.updated).sort(),
      });

      entry.added.clear();
      entry.updated.clear();
    }

    return summaries;
  }

  public getLocalesInMemory(): string[] {
    return Array.from(this.cache.keys());
  }

  private async ensureLocale(locale: string): Promise<LocaleCacheEntry> {
    if (this.cache.has(locale)) {
      return this.cache.get(locale)!;
    }

    const filePath = path.join(this.localesDir, `${locale}.json`);
    let data: Record<string, string> = {};

    try {
      const contents = await fs.readFile(filePath, 'utf8');
  data = JSON.parse(contents);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const entry: LocaleCacheEntry = {
      locale,
      path: filePath,
      data,
      dirty: false,
      added: new Set(),
      updated: new Set(),
    };

    this.cache.set(locale, entry);
    return entry;
  }

  private sortKeys(data: Record<string, string>): Record<string, string> {
    return Object.keys(data)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, string>>((acc, key) => {
        acc[key] = data[key];
        return acc;
      }, {});
  }
}
