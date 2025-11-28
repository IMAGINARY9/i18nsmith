import React from 'react';
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('common.welcome')}</h1>
      <p>Some untranslated text that should be detected</p>
      <button>{t('buttons.submit')}</button>
      <button>{t('buttons.cancel')}</button>
    </div>
  );
}
