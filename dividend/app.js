/* Dividend — the calendar, after tax, and the month it covers the bills. */

import {
  money, moneyShort, pct, num, years as fmtYears, setCurrency, curSymbol, CURRENCIES,
  createStore, bindNumber, bindRange, debounce, copyText, mountShell, clamp, toast,
} from '../assets/js/core.js';
import { lineChart, donut } from '../assets/js/chart.js';
import { countTo, flash, enterWorkbench, revealOnScroll } from '../assets/js/motion.js';

const PALETTE = ['--accent', '--sage-400', '--slate-400', '--plum-400', '--clay-400', '--amber-600'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FREQ = { 12: 'Monthly', 4: 'Quarterly', 2: 'Twice a year', 1: 'Once a year' };

const DEFAULTS = {
  holdings: [
    { name: 'Broad market ETF', value: 3_200_000, yield: 3.4, freq: 4, start: 1 },
    { name: 'High dividend ETF', value: 1_800_000, yield: 5.6, freq: 2, start: 6 },
    { name: 'Utility holding', value: 900_000, yield: 4.2, freq: 1, start: 8 },
  ],
  growth: 5, horizon: 20, reinvest: true, addMonthly: 0,
  tax: 20, spend: 60000, cur: 'TWD',
};

/* ---------------------------------------------------------------- model */

/** Which calendar months a holding pays in, given frequency and first month. */
function payMonths(h) {
  const step = 12 / h.freq;
  const out = [];
  for (let k = 0; k < h.freq; k++) out.push(((h.start - 1 + k * step) % 12 + 12) % 12);
  return out;
}

function analyse(s) {
  const hs = s.holdings.filter((h) => isFinite(h.value) && isFinite(h.yield));
  const invested = hs.reduce((a, h) => a + Math.max(0, h.value), 0);
  const taxRate = s.tax / 100;

  // --- year one calendar
  const byMonth = Array(12).fill(0);
  const namesByMonth = Array.from({ length: 12 }, () => []);
  hs.forEach((h) => {
    const annual = Math.max(0, h.value) * (h.yield / 100);
    const per = annual / h.freq;
    payMonths(h).forEach((m) => {
      byMonth[m] += per * (1 - taxRate);
      namesByMonth[m].push(h.name);
    });
  });
  const annualNet = byMonth.reduce((a, b) => a + b, 0);
  const annualGross = hs.reduce((a, h) => a + Math.max(0, h.value) * (h.yield / 100), 0);

  // --- projection
  // The stated assumption is that price tracks the dividend, so the yield on a
  // unit of capital stays at today's blended rate. Growth therefore shows up
  // once, in the capital, and income is simply capital times that yield.
  // Compounding growth into both would double-count it.
  const g = s.growth / 100;
  const blended = invested > 0 ? annualGross / invested : 0;
  const H = s.horizon;
  const yrs = [], incomeNet = [], billsLine = [], capital = [];

  const run = (reinvest, addMonthly) => {
    let c = invested, cash = 0;
    const inc = [c * blended * (1 - taxRate)];
    const caps = [c];
    for (let y = 1; y <= H; y++) {
      const net = c * blended * (1 - taxRate);
      if (!reinvest) cash += net;
      c = c * (1 + g) + (reinvest ? net : 0) + addMonthly * 12;
      caps.push(c);
      inc.push(c * blended * (1 - taxRate));
    }
    return { inc, caps, endCapital: c, endIncome: inc[H], totalCash: cash };
  };

  const main = run(s.reinvest, s.addMonthly);
  for (let y = 0; y <= H; y++) {
    yrs.push(y);
    capital.push(main.caps[y]);
    incomeNet.push(main.inc[y]);
    billsLine.push(s.spend * 12 * Math.pow(1 + 0.022, y));  // bills drift with inflation
  }

  const coverIdx = incomeNet.findIndex((v, i) => v >= billsLine[i]);
  const noReinvest = run(false, s.addMonthly);
  const withReinvest = run(true, s.addMonthly);

  const contribByHolding = hs.map((h, i) => ({
    name: h.name,
    value: Math.max(0, h.value) * (h.yield / 100) * (1 - taxRate),
    color: PALETTE[i % PALETTE.length],
  }));
  const topShare = annualNet > 0
    ? Math.max(...contribByHolding.map((c) => c.value)) / annualNet * 100 : 0;

  return {
    hs, invested, byMonth, namesByMonth, annualNet, annualGross, blended,
    yrs, incomeNet, billsLine, capital,
    coverYear: coverIdx >= 0 ? coverIdx : null,
    yocLater: invested > 0 ? (incomeNet[H] / invested) * 100 : 0,
    noReinvest, withReinvest, contribByHolding, topShare,
  };
}

/* ------------------------------------------------------------------- ui */

const $ = (s) => document.querySelector(s);
const els = {};
let store, last = null, lastCovered = null;

function escapeHtml(x) {
  return String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(s) {
  setCurrency(s.cur);
  const a = analyse(s);
  last = { s, a };

  countTo(els.vYear, a.annualNet, money);
  els.fYear.textContent = `${money(a.annualNet / 12)} a month on average, ${pct(a.blended * 100, 2)} blended yield`;

  const mx = Math.max(...a.byMonth), mn = Math.min(...a.byMonth);
  countTo(els.vMonth, mx, money);
  els.fMonth.textContent = mn === 0
    ? `${a.byMonth.filter((v) => v === 0).length} months pay nothing at all`
    : `against ${money(mn)} in the quietest month`;

  countTo(els.vCover, a.coverYear ?? NaN, (v) => (isFinite(v) ? (v === 0 ? 'already' : fmtYears(v)) : 'not within horizon'));
  els.vCover.style.fontSize = a.coverYear == null ? '1.15rem' : '';
  els.vCover.className = 'metric__value num ' + (a.coverYear != null ? 'metric__value--pos' : '');
  els.fCover.textContent = a.coverYear != null
    ? `income passes ${money(s.spend)} a month, both rising`
    : `income reaches ${money(a.incomeNet[s.horizon] / 12)} a month by year ${s.horizon}`;

  const covered = a.coverYear != null;
  if (lastCovered !== null && covered !== lastCovered) flash(els.mCover);
  lastCovered = covered;

  countTo(els.vYoc, a.yocLater, (v) => pct(v, 1));
  els.fYoc.textContent = `on the ${money(a.invested)} invested today, in year ${s.horizon}`;

  // --- calendar
  const peak = mx;
  $('#cal').innerHTML = MONTHS.map((m, i) => {
    const v = a.byMonth[i];
    const names = a.namesByMonth[i];
    return `<div class="cal__cell${v === 0 ? ' cal__cell--zero' : ''}${v === peak && v > 0 ? ' cal__cell--peak' : ''}">
      <span class="cal__month">${m}</span>
      <span class="cal__amt">${v > 0 ? money(v) : '—'}</span>
      <span class="cal__names">${names.length ? names.map(escapeHtml).join(', ') : 'nothing due'}</span>
      ${v > 0 ? `<span class="cal__spark" style="width:${(v / peak) * 100}%"></span>` : ''}
    </div>`;
  }).join('');
  $('#calNote').textContent = `after ${pct(s.tax, 0)} tax`;

  // --- income against bills
  lineChart($('#chart'), {
    series: [
      { key: 'inc', label: 'Dividend income', values: a.incomeNet, color: '--accent', area: true, areaOpacity: 0.1 },
      { key: 'bills', label: 'Spending', values: a.billsLine, color: '--clay-400', dashed: true, width: 1.5 },
    ],
    x: { values: a.yrs, format: (v) => (v === 0 ? 'now' : 'yr ' + v), readoutLabel: 'Year' },
    y: { format: moneyShort },
    markers: a.coverYear != null ? [{ x: a.coverYear, label: 'income covers spending' }] : [],
    height: 340,
    readout: $('#readout'),
    readout_empty: 'Hover to compare income and spending in any year',
    table: { caption: 'Dividend income against spending by year', xLabel: 'Year' },
  });
  $('#legend').innerHTML =
    '<span class="legend__item"><span class="legend__swatch" style="background:var(--accent)"></span>Income, after tax</span>' +
    '<span class="legend__item"><span class="legend__swatch" style="background:var(--clay-400)"></span>Spending, with inflation</span>';

  // --- reinvest argument
  const gap = a.withReinvest.endIncome - a.noReinvest.endIncome;
  els.riClaim.innerHTML = s.reinvest
    ? `Reinvesting buys <span class="num c-pos">${money(gap)}</span> more income a year by year ${s.horizon}.`
    : `Spending the dividends costs <span class="num c-neg">${money(gap)}</span> of yearly income by year ${s.horizon}.`;
  els.riSub.textContent = `Taking the cash gives you ${money(a.noReinvest.totalCash)} to spend along the way. Reinvesting gives that up for a larger, growing income later. Neither is wrong; they answer different questions.`;
  const bars = [
    { label: `Reinvested, income in year ${s.horizon}`, v: a.withReinvest.endIncome, color: '--sage-400' },
    { label: `Spent, income in year ${s.horizon}`, v: a.noReinvest.endIncome, color: '--slate-400' },
  ];
  const bmx = Math.max(...bars.map((b) => b.v), 1);
  els.riBars.innerHTML = bars.map((b) => `<div class="fee-bar">
      <div class="fee-bar__top"><span>${b.label}</span><span class="num">${money(b.v)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(b.v / bmx) * 100}%;background:var(${b.color})"></div></div>
    </div>`).join('');

  // --- concentration
  donut($('#donut'), a.contribByHolding.map((c) => ({ ...c, value: Math.max(0.0001, c.value) })), {
    centerTop: pct(a.topShare, 0),
    centerBottom: 'from the largest',
    label: 'Share of income by holding',
  });
  $('#conList').innerHTML = a.contribByHolding.map((c) => `
    <div class="alloc-row">
      <span class="alloc-row__name"><span class="alloc-row__dot" style="background:var(${c.color})"></span>${escapeHtml(c.name)}</span>
      <span class="num" style="font-size:var(--t-sm)">${money(c.value)}</span>
      <span class="alloc-row__bar"><span class="bar-track"><span class="bar-fill" style="width:${a.annualNet > 0 ? (c.value / a.annualNet) * 100 : 0}%;background:var(${c.color})"></span></span></span>
    </div>`).join('');

  $('#posValue').textContent = money(a.invested);
  syncRail(s);
}

function renderHoldings(s) {
  $('#holdings').innerHTML = s.holdings.map((h, i) => `
    <div class="holding" data-row="${i}">
      <span class="holding__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>
      <input class="holding__name" value="${escapeHtml(h.name)}" data-k="name" aria-label="Holding ${i + 1} name">
      <input class="holding__num" type="number" value="${h.value}" data-k="value" step="50000" min="0" aria-label="Holding ${i + 1} value">
      <input class="holding__num" type="number" value="${h.yield}" data-k="yield" step="0.1" min="0" max="30" aria-label="Holding ${i + 1} yield percent">
      <button class="holding__del" type="button" data-del="${i}" aria-label="Remove ${escapeHtml(h.name)}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
      </button>
    </div>`).join('');

  // Pay schedule lives below the row so the grid stays scannable.
  $('#schedules').innerHTML = s.holdings.map((h, i) => `
    <div class="field" style="margin-bottom:var(--s3)">
      <span class="field__label" style="font-size:var(--t-xs);color:var(--ink-muted)">
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span class="holding__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>${escapeHtml(h.name)}
        </span>
        <span>${payMonths(h).map((m) => MONTHS[m]).join(' · ')}</span>
      </span>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s2)">
        <select class="holding__num" data-sched="${i}" data-k="freq" aria-label="${escapeHtml(h.name)} frequency" style="text-align:left">
          ${Object.entries(FREQ).map(([f, label]) => `<option value="${f}"${Number(f) === h.freq ? ' selected' : ''}>${label}</option>`).join('')}
        </select>
        <select class="holding__num" data-sched="${i}" data-k="start" aria-label="${escapeHtml(h.name)} first pay month" style="text-align:left">
          ${MONTHS.map((m, mi) => `<option value="${mi + 1}"${mi + 1 === h.start ? ' selected' : ''}>from ${m}</option>`).join('')}
        </select>
      </div>
    </div>`).join('');
}

function syncRail(s) {
  const set = (id, v) => { const n = $('#' + id); if (n && document.activeElement !== n) n.value = v; };
  set('growth', s.growth); set('horizon', s.horizon); set('tax', s.tax);
  set('spend', s.spend); set('addMonthly', s.addMonthly);
  $('#growthOut').textContent = pct(s.growth, 1);
  $('#horizonOut').textContent = s.horizon;
  $('#taxOut').textContent = pct(s.tax, 0);
  $('#growthNote').textContent =
    s.growth <= 1 ? 'flat payer' : s.growth <= 4 ? 'modest raiser' :
    s.growth <= 8 ? 'steady raiser' : s.growth <= 12 ? 'fast grower' : 'unsustainable';
  $('#reinvest').setAttribute('aria-checked', String(s.reinvest));
  document.querySelectorAll('[data-cur-symbol]').forEach((n) => { n.textContent = curSymbol(); });
  repaint();
}

let repaint = () => {};

function boot() {
  mountShell({ base: '../', tool: 'dividend' });
  ['vYear', 'vMonth', 'vCover', 'vYoc', 'fYear', 'fMonth', 'fCover', 'fYoc',
   'mCover', 'riClaim', 'riSub', 'riBars'].forEach((id) => { els[id] = $('#' + id); });

  store = createStore('dividend', DEFAULTS, debounce(render, 0));
  renderHoldings(store.get());

  $('#holdings').addEventListener('input', (e) => {
    const row = e.target.closest('[data-row]');
    if (!row) return;
    const i = Number(row.dataset.row), k = e.target.dataset.k;
    const holdings = store.read('holdings').map((h) => ({ ...h }));
    holdings[i][k] = k === 'name' ? e.target.value : Number(e.target.value) || 0;
    store.set({ holdings });
    if (k === 'name') {
      const lbl = $(`#schedules .field:nth-child(${i + 1}) .field__label span span:last-child`);
      if (lbl) lbl.textContent = e.target.value;
    }
  });
  $('#holdings').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const holdings = store.read('holdings').filter((_, x) => x !== Number(del.dataset.del));
    if (!holdings.length) { toast('Keep at least one holding'); return; }
    store.set({ holdings });
    renderHoldings(store.get());
  });
  $('#schedules').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-sched]');
    if (!sel) return;
    const i = Number(sel.dataset.sched);
    const holdings = store.read('holdings').map((h) => ({ ...h }));
    holdings[i][sel.dataset.k] = Number(sel.value);
    store.set({ holdings });
    renderHoldings(store.get());
  });

  $('#btnAdd').addEventListener('click', () => {
    const holdings = [...store.read('holdings'), { name: 'New holding', value: 0, yield: 3, freq: 4, start: 2 }];
    store.set({ holdings });
    renderHoldings(store.get());
    const rows = $('#holdings').querySelectorAll('.holding__name');
    rows[rows.length - 1]?.focus();
    rows[rows.length - 1]?.select();
  });

  bindNumber($('[data-num="spend"]'), { step: 5000, min: 0, max: 1e9, onInput: (v) => store.set({ spend: v }) });
  bindNumber($('[data-num="addMonthly"]'), { step: 5000, min: 0, max: 1e9, onInput: (v) => store.set({ addMonthly: v }) });

  const painters = [];
  [['growth', (v) => pct(v, 1)], ['horizon', String], ['tax', (v) => pct(v, 0)]].forEach(([id, fmt]) => {
    painters.push(bindRange($('#' + id), (v) => { $('#' + id + 'Out').textContent = fmt(v); store.set({ [id]: v }); }));
  });
  repaint = () => painters.forEach((p) => p());

  $('#reinvest').addEventListener('click', () => store.set({ reinvest: !store.read('reinvest') }));
  $('#curSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]');
    if (!b) return;
    $('#curSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const st = CURRENCIES[b.dataset.cur];
    $('#spend').step = st.step * 5; $('#addMonthly').step = st.step * 5;
    store.set({ cur: b.dataset.cur });
  });

  $('#btnShare').addEventListener('click', () => copyText(store.shareUrl(), 'Link copied. It carries your holdings.'));
  $('#btnReset').addEventListener('click', () => { store.reset(); renderHoldings(store.get()); });

  render(store.get());
  enterWorkbench();
  revealOnScroll();
  window.addEventListener('ledger:theme', () => render(store.get()));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
