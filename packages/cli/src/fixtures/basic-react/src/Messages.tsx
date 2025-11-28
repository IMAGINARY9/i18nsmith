import React from 'react';
import { useTranslation } from 'react-i18next';

export function SuccessMessage() {
  const { t } = useTranslation();
  return <div className="success">{t('messages.success')}</div>;
}

export function ErrorMessage() {
  const { t } = useTranslation();
  return <div className="error">{t('messages.error')}</div>;
}
