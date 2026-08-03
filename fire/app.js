/* FIRE - accumulation, then withdrawal, with volatility.
   The point of this tool is that the second phase is where plans fail. */

import {
  money, moneyShort, pct, num, years as fmtYears, setCurrency, curSymbol, CURRENCIES,
  createStore, bindNumber, bindRange, debounce, copyText, downloadCSV, mountShell, clamp, yearLabel,
} from '../assets/js/core.js';
import { t } from '../assets/js/i18n.js';
import { mountProfileBridge } from '../assets/js/bridge.js';
import { lineChart, barChart } from '../assets/js/chart.js';
import { countTo, flash, enterWorkbench, revealOnScroll } from '../assets/js/motion.js';

const DEFAULTS = {
  nest: 2000000, income: 1200000, spend: 720000,
  rate: 5, vol: 14, fee: 0.25,
  swr: 4, horizon: 35, cutback: 10,
  cur: 'TWD',
};

const RUNS = 600;
const MAX_ACCUM = 60;

/* --------------------------------------------------------------- random */

/** Seeded so the same assumptions always produce the same odds. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Box-Muller, cached second value. */
function gaussFactory(rand) {
  let spare = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, s;
    do { u = rand() * 2 - 1; v = rand() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}

/* ---------------------------------------------------------------- model */

/** Deterministic accumulation using the mean return. Answers "how long". */
function accumulate(p) {
  const net = (1 + p.rate / 100) * (1 - p.fee / 100) - 1;
  const save = Math.max(0, p.income - p.spend);
  const target = p.spend * (100 / p.swr);
  let bal = p.nest;
  const path = [bal];
  let y = 0;
  while (bal < target && y < MAX_ACCUM) {
    bal = bal * (1 + net) + save;
    path.push(bal);
    y++;
  }
  const reached = bal >= target;
  return { path, years: reached ? y : null, target, save, net, reached, balAt: bal };
}

/**
 * Withdrawal simulation. Each run draws a fresh return sequence.
 * Flexibility: after a losing year, spending is cut by `cutback` for the next year,
 * which is what real people do and what makes a 4% rule survivable.
 */
function simulate(p, startBalance) {
  const rand = mulberry32(
    Math.round(p.rate * 97 + p.vol * 31 + p.swr * 13 + p.horizon * 7 + p.cutback * 3 + p.fee * 211)
  );
  const gauss = gaussFactory(rand);
  const mu = (1 + p.rate / 100) * (1 - p.fee / 100) - 1;
  const sigma = p.vol / 100;
  const baseSpend = p.spend;
  const flex = p.cutback / 100;

  const H = p.horizon;
  const endings = [];
  const byYear = Array.from({ length: H + 1 }, () => []);
  let survived = 0;
  let depletionYears = [];

  for (let r = 0; r < RUNS; r++) {
    let bal = startBalance;
    let alive = true;
    let lastBad = false;
    byYear[0].push(bal);
    for (let y = 1; y <= H; y++) {
      if (!alive) { byYear[y].push(0); continue; }
      const spend = baseSpend * (lastBad ? 1 - flex : 1);
      bal -= spend;
      if (bal <= 0) { alive = false; bal = 0; depletionYears.push(y); byYear[y].push(0); continue; }
      const ret = mu + sigma * gauss();
      bal *= 1 + ret;
      lastBad = ret < 0;
      if (bal <= 0) { alive = false; bal = 0; depletionYears.push(y); }
      byYear[y].push(bal);
    }
    if (alive) survived++;
    endings.push(bal);
  }

  const pctl = (arr, q) => {
    const s = [...arr].sort((a, b) => a - b);
    const i = clamp(Math.floor(q * (s.length - 1)), 0, s.length - 1);
    return s[i];
  };

  return {
    successRate: (survived / RUNS) * 100,
    p10: byYear.map((a) => pctl(a, 0.1)),
    p50: byYear.map((a) => pctl(a, 0.5)),
    p90: byYear.map((a) => pctl(a, 0.9)),
    medianEnd: pctl(endings, 0.5),
    worstEnd: pctl(endings, 0.05),
    medianDepletion: depletionYears.length ? pctl(depletionYears, 0.5) : null,
    depletionCount: depletionYears.length,
  };
}

/* ------------------------------------------------------------------- ui */

const $ = (s) => document.querySelector(s);
const els = {};
let store, last = null, lastOddsBand = null;

function render(state) {
  setCurrency(state.cur);
  const p = state;
  const acc = accumulate(p);
  const startBal = acc.reached ? acc.balAt : acc.target;
  const sim = simulate(p, startBal);
  last = { acc, sim, p };

  // --- metrics
  countTo(els.vYears, acc.years ?? NaN, (v) => (isFinite(v) ? fmtYears(v) : t('fire.mYearsNever')));
  els.vYears.style.fontSize = acc.reached ? '' : '1.15rem';
  els.fYears.textContent = acc.reached
    ? t('fire.fYears', { save: money(acc.save), pct: pct(acc.save / Math.max(1, p.income) * 100, 0) })
    : t('fire.fYearsNever', { gap: money(p.spend - p.income) });

  countTo(els.vTarget, acc.target, money);
  els.fTarget.textContent = t('fire.fTarget', { x: num(100 / p.swr, 1), swr: pct(p.swr) });

  countTo(els.vOdds, sim.successRate, (v) => pct(v, 0));
  els.vOdds.className = 'metric__value num ' +
    (sim.successRate >= 90 ? 'metric__value--pos' : sim.successRate >= 75 ? 'metric__value--accent' : 'metric__value--neg');
  els.fOdds.textContent = sim.depletionCount
    ? t('fire.fOddsFail', { fail: sim.depletionCount, n: RUNS, year: sim.medianDepletion })
    : t('fire.fOddsOk', { years: p.horizon });

  // Crossing 90% or 75% is a real change of situation, so it gets a flash.
  const band = sim.successRate >= 90 ? 'safe' : sim.successRate >= 75 ? 'tight' : 'fragile';
  if (lastOddsBand && band !== lastOddsBand) flash(els.mOdds);
  lastOddsBand = band;

  countTo(els.vMonthly, (acc.target * p.swr) / 100 / 12, money);
  els.fMonthly.textContent = t('fire.fMonthly');

  // --- main chart: accumulation then the simulated withdrawal fan
  const accYears = acc.path.length - 1;
  const totalYears = accYears + p.horizon;
  const xs = Array.from({ length: totalYears + 1 }, (_, i) => i);
  const median = xs.map((i) => (i <= accYears ? acc.path[i] : sim.p50[i - accYears]));
  const lo = xs.map((i) => (i <= accYears ? acc.path[i] : sim.p10[i - accYears]));
  const hi = xs.map((i) => (i <= accYears ? acc.path[i] : sim.p90[i - accYears]));
  const targetLine = xs.map(() => acc.target);

  lineChart($('#chart'), {
    series: [
      { key: 'mid', label: t('fire.legendMedian'), values: median, color: '--accent' },
      { key: 'target', label: t('fire.legendTarget'), values: targetLine, color: '--slate-400', dashed: true, width: 1.5, endLabel: t('fire.legendTarget') },
    ],
    band: { lo, hi, color: '--accent', opacity: 0.12 },
    x: { values: xs, format: yearLabel, readoutLabel: t('common.year') },
    y: { format: moneyShort },
    markers: acc.reached ? [{ x: accYears, label: t('fire.markerStop') }] : [],
    height: 400,
    readout: $('#readout'),
    readout_empty: t('common.hoverChart'),
    table: { caption: t('fire.pathTitle'), xLabel: t('common.year') },
  });

  $('#legend').innerHTML =
    `<span class="legend__item"><span class="legend__swatch" style="background:var(--accent)"></span>${t('fire.legendMedian')}</span>` +
    `<span class="legend__item"><span class="legend__swatch" style="background:var(--accent);opacity:.35;height:8px;border-radius:2px"></span>${t('fire.legendBand')}</span>` +
    `<span class="legend__item"><span class="legend__swatch" style="background:var(--slate-400)"></span>${t('fire.legendTarget')}</span>`;

  // --- withdrawal-rate sensitivity: the honest version of the 4% rule
  const rates = [3, 3.5, 4, 4.5, 5, 5.5];
  const odds = rates.map((r) => {
    const pr = { ...p, swr: r };
    const a2 = accumulate(pr);
    return simulate(pr, a2.reached ? a2.balAt : a2.target).successRate;
  });
  barChart($('#swrChart'), {
    series: [{
      key: 'odds', label: t('fire.oddsSurvive'), values: odds,
      color: '--accent',
    }],
    x: { values: rates, format: (v) => pct(v, v % 1 ? 1 : 0) },
    y: { format: (v) => pct(v, 0), max: 100 },
    stacked: false,
    height: 220,
    table: { caption: t('fire.oddsTitle'), xLabel: t('fire.swr') },
  });
  const safest = rates[odds.findIndex((o) => o >= 90)];
  $('#swrClaim').textContent = safest != null
    ? t('fire.swrClaim', { rate: pct(safest, safest % 1 ? 1 : 0), yours: pct(p.swr) })
    : t('fire.swrClaimNone');
  $('#simCount').textContent = t('fire.runsEach', { n: RUNS });

  // --- risk dials
  const yearsOfSpend = startBal / Math.max(1, p.spend);
  const firstFive = sim.p10[Math.min(5, sim.p10.length - 1)];
  $('#dials').innerHTML = [
    { k: t('fire.dialSeq'), v: pct((1 - firstFive / startBal) * 100, 0), note: t('fire.dialSeqNote') },
    { k: t('fire.dialCover'), v: fmtYears(yearsOfSpend), note: t('fire.dialCoverNote') },
    { k: t('fire.dialMedian'), v: moneyShort(sim.medianEnd), note: t('fire.dialMedianNote', { years: p.horizon }) },
    { k: t('fire.dialWorst'), v: moneyShort(sim.worstEnd), note: t('fire.dialWorstNote') },
  ].map((d) => `<div class="dial"><div class="dial__k">${d.k}</div>
      <div class="dial__v">${d.v}</div><div class="dial__note">${d.note}</div></div>`).join('');

  $('#riskNote').textContent = p.cutback > 0
    ? t('fire.riskNote', { pct: pct(p.cutback, 0) })
    : t('fire.riskNoteZero');

  // --- table
  const rows = xs.map((y) => {
    const inAccum = y <= accYears;
    const i = y - accYears;
    return `<tr${y === accYears && acc.reached ? ' class="is-marker"' : ''}>
      <td>${y}</td>
      <td class="c-mute">${inAccum ? t('fire.phaseSaving') : t('fire.phaseDrawing')}</td>
      <td>${money(median[y])}</td>
      <td class="${inAccum ? 'c-mute' : 'c-neg'}">${money(lo[y])}</td>
      <td class="${inAccum ? 'c-mute' : 'c-pos'}">${money(hi[y])}</td>
      <td class="c-mute">${inAccum ? money(p.spend) : money(p.spend)}</td>
    </tr>`;
  }).join('');
  $('#tbl tbody').innerHTML = rows;

  syncRail(state);
}

function syncRail(s) {
  const set = (id, v) => { const n = $('#' + id); if (n && document.activeElement !== n) n.value = v; };
  set('nest', s.nest); set('income', s.income); set('spend', s.spend);
  set('rate', s.rate); set('vol', s.vol); set('fee', s.fee);
  set('swr', s.swr); set('horizon', s.horizon); set('cutback', s.cutback);
  $('#rateOut').textContent = pct(s.rate, 1);
  $('#volOut').textContent = pct(s.vol, 0);
  $('#feeOut').textContent = pct(s.fee, 2);
  $('#swrOut').textContent = pct(s.swr, 1);
  $('#horizonOut').textContent = s.horizon;
  $('#cutbackOut').textContent = pct(s.cutback, 0);
  const sr = s.income > 0 ? ((s.income - s.spend) / s.income) * 100 : 0;
  $('#savingRate').textContent = sr >= 0
    ? t('fire.savingRate', { pct: pct(sr, 0) }) : t('fire.overspend', { pct: pct(-sr, 0) });
  $('#volNote').textContent = t(
    s.vol <= 6 ? 'fire.volBonds' : s.vol <= 11 ? 'fire.volCons' :
    s.vol <= 16 ? 'fire.volBalanced' : s.vol <= 21 ? 'fire.volEquity' : 'fire.volConc');
  $('#swrNote').textContent = t(
    s.swr <= 3.2 ? 'fire.swrVeryCautious' : s.swr <= 4.1 ? 'fire.swrRule' :
    s.swr <= 5 ? 'fire.swrAggressive' : 'fire.swrSpend');
  document.querySelectorAll('[data-cur-symbol]').forEach((n) => { n.textContent = curSymbol(); });
  $('#curName').textContent = s.cur;
  repaint();
}

let repaint = () => {};

function boot() {
  mountShell({ base: '../', tool: 'fire' });
  ['vYears', 'vTarget', 'vOdds', 'vMonthly', 'fYears', 'fTarget', 'fOdds', 'fMonthly', 'mOdds']
    .forEach((id) => { els[id] = $('#' + id); });

  store = createStore('fire', DEFAULTS, debounce(render, 0));

  bindNumber($('[data-num="nest"]'), { step: 100000, min: 0, max: 1e12, onInput: (v) => store.set({ nest: v }) });
  bindNumber($('[data-num="income"]'), { step: 100000, min: 0, max: 1e11, onInput: (v) => store.set({ income: v }) });
  bindNumber($('[data-num="spend"]'), { step: 50000, min: 0, max: 1e11, onInput: (v) => store.set({ spend: v }) });

  const painters = [];
  [['rate', (v) => pct(v, 1)], ['vol', (v) => pct(v, 0)], ['fee', (v) => pct(v, 2)],
   ['swr', (v) => pct(v, 1)], ['horizon', String], ['cutback', (v) => pct(v, 0)]]
    .forEach(([id, fmt]) => {
      painters.push(bindRange($('#' + id), (v) => { $('#' + id + 'Out').textContent = fmt(v); store.set({ [id]: v }); }));
    });
  repaint = () => painters.forEach((p) => p());

  $('#curSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]');
    if (!b) return;
    $('#curSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const s = CURRENCIES[b.dataset.cur];
    $('#nest').step = s.step * 100; $('#income').step = s.step * 100; $('#spend').step = s.step * 50;
    store.set({ cur: b.dataset.cur });
  });

  $('#btnShare').addEventListener('click', () => copyText(store.shareUrl(), t('common.copied')));
  $('#btnReset').addEventListener('click', () => store.reset());
  $('#btnCsv').addEventListener('click', () => {
    const { acc, sim, p } = last;
    const accYears = acc.path.length - 1;
    const rows = [[t('common.year'), t('fire.thPhase'), t('fire.thMedian'), t('fire.thUnlucky'), t('fire.thLucky'), t('fire.thSpend')]];
    for (let y = 0; y <= accYears + p.horizon; y++) {
      const inA = y <= accYears, i = y - accYears;
      rows.push([y, inA ? t('fire.phaseSaving') : t('fire.phaseDrawing'),
        Math.round(inA ? acc.path[y] : sim.p50[i]),
        Math.round(inA ? acc.path[y] : sim.p10[i]),
        Math.round(inA ? acc.path[y] : sim.p90[i]),
        Math.round(p.spend)]);
    }
    downloadCSV('ledgerline-fire.csv', rows);
  });

  mountProfileBridge('fire', store, { afterAdopt: () => render(store.get()) });

  render(store.get());
  enterWorkbench();
  revealOnScroll();
  window.addEventListener('ledger:theme', () => render(store.get()));
  window.addEventListener('ledger:locale', () => render(store.get()));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
