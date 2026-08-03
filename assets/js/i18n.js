/* Ledgerline i18n.
   Locale is detected from the browser, overridable, and remembered.
   Traditional Chinese is the primary locale; English is the fallback. */

import { DICT } from './dict.js';

const KEY = 'ledgerline:locale';
export const LOCALES = [
  { id: 'zh-TW', label: '繁體中文', short: '中' },
  { id: 'en', label: 'English', short: 'EN' },
];

/** Region defaults: what a first-time visitor from here most likely wants. */
const REGION_CURRENCY = {
  TW: 'TWD', HK: 'HKD', MO: 'HKD', CN: 'CNY', SG: 'SGD',
  JP: 'JPY', US: 'USD', GB: 'GBP', AU: 'AUD', CA: 'CAD',
  DE: 'EUR', FR: 'EUR', NL: 'EUR', ES: 'EUR', IT: 'EUR', IE: 'EUR',
};

let current = 'zh-TW';

/**
 * Traditional-Chinese scripts (TW, HK, MO, and any Hant tag) get zh-TW.
 * Simplified and everything else fall through to English rather than being
 * served text in the wrong script.
 */
export function detectLocale() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && DICT[saved]) return saved;
  } catch (e) { /* private mode */ }

  const tags = navigator.languages && navigator.languages.length
    ? navigator.languages : [navigator.language || 'en'];
  for (const raw of tags) {
    const tag = String(raw);
    const low = tag.toLowerCase();
    if (low.startsWith('zh')) {
      if (/hant|-tw|-hk|-mo/.test(low)) return 'zh-TW';
      // Bare "zh" from a Taiwan-region browser is still Traditional.
      if (regionOf(tag) && ['TW', 'HK', 'MO'].includes(regionOf(tag))) return 'zh-TW';
      return 'en';
    }
    if (low.startsWith('en')) return 'en';
  }
  return 'en';
}

function regionOf(tag) {
  const parts = String(tag).split('-');
  for (const p of parts.slice(1)) if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Taipei/.test(tz)) return 'TW';
    if (/Hong_Kong/.test(tz)) return 'HK';
  } catch (e) { /* noop */ }
  return null;
}

/** Currency guess from region, used only when the profile has no preference. */
export function detectCurrency() {
  const tags = navigator.languages || [navigator.language || 'en'];
  for (const t of tags) {
    const r = regionOf(t);
    if (r && REGION_CURRENCY[r]) return REGION_CURRENCY[r];
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (/Taipei/.test(tz)) return 'TWD';
    if (/Hong_Kong/.test(tz)) return 'HKD';
    if (/Tokyo/.test(tz)) return 'JPY';
    if (/London/.test(tz)) return 'GBP';
    if (/New_York|Chicago|Denver|Los_Angeles/.test(tz)) return 'USD';
    if (/Singapore/.test(tz)) return 'SGD';
    if (/Berlin|Paris|Madrid|Rome|Amsterdam|Dublin/.test(tz)) return 'EUR';
  } catch (e) { /* noop */ }
  return 'USD';
}

export const getLocale = () => current;
export const isZh = () => current.startsWith('zh');

export function setLocale(id, { persist = true } = {}) {
  if (!DICT[id]) return;
  current = id;
  document.documentElement.lang = id;
  if (persist) { try { localStorage.setItem(KEY, id); } catch (e) { /* noop */ } }
  applyI18n(document);
  window.dispatchEvent(new CustomEvent('ledger:locale', { detail: id }));
}

/**
 * Look up a key, with {placeholder} interpolation.
 * Falls back to English, then to the key itself so a missing string is visible
 * in development rather than rendering as empty space.
 */
export function t(key, vars) {
  const table = DICT[current] || DICT.en;
  let s = table[key];
  if (s === undefined) s = DICT.en[key];
  if (s === undefined) return key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : vars[k]));
}

/** Plural-aware helper. Chinese has one form; English has two. */
export function tn(key, n, vars) {
  const suffix = isZh() ? '' : (Math.abs(n) === 1 ? '.one' : '.other');
  const full = key + suffix;
  const table = DICT[current] || DICT.en;
  const s = table[full] !== undefined ? full : key;
  return t(s, { n, ...vars });
}

/**
 * Fill every element carrying a translation marker.
 *   data-i18n="key"           -> textContent
 *   data-i18n-html="key"      -> innerHTML (only for strings with inline markup)
 *   data-i18n-attr="a:key,b:key" -> attributes such as aria-label, title, placeholder
 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = t(el.dataset.i18n);
    if (v !== el.dataset.i18n || el.textContent.trim() === '') el.textContent = v;
  });
  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
    el.dataset.i18nAttr.split(',').forEach((pair) => {
      const [attr, key] = pair.split(':').map((x) => x.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  const titleKey = document.documentElement.dataset.titleKey;
  if (titleKey) document.title = t(titleKey);
  const descKey = document.documentElement.dataset.descKey;
  if (descKey) {
    const m = document.querySelector('meta[name="description"]');
    if (m) m.setAttribute('content', t(descKey));
  }
}

/** Called once, as early as possible, before the first paint of translated text. */
export function initI18n() {
  current = detectLocale();
  document.documentElement.lang = current;
  applyI18n(document);
  return current;
}

/** Locale-aware month names, used by the dividend calendar. */
export function monthNames(style = 'short') {
  const f = new Intl.DateTimeFormat(current, { month: style });
  return Array.from({ length: 12 }, (_, i) => f.format(new Date(2024, i, 1)));
}

/** Locale-aware absolute date, e.g. 2026年8月3日 / 3 Aug 2026 */
export function formatDate(iso) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (!d || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(current, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
}

/** "3 days ago" / "3 天前", for snapshot ages. */
export function formatAgo(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((now - d) / 86400000);
  if (days <= 0) return t('time.today');
  if (days === 1) return t('time.yesterday');
  if (days < 30) return t('time.daysAgo', { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t('time.monthsAgo', { n: months });
  return t('time.yearsAgo', { n: Math.floor(days / 365) });
}
