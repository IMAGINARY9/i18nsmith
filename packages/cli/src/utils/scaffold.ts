import fs from 'fs/promises';
import path from 'path';

export async function scaffoldTranslationContext(filePath: string, sourceLanguage: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const content = `'use client';

import { createContext, useContext, useState } from 'react';
import ${sourceLanguage}Messages from '../../locales/${sourceLanguage}.json';

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

  await fs.writeFile(filePath, content, 'utf8');
}