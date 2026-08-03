/* Ledgerline hub - the working hero instrument, the scroll story, the tool grid.
   Every number on this page is computed by the same arithmetic the tools use. */

import {
  money, moneyShort, pct, setCurrency, mountShell, debounce, bindRange, clamp, t, escapeHtml, yearLabel,
} from './core.js';
import { detectCurrency } from './i18n.js';
import { loadProfile, hasProfile, derive } from './profile.js';
import { lineChart } from './chart.js';
import { countTo, hubStory, bindToolCards, revealOnScroll, refreshScroll, MOTION_OK } from './motion.js';

setCurrency(detectCurrency());

/* ------------------------------------------------------- shared model */

/** Same monthly engine as the Compound tool, kept small. */
function project({ initial = 0, monthly, years, rate, fee = 0, inflation = 0 }) {
  const months = Math.round(years * 12);
  const gross = Math.pow(1 + rate / 100, 1 / 12) - 1;
  const netAnnual = (1 + rate / 100) * (1 - fee / 100) - 1;
  const net = Math.pow(1 + netAnnual, 1 / 12) - 1;
  const infM = Math.pow(1 + inflation / 100, 1 / 12) - 1;

  let bal = initial, noFee = initial, paid = initial, paidReal = initial;
  const yr = { year: [0], bal: [bal], noFee: [noFee], real: [bal] };
  for (let m = 1; m <= months; m++) {
    bal = bal * (1 + net) + monthly;
    noFee = noFee * (1 + gross) + monthly;
    paid += monthly;
    paidReal += monthly / Math.pow(1 + infM, m);
    if (m % 12 === 0) {
      yr.year.push(m / 12);
      yr.bal.push(bal);
      yr.noFee.push(noFee);
      yr.real.push(bal / Math.pow(1 + infM, m));
    }
  }
  const deflator = Math.pow(1 + infM, months);
  const endReal = bal / deflator;
  return {
    ...yr, paid, end: bal, endNoFee: noFee, endReal,
    feeCost: noFee - bal, gain: bal - paid,
    // Real basis, so the three figures under the headline still add up to it.
    paidReal, gainReal: endReal - paidReal, feeCostReal: (noFee - bal) / deflator,
  };
}

/* ------------------------------------------------- hero: live instrument */

const $ = (s) => document.querySelector(s);

const inst = { monthly: 10000, fee: 0.3, rate: 7, years: 25, inflation: 2.2 };

function renderInstrument(animate = true) {
  const r = project(inst);
  const el = (id) => document.getElementById(id);

  // All four figures share the same basis: today's money. Mixing a real headline
  // with nominal supporting numbers would make the gain look bigger than the total.
  if (animate) {
    countTo(el('instValue'), r.endReal, money);
    countTo(el('instIn'), r.paidReal, money);
    countTo(el('instGain'), r.gainReal, money);
    countTo(el('instFeeCost'), r.feeCostReal, money);
  } else {
    el('instValue').textContent = money(r.endReal);
    el('instIn').textContent = money(r.paidReal);
    el('instGain').textContent = money(r.gainReal);
    el('instFeeCost').textContent = money(r.feeCostReal);
  }
  el('instLive').textContent = t('hub.instLive', { rate: pct(inst.rate), fee: pct(inst.fee, 2) });

  lineChart($('#instChart'), {
    series: [
      { key: 'real', label: t('compound.legendReal'), values: r.real, color: '--accent', area: true, areaOpacity: 0.11 },
      { key: 'paid', label: t('compound.legendPaid'), values: r.year.map((y) => inst.monthly * 12 * y), color: '--slate-400', width: 1.5 },
    ],
    x: { values: r.year, format: yearLabel, readoutLabel: t('common.year') },
    y: { format: moneyShort },
    height: 190,
    endLabels: false,
    table: { caption: t('compound.chartTitle'), xLabel: t('common.year') },
  });
}

/* --------------------------------------------------- story: scroll = time */

const STORY = { monthly: 10000, years: 30, rate: 7, fee: 1.5, inflation: 2.2 };
const storyFull = project(STORY);

function renderStory(progress) {
  const p = clamp(progress, 0, 1);
  const maxY = STORY.years;
  const upto = Math.max(1, Math.round(p * maxY));

  const year = storyFull.year.slice(0, upto + 1);
  const noFee = storyFull.noFee.slice(0, upto + 1);
  const real = storyFull.real.slice(0, upto + 1);

  $('#storyYear').textContent = t('hub.storyYear', { n: upto });
  $('#storyPhase').textContent = t(
    upto < 8 ? 'hub.phase1' : upto < 18 ? 'hub.phase2' : upto < 26 ? 'hub.phase3' : 'hub.phase4');

  lineChart($('#storyChart'), {
    series: [
      { key: 'nofee', label: t('hub.legendBefore'), values: noFee, color: '--slate-400', width: 1.5 },
      { key: 'real', label: t('hub.legendAfter'), values: real, color: '--accent', area: true, areaOpacity: 0.11 },
    ],
    x: { values: year, format: yearLabel },
    y: { format: moneyShort, min: 0, max: storyFull.endNoFee * 1.05 },
    height: 260,
    endLabels: false,
    table: { caption: t('hub.storyTitle'), xLabel: t('common.year') },
  });

  const i = upto;
  const gross = storyFull.noFee[i];
  const afterFee = storyFull.bal[i];
  const realNow = storyFull.real[i];
  $('#stepGross').textContent = money(gross);
  $('#stepFee').textContent = '-' + money(gross - afterFee);
  $('#stepInf').textContent = '-' + money(afterFee - realNow);
  $('#stepReal').textContent = money(realNow);
}

/* ------------------------------------------------------------ tool grid */

/** Each card's sparkline is a real curve from that tool's own arithmetic. */
const CARDS = [
  {
    key: 'compound', path: 'compound/',
    curve: () => project({ monthly: 10000, years: 25, rate: 7, fee: 0.3, inflation: 2.2 }).real,
  },
  {
    key: 'fire', path: 'fire/',
    curve: () => {
      // Accumulate to a target, then draw down: the shape of the whole plan.
      const up = project({ initial: 2e6, monthly: 40000, years: 19, rate: 5 }).bal;
      const peak = up[up.length - 1];
      const down = Array.from({ length: 16 }, (_, i) => peak * Math.pow(0.985, i * 1.6));
      return up.concat(down);
    },
  },
  {
    key: 'rebalance', path: 'rebalance/',
    curve: () => Array.from({ length: 26 }, (_, i) =>
      60 + 12 * Math.sin(i / 2.4) + i * 0.55 + (i > 18 ? -6 : 0)),
  },
  {
    key: 'dividend', path: 'dividend/',
    curve: () => Array.from({ length: 24 }, (_, i) =>
      [0, 0, 42, 0, 0, 18, 0, 0, 51, 0, 0, 22][i % 12] + i * 1.2),
  },
  {
    key: 'mortgage', path: 'mortgage/',
    curve: () => {
      const P = 12e6, r = 0.0235 / 12, n = 360;
      const pmt = (P * r) / (1 - Math.pow(1 + r, -n)) + 5000;
      let b = P;
      const out = [];
      for (let m = 0; m <= n; m += 12) {
        out.push(Math.max(0, b));
        for (let k = 0; k < 12 && b > 0; k++) b = b * (1 + r) - pmt;
      }
      return out;
    },
  },
  {
    key: 'allocation', path: 'allocation/',
    curve: () => Array.from({ length: 30 }, (_, i) => {
      const x = i / 29;
      return 30 + 62 * Math.sqrt(x) * (1 - 0.18 * x);   // concave frontier shape
    }),
  },
];

function sparkPath(values, w = 300, h = 54) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - ((v - lo) / span) * (h - 4) - 2,
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const under = `${line} L${w},${h} L0,${h} Z`;
  return { line, under };
}

const cap = (k) => k[0].toUpperCase() + k.slice(1);

function renderTools() {
  $('#toolGrid').innerHTML = CARDS.map((c) => {
    const { line, under } = sparkPath(c.curve());
    return `<a class="tool-card" href="${c.path}">
      <div class="tool-card__top">
        <span class="tool-card__name">${escapeHtml(t(c.key + '.h1'))}</span>
        <span class="tool-card__go" aria-hidden="true">
          <svg viewBox="0 0 17 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5h10M9.5 4.5l4 4-4 4"/></svg>
        </span>
      </div>
      <div>
        <p class="tool-card__q">${escapeHtml(t('hub.cards' + cap(c.key)))}</p>
        <p class="tool-card__why">${escapeHtml(t('hub.why' + cap(c.key)))}</p>
      </div>
      <div class="tool-card__spark" aria-hidden="true">
        <svg viewBox="0 0 300 54" preserveAspectRatio="none">
          <path class="under" d="${under}"/><path d="${line}"/>
        </svg>
      </div>
    </a>`;
  }).join('');
}

/* ------------------------------------------------------------------ boot */

function boot() {
  mountShell({ base: './', tool: null });

  renderInstrument(false);
  renderTools();
  renderStory(0);

  const onMonthly = debounce((v) => { inst.monthly = v; renderInstrument(); }, 60);
  $('#instMonthlyOut').textContent = money(inst.monthly);
  $('#instFeeOut').textContent = pct(inst.fee, 2);
  bindRange($('#instMonthly'), (v) => {
    $('#instMonthlyOut').textContent = money(v);
    onMonthly(v);
  });
  const onFee = debounce((v) => { inst.fee = v; renderInstrument(); }, 60);
  bindRange($('#instFee'), (v) => {
    $('#instFeeOut').textContent = pct(v, 2);
    onFee(v);
  });

  // Scroll position is the model's time axis. That is the argument of the page.
  hubStory({ onProgress: (p) => renderStory(p) });
  bindToolCards();
  revealOnScroll('.claim__item');

  // If the visitor already has a file, the miniature runs on their own surplus
  // rather than a made-up number, which is the point being argued on this page.
  const P = loadProfile();
  if (hasProfile(P)) {
    const d = derive(P);
    setCurrency(P.currency);
    inst.monthly = clamp(Math.round(Math.max(0, d.surplus) / 1000) * 1000, 1000, 60000);
    inst.fee = P.assumptions.fee;
    inst.rate = P.assumptions.rate;
    inst.inflation = P.assumptions.inflation;
    $('#instMonthly').value = inst.monthly;
    $('#instFee').value = inst.fee;
    $('#instMonthlyOut').textContent = money(inst.monthly);
    $('#instFeeOut').textContent = pct(inst.fee, 2);
    renderInstrument(false);
  }

  window.addEventListener('ledger:locale', () => { renderTools(); renderInstrument(false); renderStory(1); });
  window.addEventListener('ledger:theme', () => { renderInstrument(false); renderStory(1); });
  window.addEventListener('load', () => refreshScroll());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
