import fs from 'fs/promises';
import path from 'path';

interface ScaffoldOptions {
  localesDir?: string;
  workspaceRoot?: string;
  force?: boolean;
}

function resolvePath(targetPath: string, workspaceRoot: string) {
  return path.isAbsolute(targetPath) ? targetPath : path.join(workspaceRoot, targetPath);
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeFileSafely(filePath: string, content: string, force?: boolean) {
  try {
    await fs.stat(filePath);
    if (!force) {
      throw new Error(`File already exists at ${filePath}. Re-run with --force to overwrite.`);
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  await fs.writeFile(filePath, content, 'utf8');
}

function relativeImportPath(fromDir: string, targetPath: string, dropExtension = true) {
  let relative = path.relative(fromDir, targetPath).replace(/\\/g, '/');
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }

  if (dropExtension) {
    relative = relative.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, '');
  }

  return relative;
}

export async function scaffoldTranslationContext(
  filePath: string,
  sourceLanguage: string,
  options: ScaffoldOptions = {}
) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const localesDir = options.localesDir ?? 'locales';
  const absolutePath = resolvePath(filePath, workspaceRoot);
  const dir = path.dirname(absolutePath);
  await ensureDir(dir);

  const localeFile = path.join(workspaceRoot, localesDir, `${sourceLanguage}.json`);
  let localeImportPath = path.relative(dir, localeFile).replace(/\\/g, '/');
  if (!localeImportPath.startsWith('.')) {
    localeImportPath = `./${localeImportPath}`;
  }

  const content = `'use client';

import { createContext, useContext, useState } from 'react';
import ${sourceLanguage}Messages from '${localeImportPath}';

type Language = '${sourceLanguage}';

const messages = {
  ${sourceLanguage}: ${sourceLanguage}Messages,
};

interface TranslationContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const TranslationContext = createContext<TranslationContextType>({
  language: '${sourceLanguage}',
  setLanguage: () => {},
  t: (key) => key,
});

export function TranslationProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>('${sourceLanguage}');

  const t = (key: string) => messages[language]?.[key] ?? key;

  return (
    <TranslationContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation() {
  return useContext(TranslationContext);
}
`;

  await writeFileSafely(absolutePath, content, options.force);
  return absolutePath;
}

export async function scaffoldI18next(
  i18nPath: string,
  providerPath: string,
  sourceLanguage: string,
  localesDir = 'locales',
  options: ScaffoldOptions = {}
) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const absoluteI18nPath = resolvePath(i18nPath, workspaceRoot);
  const absoluteProviderPath = resolvePath(providerPath, workspaceRoot);

  await ensureDir(path.dirname(absoluteI18nPath));
  await ensureDir(path.dirname(absoluteProviderPath));

  const localeFile = path.join(workspaceRoot, localesDir, `${sourceLanguage}.json`);
  let localeImportPath = path.relative(path.dirname(absoluteI18nPath), localeFile).replace(/\\/g, '/');
  if (!localeImportPath.startsWith('.')) {
    localeImportPath = `./${localeImportPath}`;
  }

  const i18nContent = `import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ${sourceLanguage}Messages from '${localeImportPath}';

const resources = {
  ${sourceLanguage}: {
    translation: ${sourceLanguage}Messages,
  },
};

function doInit() {
  const initialized = (i18next as unknown as { isInitialized?: boolean }).isInitialized;
  if (initialized) {
    return Promise.resolve();
  }

  return i18next
    .use(initReactI18next)
    .init({
      lng: '${sourceLanguage}',
      fallbackLng: '${sourceLanguage}',
      resources,
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      },
    })
    .catch((error) => {
      console.error('i18next init failed', error);
      throw error;
    });
}

if (typeof window !== 'undefined') {
  void doInit();
}

export function initI18next() {
  return doInit();
}

export default i18next;
`;

  await writeFileSafely(absoluteI18nPath, i18nContent, options.force);

  const providerImport = relativeImportPath(path.dirname(absoluteProviderPath), absoluteI18nPath, true);

  const providerContent = `'use client';

import { ReactNode, useEffect, useState } from 'react';
import { initI18next } from '${providerImport}';

interface I18nProviderProps {
  children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    Promise.resolve(initI18next())
      .catch((error) => {
        console.error('i18next initialization failed', error);
      })
      .finally(() => {
        if (mounted) {
          setReady(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (!ready) {
    return null;
  }

  return <>{children}</>;
}
`;

  await writeFileSafely(absoluteProviderPath, providerContent, options.force);

  return {
    i18nPath: absoluteI18nPath,
    providerPath: absoluteProviderPath,
  };
}
