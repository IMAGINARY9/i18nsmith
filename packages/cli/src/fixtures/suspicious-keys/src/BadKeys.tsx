import { useTranslation } from 'react-i18next';

export function BadKeys() {
  const { t } = useTranslation();
  
  return (
    <div>
      {/* These are bad keys - text as key */}
      <h1>{t('Hello World')}</h1>
      <p>{t('Welcome to our app!')}</p>
      <a href="#">{t('Click Here')}</a>
      <button>{t('Save')}</button>
      
      {/* These are good keys */}
      <p>{t('proper.namespaced.key')}</p>
      <button>{t('buttons.submit')}</button>
    </div>
  );
}
