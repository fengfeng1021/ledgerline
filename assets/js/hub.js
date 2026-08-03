/* Ledgerline hub - the working hero instrument, the scroll story, the tool grid.
   Every number on this page is computed by the same arithmetic the tools use. */

import {
  money, moneyShort, pct, setCurrency, mountShell, debounce, bindRange, clamp, t, escapeHtml, yearLabel,
  years as fmtYears,
} from './core.js';
import { detectCurrency } from './i18n.js';
import { loadProfile, hasProfile, derive, demoProfile, payMonths, CLASSES } from './profile.js';
import { monthNames } from './i18n.js';
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

/* ---------------------------------------------------- hero: the dashboard

   The visitor decides in about three seconds, and they decide on what they can
   see, not on a feature list. So the first thing on screen is a whole financial
   position already assembled: net worth and its curve, the mix, the monthly
   numbers, and what to do about it. Every figure is computed here, from the
   same functions the real page uses. */

const $ = (s) => document.querySelector(s);

const CLASS_COLOR = {
  equity: '--accent', bond: '--sage-400', cash: '--slate-400',
  reit: '--plum-400', commodity: '--clay-400', other: '--amber-600',
};

/** Twelve months of history, shaped so it reads as a real account: mostly up,
    with one visible drawdown, because a line that only rises is not credible. */
function backfill(net) {
  const shape = [0.812, 0.831, 0.849, 0.842, 0.868, 0.887, 0.861, 0.879, 0.906, 0.931, 0.958, 0.977, 1];
  return shape.map((k) => net * k);
}

function ringSVG(slices, size = 88) {
  const R = size / 2 - 3, r = R * 0.62, C = size / 2;
  const total = slices.reduce((a, x) => a + x.v, 0) || 1;
  let a0 = -Math.PI / 2;
  const paths = slices.map((sl) => {
    const a1 = a0 + (sl.v / total) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const pt = (rad, ang) => `${(C + rad * Math.cos(ang)).toFixed(2)},${(C + rad * Math.sin(ang)).toFixed(2)}`;
    const d = `M${pt(R, a0)} A${R},${R} 0 ${big} 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 ${big} 0 ${pt(r, a0)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="var(${sl.color})" stroke="var(--surface-panel)" stroke-width="1.5"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeHtml(t('dash.mix'))}">${paths}</svg>`;
}

function curveSVG(values, w = 620, h = 68) {
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * w,
    h - ((v - lo) / span) * (h - 14) - 7,
  ]);
  const line = pts.map((pt, i) => `${i ? 'L' : 'M'}${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d="${line} L${w},${h} L0,${h} Z"/>
    <path class="line" d="${line}"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4"/>
  </svg>`;
}

/**
 * Years until the portfolio covers spending at the withdrawal rate, using the
 * same real-return-and-target arithmetic the FIRE tool uses. Returns null when
 * the path never gets there, so the panel says nothing rather than lying.
 */
function yearsToStop(p, d) {
  const a = p.assumptions;
  // The target excludes loan payments: a mortgage ends, so it is not part of
  // the spending the portfolio has to cover forever. It still reduces what can
  // be saved along the way, which is already inside `surplus`.
  const spendYear = (Number(p.spend) || 0) * 12;
  const saveYear = Math.max(0, d.surplus) * 12;
  if (spendYear <= 0) return null;
  const target = spendYear * (100 / (a.swr || 4));
  const real = ((1 + a.rate / 100) / (1 + a.inflation / 100) - 1) * (1 - a.fee / 100);
  let bal = d.invested + Math.max(0, d.cash - (Number(p.emergency) || 0));
  if (bal >= target) return 0;
  if (saveYear <= 0 && real <= 0) return null;
  for (let y = 1; y <= 60; y++) {
    bal = bal * (1 + real) + saveYear;
    if (bal >= target) return y;
  }
  return null;
}

/** The visitor's own file if they have one, the example if they do not. */
function dashProfile() {
  const own = loadProfile();
  return hasProfile(own) ? { p: own, mine: true } : { p: demoProfile(), mine: false };
}

function renderDash(animate = true) {
  const { p, mine } = dashProfile();
  setCurrency(p.currency);
  const d = derive(p);

  const series = backfill(d.net);
  const delta = series[series.length - 1] - series[series.length - 2];

  if (animate) countTo($('#dashNet'), d.net, money);
  else $('#dashNet').textContent = money(d.net);
  $('#dashDelta').innerHTML =
    `${delta >= 0 ? '+' : ''}${moneyShort(delta)} <span>${escapeHtml(t('dash.month'))}</span>`;
  $('#dashCurve').innerHTML = curveSVG(series);

  // Mix by asset class, because four equity ETFs are one asset class, not four.
  const byClass = new Map();
  p.holdings.forEach((h) => {
    const cls = CLASSES.includes(h.cls) ? h.cls : 'other';
    byClass.set(cls, (byClass.get(cls) || 0) + Math.max(0, Number(h.value) || 0));
  });
  if (d.cash > 0) byClass.set('cash', (byClass.get('cash') || 0) + d.cash);
  const total = [...byClass.values()].reduce((a, b) => a + b, 0) || 1;
  const slices = [...byClass.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cls, v]) => ({ cls, v, color: CLASS_COLOR[cls] || '--amber-600' }));

  $('#dashRing').innerHTML = ringSVG(slices);
  // Net worth includes the home; the ring does not. Printing the investable
  // total stops the two figures from looking like they contradict each other.
  $('#dashLegend').innerHTML = slices.map((sl) =>
    `<div><i style="background:var(${sl.color})"></i>${escapeHtml(t('class.' + sl.cls))}<b>${pct((sl.v / total) * 100, 0)}</b></div>`
  ).join('') +
    `<div style="border-top:1px solid var(--hairline-soft);padding-top:5px;margin-top:2px">
       <i style="background:transparent"></i>${escapeHtml(t('dash.investable'))}<b>${moneyShort(total)}</b></div>`;

  $('#dashSurplus').textContent = (d.surplus >= 0 ? '+' : '') + money(d.surplus);
  $('#dashSurplus').classList.toggle('is-pos', d.surplus >= 0);
  $('#dashDiv').textContent = money(d.netDividend);
  $('#dashRunway').textContent = fmtYears(d.runwayMonths / 12);

  // Three real states of the file, in the order that matters.
  const months = monthNames('long');
  const m = new Date().getMonth();
  const due = p.holdings.filter((h) => payMonths(h).includes(m));
  const dueAmount = due.reduce((a, h) => {
    const annual = Math.max(0, Number(h.value) || 0) * ((Number(h.yield) || 0) / 100);
    return a + (annual / (Number(h.freq) || 1)) * (1 - (p.assumptions.tax || 0) / 100);
  }, 0);
  const worst = d.worstDrift;

  // Three distinct facts, never padded with a repeat: a duplicated row reads as
  // a bug and undoes the credibility the rest of the panel just earned.
  const items = [];
  if (Math.abs(worst.drift) > (p.assumptions.tol || 5) && worst.name) {
    items.push(['warn', t('dash.todo1', {
      name: escapeHtml(worst.name), drift: pct(Math.abs(worst.drift), 1),
    })]);
  } else if (p.holdings.length > 1) {
    // Being on target is a real state worth showing, not an empty row.
    items.push(['good', t('dash.todoOk')]);
  }
  // Only worth a row if it is worth noticing. A payment smaller than a tenth of
  // a month's spending is noise, and noise on the first screen costs trust.
  if (dueAmount > Math.max(1, (Number(p.spend) || 0) * 0.1)) {
    items.push(['good', t('dash.todo2', { amount: money(dueAmount), month: months[m] })]);
  }
  // The payoff line: what the whole file adds up to, courtesy of the FIRE model.
  const stopIn = yearsToStop(p, d);
  if (stopIn != null) items.push(['info', t('dash.todo3', { years: fmtYears(stopIn) })]);
  else if (d.emergencyMonths > 0 && d.emergencyMonths < 3) {
    items.push(['warn', t('dash.todo3b', { months: d.emergencyMonths.toFixed(1) })]);
  }

  $('#dashTodo').innerHTML = items.slice(0, 3)
    .map(([tone, text]) => `<div class="dash__item dash__item--${tone}"><i></i><span>${text}</span></div>`)
    .join('');

  $('#dash').querySelector('.dash__foot').textContent =
    mine ? t('common.usingProfile') : t('dash.tryIt');
  $('#dash').querySelector('.dash__live span').textContent =
    mine ? t('common.usingProfile') : t('dash.live');
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

  renderDash(false);
  renderTools();
  renderStory(0);

  // Scroll position is the model's time axis. That is the argument of the page.
  hubStory({ onProgress: (p) => renderStory(p) });
  bindToolCards();
  revealOnScroll('.claim__item');

  const relabel = () => { renderDash(false); renderTools(); renderStory(1); };
  window.addEventListener('ledger:locale', relabel);
  window.addEventListener('ledger:theme', relabel);
  window.addEventListener('load', () => refreshScroll());
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
