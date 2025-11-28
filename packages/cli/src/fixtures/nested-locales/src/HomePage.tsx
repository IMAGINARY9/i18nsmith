import { useTranslation } from 'react-i18next';

export function HomePage() {
  const { t } = useTranslation();
  
  return (
    <div>
      <h1>{t('pages.home.title')}</h1>
      <p>{t('pages.home.welcome')}</p>
      <button>{t('common.buttons.submit')}</button>
    </div>
  );
}
