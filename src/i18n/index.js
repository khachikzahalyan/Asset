import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import { NAMESPACE_LIST, SUPPORTED_LOCALES, FALLBACK_LOCALE } from './namespaces.js';

const localeModules = import.meta.glob('@/locales/**/*.json', { eager: true });

const resources = {};
for (const locale of SUPPORTED_LOCALES) {
  resources[locale] = {};
  for (const ns of NAMESPACE_LIST) {
    const key = Object.keys(localeModules).find(
      (k) => k.endsWith(`/locales/${locale}/${ns}.json`)
    );
    resources[locale][ns] = key ? localeModules[key].default ?? localeModules[key] : {};
  }
}

const isTest = import.meta.env.MODE === 'test';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // In the test environment force Russian so assertions match the
    // Russian locale strings (test assertions were written against ru).
    ...(isTest ? { lng: FALLBACK_LOCALE } : {}),
    fallbackLng: FALLBACK_LOCALE,
    supportedLngs: SUPPORTED_LOCALES,
    ns: NAMESPACE_LIST,
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'ams.locale',
    },
  });

export default i18n;
