/* Mortgage - amortisation, overpayment, and the comparison against investing. */

import {
  money, moneyShort, pct, num, years as fmtYears, setCurrency, curSymbol, CURRENCIES,
  createStore, bindNumber, bindRange, debounce, copyText, downloadCSV, mountShell, clamp,
} from '../assets/js/core.js';
import { t } from '../assets/js/i18n.js';
import { mountProfileBridge } from '../assets/js/bridge.js';
import { lineChart } from '../assets/js/chart.js';
import { countTo, flash, enterWorkbench, revealOnScroll } from '../assets/js/motion.js';

const DEFAULTS = {
  principal: 12000000, rate: 2.35, term: 30, grace: 0,
  method: 'annuity', extra: 5000, lump: 0, lumpYear: 3,
  alt: 5, cur: 'TWD',
};

/* ---------------------------------------------------------------- model */

/**
 * Month-by-month amortisation.
 * `extra` and `lump` are optional so the same function produces both the
 * baseline schedule and the accelerated one.
 */
function amortise(p, { extra = 0, lump = 0, lumpYear = 0 } = {}) {
  const r = p.rate / 100 / 12;
  const n = Math.round(p.term * 12);
  const graceM = Math.min(Math.round(p.grace * 12), n - 1);
  const amortM = n - graceM;

  let bal = p.principal;
  const basePayment = r > 0
    ? (p.principal * r) / (1 - Math.pow(1 + r, -amortM))
    : p.principal / amortM;
  const levelPrincipal = p.principal / amortM;

  const yearly = [{ year: 0, balance: bal, interest: 0, principal: 0, paid: 0 }];
  let yInt = 0, yPrin = 0, yPaid = 0;
  let totalInterest = 0;
  let months = 0;
  let firstPayment = 0;

  for (let m = 1; m <= n && bal > 0.005; m++) {
    const interest = bal * r;
    let principalPart;
    let payment;

    if (m <= graceM) {
      payment = interest;             // interest-only
      principalPart = 0;
    } else if (p.method === 'annuity') {
      payment = basePayment;
      principalPart = payment - interest;
    } else {
      principalPart = levelPrincipal;
      payment = principalPart + interest;
    }

    principalPart += extra;
    payment += extra;

    if (lump > 0 && m === Math.max(1, Math.round(lumpYear * 12) - 11)) {
      principalPart += lump;
      payment += lump;
    }

    if (principalPart > bal) {         // final, partial payment
      payment -= principalPart - bal;
      principalPart = bal;
    }

    bal -= principalPart;
    totalInterest += interest;
    yInt += interest; yPrin += principalPart; yPaid += payment;
    months = m;
    if (m === graceM + 1) firstPayment = payment - extra;
    if (m === 1 && graceM > 0) firstPayment = payment - extra;

    if (m % 12 === 0 || bal <= 0.005) {
      yearly.push({
        year: Math.ceil(m / 12), balance: Math.max(0, bal),
        interest: yInt, principal: yPrin, paid: yPaid,
      });
      yInt = 0; yPrin = 0; yPaid = 0;
    }
  }

  // Pad so baseline and accelerated schedules plot on the same x axis.
  const fullYears = Math.ceil(n / 12);
  while (yearly.length <= fullYears) {
    yearly.push({ year: yearly.length, balance: 0, interest: 0, principal: 0, paid: 0 });
  }

  return {
    yearly, totalInterest, months,
    payment: p.method === 'annuity' ? basePayment : levelPrincipal + p.principal * r,
    firstPayment: firstPayment || basePayment,
    gracePayment: p.principal * r,
    graceM, basePayment, levelPrincipal,
  };
}

/** Future value of directing `extra` into an investment instead, over the same span. */
function investInstead(p, monthsSpan) {
  const rm = Math.pow(1 + p.alt / 100, 1 / 12) - 1;
  let v = 0;
  for (let m = 1; m <= monthsSpan; m++) {
    v = v * (1 + rm) + p.extra;
    if (p.lump > 0 && m === Math.max(1, Math.round(p.lumpYear * 12) - 11)) v += p.lump;
  }
  return v;
}

/* ------------------------------------------------------------------- ui */

const $ = (s) => document.querySelector(s);
const els = {};
let store, last = null, lastWinner = null;

function render(s) {
  setCurrency(s.cur);
  const base = amortise(s);
  const fast = amortise(s, { extra: s.extra, lump: s.lump, lumpYear: s.lumpYear });
  const saved = base.totalInterest - fast.totalInterest;
  const monthsSaved = base.months - fast.months;
  last = { s, base, fast };

  // --- metrics
  const pay = s.grace > 0 ? base.gracePayment : base.payment;
  countTo(els.vPay, pay + s.extra, money);
  els.fPay.textContent = s.grace > 0
    ? t('mortgage.fPayGrace', { years: fmtYears(s.grace), then: money(base.basePayment + s.extra) })
    : s.method === 'annuity'
      ? (s.extra > 0 ? t('mortgage.fPayExtra', { base: money(base.payment), extra: money(s.extra) }) : t('mortgage.fPayLevel'))
      : t('mortgage.fPayFalling', { end: money(base.levelPrincipal + (base.yearly.at(-2)?.balance || 0) * (s.rate / 1200) + s.extra) });

  countTo(els.vInterest, fast.totalInterest, money);
  els.fInterest.textContent = t('mortgage.fInterest', { pct: pct((fast.totalInterest / Math.max(1, s.principal)) * 100, 0) });

  countTo(els.vSaved, saved, money);
  els.fSaved.textContent = saved > 0
    ? t('mortgage.fSaved', { n: monthsSaved })
    : t('mortgage.fSavedNone');

  countTo(els.vFree, fast.months / 12, (v) => fmtYears(v));
  els.fFree.textContent = monthsSaved > 0
    ? t('mortgage.fFree', { years: fmtYears(monthsSaved / 12) })
    : t('mortgage.fFreeFull', { years: fmtYears(s.term) });

  // --- balance chart
  const xs = base.yearly.map((y) => y.year);
  const series = [
    { key: 'base', label: t('mortgage.legendContract'), values: base.yearly.map((y) => y.balance), color: '--slate-400', dashed: s.extra > 0 || s.lump > 0 },
  ];
  if (s.extra > 0 || s.lump > 0) {
    series.unshift({
      key: 'fast', label: t('mortgage.legendFast'),
      values: fast.yearly.map((y) => y.balance), color: '--accent', area: true, areaOpacity: 0.1,
    });
  } else {
    series[0].color = '--accent';
    series[0].area = true;
    series[0].areaOpacity = 0.1;
    series[0].dashed = false;
  }

  lineChart($('#chart'), {
    series,
    x: { values: xs, format: (v) => (v === 0 ? t('common.start') : t('common.yr', { n: v })), readoutLabel: t('common.year') },
    y: { format: moneyShort, min: 0 },
    markers: monthsSaved > 0 ? [{ x: Math.ceil(fast.months / 12), label: t('mortgage.markerPaid') }] : [],
    height: 360,
    readout: $('#readout'),
    readout_empty: t('common.hoverChart'),
    table: { caption: t('mortgage.balTitle'), xLabel: t('common.year') },
  });
  $('#legend').innerHTML = series
    .map((x) => `<span class="legend__item"><span class="legend__swatch" style="background:var(${x.color})"></span>${x.label}</span>`)
    .join('');

  // --- overpay against invest
  const span = base.months;
  const invested = investInstead(s, span);
  const overpayWins = saved >= invested;
  if (lastWinner !== null && overpayWins !== lastWinner) flash(els.mSaved);
  lastWinner = overpayWins;

  const gap = Math.abs(saved - invested);
  els.beClaim.innerHTML = s.extra <= 0 && s.lump <= 0
    ? t('mortgage.beNone')
    : overpayWins ? t('mortgage.beOverpay', { gap: money(gap) }) : t('mortgage.beInvest', { gap: money(gap) });
  els.beSub.textContent = s.extra <= 0 && s.lump <= 0
    ? t('mortgage.beSubNone', { rate: pct(s.rate, 2), alt: pct(s.alt, 1) })
    : t('mortgage.beSub', { rate: pct(s.rate, 2), alt: pct(s.alt, 1) });

  const beBars = [
    { label: t('mortgage.barSaved'), v: saved, color: '--sage-400' },
    { label: t('mortgage.barInvested'), v: invested, color: '--slate-400' },
  ];
  const mx = Math.max(...beBars.map((b) => b.v), 1);
  els.beBars.innerHTML = beBars.map((b) => `<div class="fee-bar">
      <div class="fee-bar__top"><span>${b.label}</span><span class="num">${money(b.v)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(b.v / mx) * 100}%;background:var(${b.color})"></div></div>
    </div>`).join('');

  // --- payment composition ladder, every fifth year
  const picks = fast.yearly.filter((y) => y.year > 0 && y.paid > 0)
    .filter((y, i, arr) => y.year % 5 === 0 || y.year === 1 || y === arr[arr.length - 1]);
  $('#ladder').innerHTML = picks.map((y) => {
    const tot = y.interest + y.principal || 1;
    const iPct = (y.interest / tot) * 100;
    return `<div class="ladder__row">
      <span class="ladder__k">${t('mortgage.mixYear', { n: y.year })}</span>
      <span class="ladder__stack">
        <span class="ladder__seg" style="width:${iPct}%;background:var(--clay-400)"></span>
        <span class="ladder__seg" style="width:${100 - iPct}%;background:var(--sage-400)"></span>
      </span>
      <span class="ladder__v">${t('mortgage.mixInterest', { pct: pct(iPct, 0) })}</span>
    </div>`;
  }).join('');

  // --- table
  $('#tbl tbody').innerHTML = fast.yearly.filter((y) => y.year > 0).map((y, i) => {
    const b = base.yearly[i + 1];
    return `<tr${y.balance === 0 && fast.yearly[i]?.balance > 0 ? ' class="is-marker"' : ''}>
      <td>${y.year}</td>
      <td class="c-mute">${money(y.paid)}</td>
      <td class="c-neg">${money(y.interest)}</td>
      <td class="c-pos">${money(y.principal)}</td>
      <td>${money(y.balance)}</td>
      <td class="c-mute">${money(b?.balance ?? 0)}</td>
    </tr>`;
  }).join('');

  syncRail(s);
}

function syncRail(s) {
  const set = (id, v) => { const n = $('#' + id); if (n && document.activeElement !== n) n.value = v; };
  set('principal', s.principal); set('extra', s.extra); set('lump', s.lump);
  set('rate', s.rate); set('term', s.term); set('grace', s.grace);
  set('lumpYear', s.lumpYear); set('alt', s.alt);
  $('#rateOut').textContent = pct(s.rate, 2);
  $('#termOut').textContent = s.term;
  $('#graceOut').textContent = s.grace;
  $('#lumpYearOut').textContent = s.lumpYear;
  $('#altOut').textContent = pct(s.alt, 1);
  $('#lumpYear').max = s.term;
  $('#altNote').textContent = s.alt > s.rate
    ? t('mortgage.altAbove', { rate: pct(s.rate, 2) }) : t('mortgage.altBelow', { rate: pct(s.rate, 2) });
  $('#methodSeg').querySelectorAll('[data-method]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.method === s.method)));
  document.querySelectorAll('[data-cur-symbol]').forEach((n) => { n.textContent = curSymbol(); });
  $('#curName').textContent = s.cur;
  repaint();
}

let repaint = () => {};

function boot() {
  mountShell({ base: '../', tool: 'mortgage' });
  ['vPay', 'vInterest', 'vSaved', 'vFree', 'fPay', 'fInterest', 'fSaved', 'fFree',
   'mSaved', 'beClaim', 'beSub', 'beBars'].forEach((id) => { els[id] = $('#' + id); });

  store = createStore('mortgage', DEFAULTS, debounce(render, 0));

  bindNumber($('[data-num="principal"]'), { step: 500000, min: 0, max: 1e12, onInput: (v) => store.set({ principal: v }) });
  bindNumber($('[data-num="extra"]'), { step: 1000, min: 0, max: 1e9, onInput: (v) => store.set({ extra: v }) });
  bindNumber($('[data-num="lump"]'), { step: 100000, min: 0, max: 1e11, onInput: (v) => store.set({ lump: v }) });

  const painters = [];
  [['rate', (v) => pct(v, 2)], ['term', String], ['grace', String],
   ['lumpYear', String], ['alt', (v) => pct(v, 1)]].forEach(([id, fmt]) => {
    painters.push(bindRange($('#' + id), (v) => { $('#' + id + 'Out').textContent = fmt(v); store.set({ [id]: v }); }));
  });
  repaint = () => painters.forEach((p) => p());

  $('#methodSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-method]');
    if (b) store.set({ method: b.dataset.method });
  });
  $('#curSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]');
    if (!b) return;
    $('#curSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const st = CURRENCIES[b.dataset.cur];
    $('#principal').step = st.step * 500; $('#extra').step = st.step; $('#lump').step = st.step * 100;
    store.set({ cur: b.dataset.cur });
  });

  $('#btnShare').addEventListener('click', () => copyText(store.shareUrl(), t('common.copied')));
  $('#btnReset').addEventListener('click', () => store.reset());
  $('#btnCsv').addEventListener('click', () => {
    const { base, fast } = last;
    const rows = [[t('common.year'), t('mortgage.thPaid'), t('mortgage.thToInterest'), t('mortgage.thToPrincipal'), t('mortgage.thOwed'), t('mortgage.thOwedBase')]];
    fast.yearly.filter((y) => y.year > 0).forEach((y, i) => rows.push([
      y.year, Math.round(y.paid), Math.round(y.interest), Math.round(y.principal),
      Math.round(y.balance), Math.round(base.yearly[i + 1]?.balance ?? 0),
    ]));
    downloadCSV('ledgerline-mortgage.csv', rows);
  });

  mountProfileBridge('mortgage', store, { afterAdopt: () => render(store.get()) });

  render(store.get());
  enterWorkbench();
  revealOnScroll();
  window.addEventListener('ledger:theme', () => render(store.get()));
  window.addEventListener('ledger:locale', () => render(store.get()));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
