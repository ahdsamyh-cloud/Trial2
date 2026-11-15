import en from '../messages/en.json';
import dv from '../messages/dv.json';

/**
 * gettext-style translation: UI strings are written in English and passed through t().
 * `pnpm i18n:extract` collects them into messages/en.json; another language adds
 * messages/<lang>.json with the same keys. Supports {name} placeholders.
 *
 * Dhivehi: messages/dv.json is a starting draft; the HoD / IT admin correct and complete the wording in
 * the app (Configuration → Dhivehi wording), which is stored on the server and overrides the draft.
 * Anything not translated stays in English. The choice of language is a per-device UI preference.
 */
export type Lang = 'en' | 'dv';
const catalogs: Record<Lang, Record<string, string>> = { en, dv: { ...dv } };
let lang: Lang = 'en';
const PREF = 'ldms.lang';

export const builtinDhivehi: Readonly<Record<string, string>> = dv;
export const englishKeys = (): string[] => Object.keys(en);

export function currentLanguage(): Lang {
  return lang;
}

/** Switches the language and the page direction (Dhivehi is written right to left). */
export function setLanguage(l: Lang, overrides?: Record<string, string>) {
  if (overrides) catalogs.dv = { ...dv, ...overrides };
  lang = l;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = l === 'dv' ? 'dv' : 'en';
    document.documentElement.dir = l === 'dv' ? 'rtl' : 'ltr';
  }
}

/** The language this device asked for (stored locally; never content). */
export function preferredLanguage(): Lang {
  try { return localStorage.getItem(PREF) === 'dv' ? 'dv' : 'en'; } catch { return 'en'; }
}

export function savePreferredLanguage(l: Lang) {
  try { localStorage.setItem(PREF, l); } catch { /* storage unavailable */ }
}

export function t(key: string, vars?: Record<string, string | number | null | undefined>): string {
  const s = catalogs[lang]?.[key] || key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}
