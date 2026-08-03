/* Allocation — portfolio risk in numbers, and the frontier your mix sits under. */

import {
  money, moneyShort, pct, num, setCurrency, createStore, bindRange,
  debounce, copyText, mountShell, clamp, toast,
} from '../assets/js/core.js';
import { scatter, donut, lineChart } from '../assets/js/chart.js';
import { countTo, flash, enterWorkbench, revealOnScroll } from '../assets/js/motion.js';

const PALETTE = ['--accent', '--sage-400', '--slate-400', '--plum-400', '--clay-400', '--amber-600'];

const PRESETS = {
  balanced: [
    { name: 'Global equity', w: 55, r: 7.2, v: 16 },
    { name: 'Government bonds', w: 30, r: 3.1, v: 6 },
    { name: 'Corporate credit', w: 10, r: 4.4, v: 8 },
    { name: 'Cash', w: 5, r: 2.0, v: 0.6 },
  ],
  growth: [
    { name: 'Global equity', w: 70, r: 7.2, v: 16 },
    { name: 'Emerging equity', w: 15, r: 8.4, v: 22 },
    { name: 'Government bonds', w: 10, r: 3.1, v: 6 },
    { name: 'Cash', w: 5, r: 2.0, v: 0.6 },
  ],
  allweather: [
    { name: 'Global equity', w: 30, r: 7.2, v: 16 },
    { name: 'Long bonds', w: 40, r: 3.6, v: 11 },
    { name: 'Intermediate bonds', w: 15, r: 3.1, v: 6 },
    { name: 'Commodities', w: 8, r: 4.0, v: 18 },
    { name: 'Gold', w: 7, r: 3.4, v: 15 },
  ],
};

const DEFAULTS = { assets: PRESETS.balanced.map((a) => ({ ...a })), corr: 0.25, rf: 2 };

/* ---------------------------------------------------------------- model */

/** Portfolio variance with a single shared off-diagonal correlation. */
function stats(assets, corr) {
  const wSum = assets.reduce((a, x) => a + Math.max(0, x.w), 0) || 1;
  const w = assets.map((x) => Math.max(0, x.w) / wSum);
  const ret = assets.reduce((a, x, i) => a + w[i] * x.r, 0);

  let varSum = 0;
  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < assets.length; j++) {
      const rho = i === j ? 1 : corr;
      varSum += w[i] * w[j] * assets[i].v * assets[j].v * rho;
    }
  }
  const vol = Math.sqrt(Math.max(0, varSum));

  // Marginal risk contribution: how much of the portfolio's volatility each
  // holding is responsible for, which is rarely its weight.
  const contrib = assets.map((_, i) => {
    let cov = 0;
    for (let j = 0; j < assets.length; j++) {
      const rho = i === j ? 1 : corr;
      cov += w[j] * assets[i].v * assets[j].v * rho;
    }
    return vol > 0 ? (w[i] * cov) / vol : 0;
  });
  const contribSum = contrib.reduce((a, b) => a + b, 0) || 1;

  return {
    w, ret, vol, wSum,
    contrib: contrib.map((c) => (c / contribSum) * 100),
    // 5th percentile one-year outcome under a normal assumption.
    bad: ret - 1.645 * vol,
  };
}

/** Random long-only mixes, then the upper envelope of that cloud. */
function frontier(assets, corr, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const cloud = [];
  const N = 900;
  for (let k = 0; k < N; k++) {
    // Dirichlet-ish: exponential draws normalised, gives an even spread of mixes.
    const raw = assets.map(() => -Math.log(1 - rnd() * 0.999999));
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    const mix = assets.map((a, i) => ({ ...a, w: (raw[i] / sum) * 100 }));
    const st = stats(mix, corr);
    cloud.push({ x: st.vol, y: st.ret });
  }
  // Envelope: best return in each volatility bucket.
  const lo = Math.min(...cloud.map((c) => c.x));
  const hi = Math.max(...cloud.map((c) => c.x));
  const B = 26, step = (hi - lo) / B || 1;
  const best = new Map();
  cloud.forEach((c) => {
    const b = Math.floor((c.x - lo) / step);
    if (!best.has(b) || best.get(b).y < c.y) best.set(b, c);
  });
  const env = [...best.values()].sort((a, b) => a.x - b.x);
  // Keep only the rising part: anything below a leftward point is dominated.
  const out = [];
  let peak = -Infinity;
  for (const p of env) { if (p.y > peak) { out.push(p); peak = p.y; } }
  return { cloud, env: out };
}

/* ------------------------------------------------------------------- ui */

const $ = (s) => document.querySelector(s);
const els = {};
let store, last = null, lastEfficient = null;

function escapeHtml(x) {
  return String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render(s) {
  const st = stats(s.assets, s.corr);
  const fr = frontier(s.assets, s.corr);
  last = { s, st, fr };

  const sharpe = st.vol > 0 ? (st.ret - s.rf) / st.vol : 0;

  countTo(els.vRet, st.ret, (v) => pct(v, 2));
  els.fRet.textContent = `${pct(st.ret - s.rf, 2)} above the risk-free rate`;

  countTo(els.vVol, st.vol, (v) => pct(v, 1));
  const naive = s.assets.reduce((a, x, i) => a + st.w[i] * x.v, 0);
  els.fVol.textContent = naive > st.vol
    ? `diversification removed ${pct(naive - st.vol, 1)} of it`
    : 'nothing left to diversify at this correlation';

  countTo(els.vSharpe, sharpe, (v) => num(v, 2));
  els.fSharpe.textContent =
    sharpe >= 0.6 ? 'well paid for the risk taken' :
    sharpe >= 0.35 ? 'ordinary for a mixed portfolio' :
    sharpe >= 0.15 ? 'thin compensation' : 'you are taking risk for very little';

  countTo(els.vDd, st.bad, (v) => pct(v, 1));
  els.fDd.textContent = `one year in twenty is worse than this`;

  // --- frontier
  const bestAtVol = fr.env.reduce((best, p) =>
    Math.abs(p.x - st.vol) < Math.abs(best.x - st.vol) ? p : best, fr.env[0] || { x: st.vol, y: st.ret });
  const shortfall = Math.max(0, bestAtVol.y - st.ret);
  const efficient = shortfall < 0.15;
  if (lastEfficient !== null && efficient !== lastEfficient) flash(els.mSharpe);
  lastEfficient = efficient;

  scatter($('#frontier'), {
    points: [
      ...fr.cloud.filter((_, i) => i % 6 === 0).map((c) => ({ x: c.x, y: c.y, color: '--ink-500' })),
      ...s.assets.map((a, i) => ({
        x: a.v, y: a.r, color: PALETTE[i % PALETTE.length], label: a.name,
        title: `${a.name}: ${pct(a.r, 1)} return, ${pct(a.v, 1)} volatility`,
      })),
      { x: st.vol, y: st.ret, color: '--accent', big: true, label: 'your mix',
        title: `Your mix: ${pct(st.ret, 2)} return, ${pct(st.vol, 1)} volatility` },
    ],
    frontier: fr.env,
    x: { format: (v) => pct(v, 0), label: 'Volatility' },
    y: { format: (v) => pct(v, 0), label: 'Expected return' },
    height: 400,
    label: 'Expected return against volatility for your mix and alternatives',
  });

  $('#frontClaim').textContent = efficient
    ? `At ${pct(st.vol, 1)} volatility, no other mix of these same classes does meaningfully better. Any further gain has to come from taking more risk, not from rearranging.`
    : `Another mix of these same classes reaches ${pct(bestAtVol.y, 2)} at the same ${pct(st.vol, 1)} volatility. You are giving up ${pct(shortfall, 2)} a year for the arrangement you have chosen.`;

  // --- mix
  donut($('#donut'), s.assets.map((a, i) => ({
    label: a.name, value: Math.max(0.0001, a.w), color: PALETTE[i % PALETTE.length],
  })), { centerTop: pct(st.ret, 1), centerBottom: 'expected', label: 'Asset mix' });

  $('#mixList').innerHTML = s.assets.map((a, i) => `
    <div class="alloc-row">
      <span class="alloc-row__name"><span class="alloc-row__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>${escapeHtml(a.name)}</span>
      <span class="num" style="font-size:var(--t-sm)">${pct(st.w[i] * 100, 1)}</span>
      <span class="alloc-row__bar"><span class="bar-track"><span class="bar-fill" style="width:${st.w[i] * 100}%;background:var(${PALETTE[i % PALETTE.length]})"></span></span></span>
    </div>`).join('');

  // --- risk contribution against weight
  $('#riskList').innerHTML = s.assets.map((a, i) => {
    const wPct = st.w[i] * 100, cPct = st.contrib[i];
    const over = cPct - wPct;
    return `<div style="margin-bottom:var(--s5)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--s3);margin-bottom:7px">
        <span class="alloc-row__name"><span class="alloc-row__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>${escapeHtml(a.name)}</span>
        <span class="delta ${over > 1 ? 'delta--neg' : over < -1 ? 'delta--pos' : ''}">${over > 0 ? '+' : ''}${pct(over, 1)}</span>
      </div>
      <div style="display:grid;gap:5px">
        <div style="display:flex;align-items:center;gap:var(--s3)">
          <span style="font-size:var(--t-xs);color:var(--ink-muted);width:5.5rem">weight</span>
          <span class="bar-track" style="flex:1"><span class="bar-fill" style="width:${wPct}%;background:var(--ink-500)"></span></span>
          <span class="num" style="font-size:var(--t-xs);width:3.5rem;text-align:right">${pct(wPct, 0)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:var(--s3)">
          <span style="font-size:var(--t-xs);color:var(--ink-muted);width:5.5rem">of the risk</span>
          <span class="bar-track" style="flex:1"><span class="bar-fill" style="width:${clamp(cPct, 0, 100)}%;background:var(${PALETTE[i % PALETTE.length]})"></span></span>
          <span class="num" style="font-size:var(--t-xs);width:3.5rem;text-align:right">${pct(cPct, 0)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // --- decade range
  const Y = 10;
  const yrs = Array.from({ length: Y + 1 }, (_, i) => i);
  const grow = (r) => yrs.map((y) => 100 * Math.pow(1 + r / 100, y));
  const mid = grow(st.ret);
  // Multi-year band widens with the square root of time.
  const lo = yrs.map((y) => 100 * Math.pow(1 + (st.ret - 1.282 * st.vol / Math.sqrt(Math.max(1, y))) / 100, y));
  const hi = yrs.map((y) => 100 * Math.pow(1 + (st.ret + 1.282 * st.vol / Math.sqrt(Math.max(1, y))) / 100, y));
  lo[0] = 100; hi[0] = 100;

  lineChart($('#range'), {
    series: [{ key: 'mid', label: 'Expected path', values: mid, color: '--accent' }],
    band: { lo, hi, color: '--accent', opacity: 0.12 },
    x: { values: yrs, format: (v) => (v === 0 ? 'now' : 'yr ' + v), readoutLabel: 'Year' },
    y: { format: (v) => num(v, 0) },
    height: 300,
    readout: $('#readout'),
    readout_empty: 'Hover to read the expected value of 100 invested today',
    table: { caption: 'Growth of 100 by year', xLabel: 'Year' },
  });
  $('#legend2').innerHTML =
    '<span class="legend__item"><span class="legend__swatch" style="background:var(--accent)"></span>Expected</span>' +
    '<span class="legend__item"><span class="legend__swatch" style="background:var(--accent);opacity:.35;height:8px;border-radius:2px"></span>Middle 80% of outcomes</span>';

  $('#wSum').textContent = pct(st.wSum, 0);
  $('#wSum').style.color = Math.abs(st.wSum - 100) > 0.5 ? 'var(--clay-400)' : '';
  syncRail(s);
}

function renderAssets(s) {
  $('#assets').innerHTML = s.assets.map((a, i) => `
    <div class="holding" data-row="${i}">
      <span class="holding__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>
      <input class="holding__name" value="${escapeHtml(a.name)}" data-k="name" aria-label="Class ${i + 1} name">
      <input class="holding__num" type="number" value="${a.w}" data-k="w" step="1" min="0" max="100" aria-label="Class ${i + 1} weight percent">
      <input class="holding__num" type="number" value="${a.r}" data-k="r" step="0.1" min="-10" max="30" aria-label="Class ${i + 1} expected return percent">
      <button class="holding__del" type="button" data-del="${i}" aria-label="Remove ${escapeHtml(a.name)}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
      </button>
    </div>`).join('');

  $('#vols').innerHTML = s.assets.map((a, i) => `
    <div class="field" style="margin-bottom:var(--s3)">
      <label class="field__label" for="vol${i}" style="font-size:var(--t-xs);color:var(--ink-muted)">
        <span style="display:inline-flex;align-items:center;gap:6px">
          <span class="holding__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>${escapeHtml(a.name)} volatility
        </span>
      </label>
      <div class="range-row">
        <input class="range" id="vol${i}" data-vol="${i}" type="range" min="0" max="35" step="0.5" value="${a.v}">
        <output class="range-val" id="vol${i}Out">${pct(a.v, 1)}</output>
      </div>
    </div>`).join('');

  $('#vols').querySelectorAll('[data-vol]').forEach((input) => {
    bindRange(input, (v) => {
      const i = Number(input.dataset.vol);
      $('#vol' + i + 'Out').textContent = pct(v, 1);
      const assets = store.read('assets').map((x) => ({ ...x }));
      assets[i].v = v;
      // Not re-rendering the list here: the slider being dragged is in it.
      store.set({ assets });
    });
  });
}

function syncRail(s) {
  const set = (id, v) => { const n = $('#' + id); if (n && document.activeElement !== n) n.value = v; };
  set('corr', s.corr); set('rf', s.rf);
  $('#corrOut').textContent = num(s.corr, 2);
  $('#rfOut').textContent = pct(s.rf, 1);
  $('#corrNote').textContent =
    s.corr <= 0 ? 'true hedge' : s.corr <= 0.2 ? 'strong diversification' :
    s.corr <= 0.45 ? 'some diversification' : s.corr <= 0.75 ? 'they move together' : 'one asset in disguise';
  repaint();
}

let repaint = () => {};

function boot() {
  mountShell({ base: '../', tool: 'allocation' });
  ['vRet', 'vVol', 'vSharpe', 'vDd', 'fRet', 'fVol', 'fSharpe', 'fDd', 'mSharpe']
    .forEach((id) => { els[id] = $('#' + id); });

  store = createStore('allocation', DEFAULTS, debounce(render, 0));
  renderAssets(store.get());

  $('#assets').addEventListener('input', (e) => {
    const row = e.target.closest('[data-row]');
    if (!row) return;
    const i = Number(row.dataset.row), k = e.target.dataset.k;
    const assets = store.read('assets').map((x) => ({ ...x }));
    assets[i][k] = k === 'name' ? e.target.value : Number(e.target.value) || 0;
    store.set({ assets });
  });
  $('#assets').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const assets = store.read('assets').filter((_, x) => x !== Number(del.dataset.del));
    if (assets.length < 2) { toast('Keep at least two classes to have a mix'); return; }
    store.set({ assets });
    renderAssets(store.get());
  });

  $('#btnAdd').addEventListener('click', () => {
    const assets = [...store.read('assets'), { name: 'New class', w: 0, r: 5, v: 10 }];
    store.set({ assets });
    renderAssets(store.get());
    const rows = $('#assets').querySelectorAll('.holding__name');
    rows[rows.length - 1]?.focus();
    rows[rows.length - 1]?.select();
  });

  $('#btnNormalise').addEventListener('click', () => {
    const as = store.read('assets');
    const sum = as.reduce((a, x) => a + Math.max(0, x.w), 0);
    if (!sum) { toast('Give at least one class a weight'); return; }
    store.set({ assets: as.map((x) => ({ ...x, w: Number(((Math.max(0, x.w) / sum) * 100).toFixed(1)) })) });
    renderAssets(store.get());
    toast('Weights now add to 100%');
  });

  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    $('#presets').querySelectorAll('.preset').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    store.set({ assets: PRESETS[b.dataset.preset].map((a) => ({ ...a })) });
    renderAssets(store.get());
  });

  const painters = [];
  [['corr', (v) => num(v, 2)], ['rf', (v) => pct(v, 1)]].forEach(([id, fmt]) => {
    painters.push(bindRange($('#' + id), (v) => { $('#' + id + 'Out').textContent = fmt(v); store.set({ [id]: v }); }));
  });
  repaint = () => painters.forEach((p) => p());

  $('#btnShare').addEventListener('click', () => copyText(store.shareUrl(), 'Link copied. It carries your mix.'));
  $('#btnReset').addEventListener('click', () => { store.reset(); renderAssets(store.get()); });

  render(store.get());
  enterWorkbench();
  revealOnScroll();
  window.addEventListener('ledger:theme', () => render(store.get()));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
