import en from '../messages/en.json';

/**
 * gettext-style translation: UI strings are written in English and passed through t().
 * `pnpm i18n:extract` collects them into messages/en.json; another language adds
 * messages/<lang>.json with the same keys. Supports {name} placeholders.
 */
const catalogs: Record<string, Record<string, string>> = { en };
let lang = 'en';

export function setLanguage(l: string) {
  if (catalogs[l]) lang = l;
}

export function t(key: string, vars?: Record<string, string | number | null | undefined>): string {
  const s = catalogs[lang]?.[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}
