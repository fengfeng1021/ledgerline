/* Ledgerline core - formatting, state, shell behaviour.
   Shared by every tool. Depends only on i18n. */

import { t, initI18n, getLocale, setLocale, applyI18n, LOCALES, detectCurrency } from './i18n.js';

/* ---------------------------------------------------------------- format */

export const CURRENCIES = {
  TWD: { symbol: 'NT$', code: 'TWD', step: 1000 },
  USD: { symbol: '$',   code: 'USD', step: 100 },
  EUR: { symbol: '€',   code: 'EUR', step: 100 },
  JPY: { symbol: '¥',   code: 'JPY', step: 10000 },
  GBP: { symbol: '£',   code: 'GBP', step: 100 },
  HKD: { symbol: 'HK$', code: 'HKD', step: 1000 },
  CNY: { symbol: '¥',   code: 'CNY', step: 1000 },
  SGD: { symbol: 'S$',  code: 'SGD', step: 100 },
  AUD: { symbol: 'A$',  code: 'AUD', step: 100 },
  CAD: { symbol: 'C$',  code: 'CAD', step: 100 },
};

let CUR = 'TWD';
export const setCurrency = (c) => { if (CURRENCIES[c]) CUR = c; };
export const getCurrency = () => CUR;
export const curSymbol = () => CURRENCIES[CUR].symbol;
export const defaultCurrency = () => detectCurrency();

const fmtCache = new Map();
function nf(opts) {
  const key = getLocale() + CUR + JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.NumberFormat(getLocale(), opts));
  return fmtCache.get(key);
}
window.addEventListener('ledger:locale', () => fmtCache.clear());

/** Full currency, no decimals. 1234567 -> NT$1,234,567 */
export const money = (n) =>
  !isFinite(n) ? '-' : curSymbol() + nf({ maximumFractionDigits: 0 }).format(Math.round(n));

/** Signed currency. Used for deltas. */
export const moneySigned = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + money(Math.abs(n));

/**
 * Compact currency for axis ticks. Chinese groups by 萬 and 億, which is what a
 * reader in Taiwan actually parses; western locales group by K, M, B.
 */
export function moneyShort(n) {
  if (!isFinite(n)) return '-';
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  const sym = curSymbol();
  if (getLocale().startsWith('zh')) {
    if (a >= 1e8) return s + sym + (a / 1e8).toFixed(2) + '億';
    if (a >= 1e4) return s + sym + (a / 1e4).toFixed(a >= 1e6 ? 0 : 1) + '萬';
    return s + sym + Math.round(a);
  }
  if (a >= 1e12) return s + sym + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9)  return s + sym + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6)  return s + sym + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3)  return s + sym + Math.round(a / 1e3) + 'K';
  return s + sym + Math.round(a);
}

export const pct = (n, d = 1) => (!isFinite(n) ? '-' : n.toFixed(d) + '%');
export const pctSigned = (n, d = 1) => (n > 0 ? '+' : '') + pct(n, d);
export const num = (n, d = 0) =>
  !isFinite(n) ? '-' : nf({ minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

/** 18.4 -> "18 yr 5 mo" / "18 年 5 個月" */
export function years(y) {
  if (!isFinite(y) || y < 0) return '-';
  const whole = Math.floor(y);
  const mo = Math.round((y - whole) * 12);
  if (mo === 12) return t('common.fmtYears', { y: whole + 1 });
  if (whole === 0) return t('common.fmtMonths', { m: mo });
  return mo ? t('common.fmtYearsMonths', { y: whole, m: mo }) : t('common.fmtYears', { y: whole });
}

/** Axis label for a year index. */
export const yearLabel = (v) => (v === 0 ? t('common.now') : t('common.yr', { n: v }));

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t2) => a + (b - a) * t2;

/* ---------------------------------------------------------------- state */

export function debounce(fn, ms = 90) {
  let timer;
  const wrapped = (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(timer); fn(...a); };
  return wrapped;
}

/**
 * Tool state: single source of truth. Writes to localStorage and the URL hash so
 * any result is a shareable link, and returning users land on their own numbers.
 */
export function createStore(toolId, defaults, onChange) {
  const KEY = 'ledgerline:' + toolId;
  let state = { ...defaults };

  // URL wins over storage: a shared link must show the sender's numbers.
  const fromHash = decodeState(location.hash.slice(1));
  const fromDisk = readDisk(KEY);
  state = { ...defaults, ...(fromDisk || {}), ...(fromHash || {}) };

  const persist = debounce(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    const h = encodeState(state, defaults);
    history.replaceState(null, '', h ? '#' + h : location.pathname);
  }, 420);

  return {
    get: () => state,
    read: (k) => state[k],
    set(patch, opts = {}) {
      let dirty = false;
      for (const k in patch) if (state[k] !== patch[k]) dirty = true;
      if (!dirty && !opts.force) return;
      state = { ...state, ...patch };
      persist();
      onChange(state, patch);
    },
    /** Replace wholesale, used when a tool adopts the shared profile. */
    replace(next) {
      state = { ...defaults, ...next };
      persist();
      onChange(state, state);
    },
    reset() {
      state = { ...defaults };
      try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
      history.replaceState(null, '', location.pathname);
      onChange(state, state);
    },
    shareUrl() {
      const h = encodeState(state, defaults);
      return location.origin + location.pathname + (h ? '#' + h : '');
    },
  };
}

function readDisk(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}

/** Compact hash: only keys that differ from defaults. k=v pairs, ~ separated. */
function encodeState(state, defaults) {
  const parts = [];
  for (const k of Object.keys(state)) {
    const v = state[k], d = defaults[k];
    if (v === d || v === undefined || v === null) continue;
    if (typeof v === 'object' && JSON.stringify(v) === JSON.stringify(d)) continue;
    const enc = typeof v === 'object' ? 'j' + encodeURIComponent(JSON.stringify(v))
              : typeof v === 'boolean' ? (v ? '1' : '0')
              : encodeURIComponent(String(v));
    parts.push(k + '=' + enc);
  }
  return parts.join('~');
}

function decodeState(hash) {
  if (!hash) return null;
  const out = {};
  for (const pair of hash.split('~')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const k = pair.slice(0, i);
    let raw = pair.slice(i + 1);
    if (raw.startsWith('j')) {
      try { out[k] = JSON.parse(decodeURIComponent(raw.slice(1))); } catch (e) { /* skip */ }
      continue;
    }
    raw = decodeURIComponent(raw);
    if (raw === '1' || raw === '0') { out[k] = raw === '1'; continue; }
    const n = Number(raw);
    out[k] = raw !== '' && !Number.isNaN(n) ? n : raw;
  }
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------ numeric UI */

/**
 * Wires a numeric field: typing, stepper buttons, arrow keys (shift = x10).
 * One function, every field in the suite.
 */
export function bindNumber(root, { onInput, step = 1, min = -Infinity, max = Infinity }) {
  const input = root.querySelector('.input');
  if (!input) return;
  const bump = (dir, mult = 1) => {
    const cur = Number(input.value) || 0;
    const next = clamp(round(cur + dir * step * mult, step), min, max);
    input.value = next;
    onInput(next);
  };
  input.addEventListener('input', () => {
    const v = input.value === '' ? NaN : Number(input.value);
    if (Number.isNaN(v)) return;
    onInput(clamp(v, min, max));
  });
  input.addEventListener('blur', () => {
    const v = clamp(Number(input.value) || 0, min, max);
    input.value = v;
    onInput(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : 1);
  });
  root.querySelectorAll('.stepper button').forEach((b) => {
    b.addEventListener('click', () => bump(Number(b.dataset.dir), 1));
  });
}

const round = (v, step) => {
  const dec = (String(step).split('.')[1] || '').length;
  return Number(v.toFixed(dec));
};

/** Range input with a live fill track. */
export function bindRange(input, onInput) {
  const paint = () => {
    const lo = Number(input.min || 0), hi = Number(input.max || 100);
    input.style.setProperty('--pct', ((Number(input.value) - lo) / (hi - lo)) * 100 + '%');
  };
  input.addEventListener('input', () => { paint(); onInput(Number(input.value)); });
  paint();
  return paint;
}

/* -------------------------------------------------------------- feedback */

let toastEl, toastTimer;
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    document.body.appendChild(toastEl);
  }
  toastEl.innerHTML =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.2 12 13 4.5"/></svg><span></span>';
  toastEl.querySelector('span').textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2400);
}

export async function copyText(text, msg) {
  const done = msg || t('common.copyDone');
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(done); } catch (_) { toast(t('common.copyFail')); }
    ta.remove();
  }
}

export function downloadCSV(filename, rows) {
  const esc = (c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(t('common.csvDone'));
}

/* ----------------------------------------------------------------- shell */

export const TOOLS = [
  { id: 'compound',   path: 'compound/',   nameKey: 'compound.h1',   blurbKey: 'compound.sub' },
  { id: 'fire',       path: 'fire/',       nameKey: 'fire.h1',       blurbKey: 'fire.sub' },
  { id: 'rebalance',  path: 'rebalance/',  nameKey: 'rebalance.h1',  blurbKey: 'rebalance.sub' },
  { id: 'dividend',   path: 'dividend/',   nameKey: 'dividend.h1',   blurbKey: 'dividend.sub' },
  { id: 'mortgage',   path: 'mortgage/',   nameKey: 'mortgage.h1',   blurbKey: 'mortgage.sub' },
  { id: 'allocation', path: 'allocation/', nameKey: 'allocation.h1', blurbKey: 'allocation.sub' },
];

/** Theme toggle, persisted. Defaults to system. */
export function initTheme() {
  const KEY = 'ledgerline:theme';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) { /* noop */ }
  const apply = (th) => {
    if (th) document.documentElement.setAttribute('data-theme', th);
    else document.documentElement.removeAttribute('data-theme');
  };
  apply(saved);
  document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';
      // Suppress transitions for one frame so the swap is a cut, not a smear.
      const root = document.documentElement;
      root.classList.add('theme-switching');
      apply(next);
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
      try { localStorage.setItem(KEY, next); } catch (e) { /* noop */ }
      window.dispatchEvent(new CustomEvent('ledger:theme', { detail: next }));
    });
  });
}

export function initNav() {
  const btn = document.querySelector('.nav__menu-btn');
  const links = document.querySelector('.nav__links');
  if (!btn || !links) return;
  btn.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', String(open));
  });
}

/** Language switch. One click, no dropdown: there are two locales. */
export function initLang() {
  document.querySelectorAll('[data-lang-toggle]').forEach((btn) => {
    const paint = () => {
      const other = LOCALES.find((l) => l.id !== getLocale()) || LOCALES[0];
      btn.textContent = other.short;
      btn.setAttribute('aria-label', t('nav.lang') + ': ' + other.label);
      btn.setAttribute('title', other.label);
    };
    btn.addEventListener('click', () => {
      const other = LOCALES.find((l) => l.id !== getLocale()) || LOCALES[0];
      setLocale(other.id);
    });
    window.addEventListener('ledger:locale', paint);
    paint();
  });
}

/** Cmd/Ctrl+K tool switcher. Present on every surface. */
export function initPalette(base = '') {
  const el = document.createElement('div');
  el.className = 'palette';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML =
    '<div class="palette__box">' +
    '<input class="palette__input" type="text"><div class="palette__list" role="listbox"></div></div>';
  document.body.appendChild(el);

  const input = el.querySelector('.palette__input');
  const list = el.querySelector('.palette__list');
  let active = 0, shown = [];

  const items = () => [
    { name: t('nav.profile'), blurb: t('profile.sub'), href: base + 'profile/' },
    { name: t('palette.overview'), blurb: t('palette.overviewBlurb'), href: base || './' },
    ...TOOLS.map((x) => ({ name: t(x.nameKey), blurb: t(x.blurbKey), href: base + x.path })),
  ];

  const render = () => {
    list.innerHTML = shown
      .map((x, i) =>
        `<a class="palette__item${i === active ? ' is-active' : ''}" role="option" href="${x.href}">` +
        `<b>${escapeHtml(x.name)}</b><span>${escapeHtml(x.blurb).slice(0, 46)}</span></a>`)
      .join('');
  };
  const open = () => {
    el.setAttribute('aria-label', t('nav.switch'));
    input.placeholder = t('palette.placeholder');
    input.setAttribute('aria-label', t('palette.filter'));
    el.classList.add('is-open');
    input.value = ''; shown = items(); active = 0; render();
    setTimeout(() => input.focus(), 30);
  };
  const close = () => el.classList.remove('is-open');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    shown = items().filter((x) => (x.name + ' ' + x.blurb).toLowerCase().includes(q));
    active = 0; render();
  });
  el.addEventListener('click', (e) => { if (e.target === el) close(); });

  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      el.classList.contains('is-open') ? close() : open();
      return;
    }
    if (!el.classList.contains('is-open')) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = clamp(active + (e.key === 'ArrowDown' ? 1 : -1), 0, shown.length - 1);
      render();
      return;
    }
    if (e.key === 'Enter' && shown[active]) { e.preventDefault(); location.href = shown[active].href; }
  });

  document.querySelectorAll('[data-open-palette]').forEach((b) => b.addEventListener('click', open));
}

export function escapeHtml(x) {
  return String(x).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Nav markup, injected so eight surfaces cannot drift apart. */
export function navHTML(base, currentId) {
  const links = TOOLS.map(
    (x) => `<a class="nav__link" href="${base}${x.path}"${x.id === currentId ? ' aria-current="page"' : ''}>${t(x.nameKey)}</a>`
  ).join('');
  const current = currentId === 'profile'
    ? { nameKey: 'profile.h1' }
    : TOOLS.find((x) => x.id === currentId);
  return (
    `<a class="brand" href="${base}">` +
    '<svg class="brand__mark" viewBox="0 0 18 18" aria-hidden="true">' +
    '<rect x="0" y="11" width="4" height="7" rx="1"/><rect x="7" y="6" width="4" height="12" rx="1"/>' +
    '<rect x="14" y="0" width="4" height="18" rx="1"/></svg>Ledgerline</a>' +
    (current ? `<span class="nav__tool">${t(current.nameKey)}</span>` : '') +
    `<button class="nav__menu-btn" aria-expanded="false" aria-label="${t('nav.menu')}">` +
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4.5h12M2 8h12M2 11.5h12"/></svg></button>' +
    `<nav class="nav__links">` +
    `<a class="nav__link nav__link--strong" href="${base}profile/"${currentId === 'profile' ? ' aria-current="page"' : ''}>${t('nav.profile')}</a>` +
    `<span class="nav__sep" aria-hidden="true"></span>${links}` +
    `<span class="nav__sep" aria-hidden="true"></span>` +
    `<button class="nav__link" data-lang-toggle></button>` +
    `<button class="nav__link" data-theme-toggle aria-label="${t('nav.theme')}" title="${t('nav.theme')}">${t('nav.theme')}</button>` +
    `<button class="nav__link" data-open-palette aria-label="${t('nav.switch')}">⌘K</button>` +
    '</nav>'
  );
}

export function footHTML(base) {
  return (
    '<div class="site-foot__in">' +
    `<p class="disclosure">${t('foot.privacy')}</p>` +
    `<p><a href="${base}">${t('foot.allTools')}</a> · ` +
    `<a href="https://github.com/fengfeng1021/ledgerline">${t('foot.source')}</a></p>` +
    '</div>'
  );
}

/** Standard shell boot. Every page calls this once, first. */
export function mountShell({ base = '../', tool = null } = {}) {
  document.documentElement.classList.remove('no-js');
  initI18n();

  const rebuild = () => {
    const nav = document.querySelector('.nav');
    if (nav) nav.innerHTML = navHTML(base, tool);
    const foot = document.querySelector('.site-foot');
    if (foot) foot.innerHTML = footHTML(base);
    initTheme();
    initNav();
    initLang();
    applyI18n(document);
  };
  rebuild();
  window.addEventListener('ledger:locale', rebuild);
  initPalette(base);
}

export { t, getLocale, setLocale, applyI18n };
