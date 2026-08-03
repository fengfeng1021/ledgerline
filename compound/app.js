/* Compound — contributions, fees, inflation.
   The model runs monthly because contributions arrive monthly. */

import {
  money, moneyShort, pct, num, years as fmtYears, setCurrency, curSymbol, CURRENCIES,
  createStore, bindNumber, bindRange, debounce, copyText, downloadCSV, mountShell, clamp,
} from '../assets/js/core.js';
import { lineChart } from '../assets/js/chart.js';
import { countTo, flash, enterWorkbench, revealOnScroll } from '../assets/js/motion.js';

const DEFAULTS = {
  initial: 100000, monthly: 10000, raise: 2,
  rate: 7, years: 25, fee: 0.3, inflation: 2.2,
  real: true, cur: 'TWD', scenario: 'A',
  // Scenario B overrides. Null until forked.
  b: null,
};

/* ---------------------------------------------------------------- model */

/**
 * Monthly projection.
 * Net return applies the fee geometrically: a fund charging f% of assets
 * delivers (1+r)(1-f)-1, not r-f. The difference matters over 25 years.
 */
function project(p) {
  const months = Math.round(p.years * 12);
  const gross = Math.pow(1 + p.rate / 100, 1 / 12) - 1;
  const netAnnual = (1 + p.rate / 100) * (1 - p.fee / 100) - 1;
  const net = Math.pow(1 + netAnnual, 1 / 12) - 1;
  const infM = Math.pow(1 + p.inflation / 100, 1 / 12) - 1;
  const raiseM = Math.pow(1 + p.raise / 100, 1 / 12) - 1;

  let bal = p.initial;        // with fees
  let balNoFee = p.initial;   // counterfactual, fee = 0
  let paid = p.initial;
  let paidReal = p.initial;   // each contribution deflated to today at the time it is made
  let contrib = p.monthly;
  let feesPaid = 0;

  const yr = {
    year: [0], balance: [bal], real: [bal], paid: [paid], paidReal: [paidReal],
    gain: [0], fees: [0], noFee: [bal],
  };
  let crossover = -1;

  for (let m = 1; m <= months; m++) {
    const before = bal;
    bal = bal * (1 + net) + contrib;
    balNoFee = balNoFee * (1 + gross) + contrib;
    feesPaid += before * (gross - net);
    paid += contrib;
    paidReal += contrib / Math.pow(1 + infM, m);
    contrib *= 1 + raiseM;

    if (crossover < 0 && bal - paid > paid) crossover = m;

    if (m % 12 === 0) {
      const y = m / 12;
      yr.year.push(y);
      yr.balance.push(bal);
      yr.paid.push(paid);
      yr.paidReal.push(paidReal);
      yr.gain.push(bal - paid);
      yr.fees.push(feesPaid);
      yr.noFee.push(balNoFee);
      yr.real.push(bal / Math.pow(1 + infM, m));
    }
  }

  const deflator = Math.pow(1 + infM, months);
  const endReal = bal / deflator;
  return {
    ...yr,
    months,
    end: bal,
    endReal,
    paidTotal: paid,
    paidTotalReal: paidReal,
    gainTotal: bal - paid,
    // Real gain is measured against real contributions, so the three headline
    // numbers still add up when the display is switched to today's money.
    gainTotalReal: endReal - paidReal,
    feesTotal: feesPaid,
    feeCost: balNoFee - bal,
    feeCostReal: (balNoFee - bal) / deflator,
    feeCostPct: balNoFee > 0 ? ((balNoFee - bal) / balNoFee) * 100 : 0,
    endNoFee: balNoFee,
    endNoFeeReal: balNoFee / deflator,
    crossoverYears: crossover > 0 ? crossover / 12 : null,
    deflator,
  };
}

/** Round-number balance milestones, so progress is legible before year 25. */
function milestones(res, p, showReal) {
  const track = showReal ? res.real : res.balance;
  const end = track[track.length - 1];
  if (!(end > 0)) return [];
  const mag = Math.pow(10, Math.floor(Math.log10(end)));
  const steps = [mag, mag * 2.5, mag * 5, mag * 10].filter((v) => v <= end * 1.001);
  const out = [];
  for (const target of steps.slice(-4)) {
    const i = track.findIndex((b) => b >= target);
    if (i > 0) out.push({ target, year: i, share: i / p.years });
  }
  return out;
}

/* ------------------------------------------------------------------- ui */

const $ = (s) => document.querySelector(s);
const els = {};
let store, lastResult = null, lastCrossState = null;

function paramsFor(s, which) {
  if (which === 'B' && s.b) return { ...s, ...s.b };
  return s;
}

function render(state) {
  setCurrency(state.cur);
  const pA = paramsFor(state, 'A');
  const resA = project(pA);
  const hasB = !!state.b;
  const pB = hasB ? paramsFor(state, 'B') : null;
  const resB = hasB ? project(pB) : null;
  const active = state.scenario === 'B' && hasB ? resB : resA;
  const activeP = state.scenario === 'B' && hasB ? pB : pA;
  lastResult = { resA, resB, pA, pB, active, activeP, state };

  // --- headline metrics
  // Every metric follows the same basis, so ending = put in + gain always holds.
  const showReal = state.real;
  const endVal = showReal ? active.endReal : active.end;
  const inVal = showReal ? active.paidTotalReal : active.paidTotal;
  const gainVal = showReal ? active.gainTotalReal : active.gainTotal;
  const feeVal = showReal ? active.feeCostReal : active.feeCost;

  countTo(els.vEnd, endVal, money);
  els.endMode.textContent = showReal ? "in today's money" : 'nominal';
  els.fEnd.textContent = showReal
    ? `${money(active.end)} on the statement, worth ${pct((active.endReal / active.end) * 100, 0)} of that after ${pct(activeP.inflation)} inflation`
    : `${money(active.endReal)} in today's purchasing power`;

  countTo(els.vIn, inVal, money);
  els.fIn.textContent = showReal
    ? `${money(active.paidTotal)} of actual cash, deflated to today as you paid it`
    : `${money(activeP.initial)} to start, then ${money(activeP.monthly)} a month`;

  countTo(els.vGain, gainVal, money);
  const multiple = inVal > 0 ? endVal / inVal : 0;
  els.fGain.textContent = `${num(multiple, 2)}x what you put in`;

  countTo(els.vFee, feeVal, money);
  els.fFee.textContent = `${pct(active.feeCostPct)} of the balance you would otherwise have`;

  // Threshold: gains overtaking contributions is the moment compounding takes over.
  const crossed = active.crossoverYears != null && active.crossoverYears <= activeP.years;
  if (lastCrossState !== null && crossed !== lastCrossState) flash(els.mGain);
  lastCrossState = crossed;

  // --- chart
  const yFmt = (v) => moneyShort(v);
  const series = [
    { key: 'bal', label: showReal ? "Balance, today's money" : 'Balance', values: showReal ? resA.real : resA.balance, color: '--accent', area: true, areaOpacity: 0.1 },
    { key: 'paid', label: 'Contributions', values: resA.paid, color: '--slate-400' },
  ];
  if (hasB) {
    series.push({
      key: 'balB', label: 'Plan B', values: showReal ? resB.real : resB.balance,
      color: '--plum-400', dashed: true,
    });
  }
  const markers = [];
  if (resA.crossoverYears != null) {
    markers.push({ x: Math.round(resA.crossoverYears), label: 'gains overtake contributions' });
  }

  lineChart($('#chart'), {
    series,
    x: { values: resA.year, format: (v) => (v === 0 ? 'now' : 'yr ' + v), readoutLabel: 'Year' },
    y: { format: yFmt },
    markers,
    height: 380,
    readout: $('#readout'),
    readout_empty: 'Hover the chart to read any year',
    table: { caption: 'Projected balance by year', xLabel: 'Year' },
  });

  $('#legend').innerHTML = series
    .map((s) => `<span class="legend__item"><span class="legend__swatch" style="background:var(${s.color})"></span>${s.label}</span>`)
    .join('');

  // --- fee argument
  const feeYears = active.feeCost > 0 && activeP.monthly > 0
    ? active.feeCost / (activeP.monthly * 12) : 0;
  els.feeClaim.innerHTML = activeP.fee <= 0
    ? `A zero-fee fund keeps <span class="num">${money(endVal)}</span> in your account.`
    : `A <span class="num">${pct(activeP.fee, 2)}</span> fee costs you <span class="num c-neg">${money(feeVal)}</span>.`;
  els.feeSub.textContent = activeP.fee <= 0
    ? 'Move the fee slider to see what a percentage point actually buys the fund manager.'
    : `That is ${pct(active.feeCostPct)} of your final balance, or about ${fmtYears(feeYears)} of contributions handed over.`;

  const high = project({ ...activeP, fee: 1.5 });
  const bars = [
    { label: 'No fee', v: showReal ? active.endNoFeeReal : active.endNoFee, color: '--sage-400' },
    { label: pct(activeP.fee, 2) + ' fee', v: endVal, color: '--accent' },
    { label: '1.50% fee', v: showReal ? high.endReal : high.end, color: '--clay-400' },
  ];
  const maxBar = Math.max(...bars.map((b) => b.v)) || 1;
  els.feeBars.innerHTML = bars
    .map((b) => `<div class="fee-bar">
      <div class="fee-bar__top"><span>${b.label}</span><span class="num">${money(b.v)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(b.v / maxBar) * 100}%;background:var(${b.color})"></div></div>
    </div>`)
    .join('');

  // --- milestones
  const ms = milestones(active, activeP, showReal);
  els.miles.innerHTML = ms.length
    ? ms.map((m) => `<div class="mile">
        <div class="mile__val num">${money(m.target)}</div>
        <div class="mile__meta">reached in year <b class="num">${m.year}</b></div>
        <div class="bar-track" style="grid-column:1/-1;margin-top:8px"><div class="bar-fill" style="width:${clamp(m.share * 100, 2, 100)}%"></div></div>
      </div>`).join('')
    : '<div class="empty"><p class="empty__title">No milestone yet</p><p>Raise the contribution or extend the horizon and the first round number will appear here.</p></div>';

  // --- table
  const rows = resA.year.map((y, i) =>
    `<tr${resA.crossoverYears != null && y === Math.round(resA.crossoverYears) ? ' class="is-marker"' : ''}>
      <td>${y}</td>
      <td class="c-mute">${money(resA.paid[i])}</td>
      <td>${money(resA.balance[i])}</td>
      <td class="c-pos">${money(resA.gain[i])}</td>
      <td class="c-neg">${money(resA.fees[i])}</td>
      <td class="c-mute">${money(resA.real[i])}</td>
    </tr>`).join('');
  $('#tbl tbody').innerHTML = rows;

  // --- scenario chip
  $('#chipBText').textContent = hasB ? 'Plan B' : 'Compare';
  $('#chipA').setAttribute('aria-pressed', String(state.scenario === 'A' || !hasB));
  $('#chipB').setAttribute('aria-pressed', String(state.scenario === 'B' && hasB));

  syncRailToScenario(state);
}

/** When Plan B is active the rail edits B, so it must show B's numbers. */
function syncRailToScenario(state) {
  const p = paramsFor(state, state.scenario);
  const set = (id, v) => { const n = $('#' + id); if (n && document.activeElement !== n) n.value = v; };
  set('initial', p.initial); set('monthly', p.monthly);
  set('raise', p.raise); set('rate', p.rate); set('years', p.years);
  set('fee', p.fee); set('inflation', p.inflation);
  $('#raiseOut').textContent = pct(p.raise, 1);
  $('#rateOut').textContent = pct(p.rate, 1);
  $('#yearsOut').textContent = p.years;
  $('#feeOut').textContent = pct(p.fee, 2);
  $('#inflationOut').textContent = pct(p.inflation, 1);
  $('#annualEq').textContent = money(p.monthly * 12) + ' / yr';
  $('#feePreset').textContent =
    p.fee <= 0.12 ? 'broad index ETF' : p.fee <= 0.4 ? 'index fund' :
    p.fee <= 0.9 ? 'active fund' : p.fee <= 1.6 ? 'advisor + fund' : 'high cost';
  document.querySelectorAll('[data-cur-symbol]').forEach((n) => { n.textContent = curSymbol(); });
  $('#curName').textContent = state.cur;
  $('#realToggle').setAttribute('aria-checked', String(state.real));
  repaintRanges();
}

let repaintRanges = () => {};

/* ------------------------------------------------------------------ wire */

function patch(key, value) {
  const s = store.get();
  if (s.scenario === 'B' && s.b) store.set({ b: { ...s.b, [key]: value } });
  else store.set({ [key]: value });
}

function boot() {
  mountShell({ base: '../', tool: 'compound' });

  ['vEnd', 'vIn', 'vGain', 'vFee', 'fEnd', 'fIn', 'fGain', 'fFee', 'endMode',
   'mGain', 'feeClaim', 'feeSub', 'feeBars', 'miles'].forEach((id) => { els[id] = $('#' + id); });

  store = createStore('compound', DEFAULTS, debounce(render, 0));

  const painters = [];
  // numeric fields
  bindNumber($('[data-num="initial"]'), { step: 10000, min: 0, max: 1e12, onInput: (v) => patch('initial', v) });
  bindNumber($('[data-num="monthly"]'), { step: 1000, min: 0, max: 1e10, onInput: (v) => patch('monthly', v) });
  // ranges
  const ranges = [
    ['raise', (v) => pct(v, 1)], ['rate', (v) => pct(v, 1)], ['years', (v) => String(v)],
    ['fee', (v) => pct(v, 2)], ['inflation', (v) => pct(v, 1)],
  ];
  ranges.forEach(([id, fmt]) => {
    const input = $('#' + id), out = $('#' + id + 'Out');
    painters.push(bindRange(input, (v) => { out.textContent = fmt(v); patch(id, v); }));
  });
  repaintRanges = () => painters.forEach((p) => p());

  $('#realToggle').addEventListener('click', () => {
    store.set({ real: !store.read('real') });
  });

  $('#curSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]');
    if (!b) return;
    $('#curSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const cur = b.dataset.cur;
    // Step sizes differ by currency: NT$1,000 and $100 are the same gesture.
    const s = CURRENCIES[cur];
    $('#initial').step = s.step * 10;
    $('#monthly').step = s.step;
    store.set({ cur });
  });

  $('#chipA').addEventListener('click', () => store.set({ scenario: 'A' }));
  $('#chipB').addEventListener('click', () => {
    const s = store.get();
    if (!s.b) {
      // Fork B from A, then nudge the return so the comparison shows something.
      const { initial, monthly, raise, rate, years, fee, inflation } = s;
      store.set({ b: { initial, monthly, raise, rate: Math.max(0, rate - 2), years, fee, inflation }, scenario: 'B' });
    } else {
      store.set({ scenario: 'B' });
    }
  });

  $('#btnShare').addEventListener('click', () => copyText(store.shareUrl(), 'Link copied. It carries your numbers.'));
  $('#btnReset').addEventListener('click', () => { store.reset(); });

  $('#btnCsv').addEventListener('click', () => {
    const { resA } = lastResult;
    const rows = [['Year', 'Contributed', 'Balance', 'Gain', 'Fees paid', "Today's money"]];
    resA.year.forEach((y, i) => rows.push([
      y, Math.round(resA.paid[i]), Math.round(resA.balance[i]),
      Math.round(resA.gain[i]), Math.round(resA.fees[i]), Math.round(resA.real[i]),
    ]));
    downloadCSV('ledgerline-compound.csv', rows);
  });

  render(store.get());
  enterWorkbench();
  revealOnScroll();
  window.addEventListener('ledger:theme', () => render(store.get()));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
