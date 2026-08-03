/* Rebalance - drift, cash-only repair, and the real cost of selling. */

import {
  money, moneyShort, pct, num, setCurrency, curSymbol, CURRENCIES,
  createStore, bindNumber, bindRange, debounce, copyText, mountShell, clamp, toast,
} from '../assets/js/core.js';
import { t } from '../assets/js/i18n.js';
import { mountProfileBridge } from '../assets/js/bridge.js';
import { donut } from '../assets/js/chart.js';
import { countTo, flash, enterWorkbench, revealOnScroll } from '../assets/js/motion.js';

const PALETTE = ['--accent', '--sage-400', '--slate-400', '--plum-400', '--clay-400', '--amber-600'];

const PRESETS = {
  classic: [
    { name: 'World equity', value: 1_450_000, target: 60 },
    { name: 'Government bonds', value: 550_000, target: 40 },
  ],
  threefund: [
    { name: 'Domestic equity', value: 980_000, target: 40 },
    { name: 'International equity', value: 640_000, target: 30 },
    { name: 'Aggregate bonds', value: 380_000, target: 30 },
  ],
  permanent: [
    { name: 'Equity', value: 620_000, target: 25 },
    { name: 'Long bonds', value: 410_000, target: 25 },
    { name: 'Gold', value: 590_000, target: 25 },
    { name: 'Cash', value: 380_000, target: 25 },
  ],
};

const DEFAULTS = {
  holdings: PRESETS.classic.map((h) => ({ ...h })),
  newCash: 0, mode: 'buy', tol: 5,
  cost: 0.1425, tax: 0, gain: 30,
  cur: 'TWD',
};

/* ---------------------------------------------------------------- model */

function analyse(s) {
  const hs = s.holdings.filter((h) => isFinite(h.value) && isFinite(h.target));
  const held = hs.reduce((a, h) => a + Math.max(0, h.value), 0);
  const tgtSum = hs.reduce((a, h) => a + Math.max(0, h.target), 0) || 100;
  const total = held + Math.max(0, s.newCash);

  // Normalise targets so a list that adds to 97% still produces sane orders.
  const rows = hs.map((h, i) => {
    const target = (Math.max(0, h.target) / tgtSum) * 100;
    const nowPct = held > 0 ? (h.value / held) * 100 : 0;
    const finalPct = total > 0 ? (h.value / total) * 100 : 0;
    return {
      i, name: h.name, value: Math.max(0, h.value), target,
      nowPct, finalPct,
      drift: nowPct - target,
      idealValue: (total * target) / 100,
      color: PALETTE[i % PALETTE.length],
    };
  });

  // The number nobody else prints: new money that fixes drift with zero selling.
  // Every holding must fit under its target share of the enlarged portfolio.
  const requiredTotal = rows.reduce(
    (mx, r) => (r.target > 0 ? Math.max(mx, r.value / (r.target / 100)) : mx), 0);
  const cashToFix = Math.max(0, requiredTotal - held);

  // Orders
  const sellAllowed = s.mode === 'both';
  let orders;
  if (sellAllowed) {
    orders = rows.map((r) => ({ ...r, delta: r.idealValue - r.value }));
  } else {
    // Buy-only: distribute available cash to the holdings furthest below target,
    // proportional to their shortfall, so the largest gap closes first.
    const budget = Math.max(0, s.newCash);
    const gaps = rows.map((r) => Math.max(0, r.idealValue - r.value));
    const gapSum = gaps.reduce((a, g) => a + g, 0);
    orders = rows.map((r, i) => ({
      ...r,
      delta: gapSum > 0 ? (gaps[i] / gapSum) * budget : budget / rows.length,
    }));
  }

  const acted = orders.filter((o) => Math.abs(o.drift) > s.tol && Math.abs(o.delta) > 1);
  const traded = orders.reduce((a, o) => a + Math.abs(o.delta), 0);
  const sold = orders.reduce((a, o) => a + Math.max(0, -o.delta), 0);
  const feeCost = traded * (s.cost / 100);
  const gainShare = s.gain / 100 > 0 ? (s.gain / 100) / (1 + s.gain / 100) : 0;
  const taxCost = sold * gainShare * (s.tax / 100);

  // Result after acting
  const after = orders.map((o) => {
    const v = o.value + o.delta;
    return { ...o, afterValue: v, afterPct: total > 0 ? (v / total) * 100 : 0 };
  });
  const worstBefore = rows.reduce((mx, r) => Math.max(mx, Math.abs(r.finalPct - r.target)), 0);
  const worstAfter = after.reduce((mx, r) => Math.max(mx, Math.abs(r.afterPct - r.target)), 0);

  return {
    rows, orders: after, total, held, tgtSum,
    cashToFix, requiredTotal,
    traded, sold, feeCost, taxCost, totalCost: feeCost + taxCost,
    worstBefore, worstAfter, actedCount: acted.length,
    outOfBand: rows.filter((r) => Math.abs(r.finalPct - r.target) > s.tol).length,
  };
}

/** Same portfolio, forced through buy-and-sell, for the comparison panel. */
function costOf(s, mode) {
  return analyse({ ...s, mode });
}

/* ------------------------------------------------------------------- ui */

const $ = (s) => document.querySelector(s);
const els = {};
let store, last = null, lastBand = null;

function render(s) {
  setCurrency(s.cur);
  const a = analyse(s);
  last = { s, a };

  countTo(els.vTotal, a.total, money);
  els.fTotal.textContent = s.newCash > 0
    ? t('rebalance.fTotalCash', { held: money(a.held), cash: money(s.newCash) })
    : t('rebalance.fTotalPlain', { n: s.holdings.length });

  countTo(els.vDrift, a.worstBefore, (v) => pct(v, 1));
  els.vDrift.className = 'metric__value num ' +
    (a.worstBefore > s.tol ? 'metric__value--neg' : 'metric__value--pos');
  els.fDrift.textContent = a.outOfBand
    ? t('rebalance.fDriftOut', { n: a.outOfBand, total: a.rows.length, tol: pct(s.tol, 1) })
    : t('rebalance.fDriftIn', { tol: pct(s.tol, 1) });

  const band = a.outOfBand > 0 ? 'out' : 'in';
  if (lastBand && band !== lastBand) flash(els.mDrift);
  lastBand = band;

  countTo(els.vCash, a.cashToFix, money);
  els.fCash.textContent = a.cashToFix > 0
    ? t('rebalance.fCash', { pct: pct((a.cashToFix / Math.max(1, a.held)) * 100, 1) })
    : t('rebalance.fCashNone');

  countTo(els.vCost, a.totalCost, money);
  els.fCost.textContent = a.totalCost > 0
    ? t('rebalance.fCost', { fee: money(a.feeCost), tax: money(a.taxCost) })
    : t('rebalance.fCostNone');

  // --- donut + allocation list
  donut($('#donutNow'), a.rows.map((r) => ({ label: r.name, value: Math.max(0.0001, r.value), color: r.color })), {
    centerTop: moneyShort(a.held),
    centerBottom: t('rebalance.invested'),
    label: t('rebalance.mixTitle'),
  });

  $('#allocList').innerHTML = a.rows.map((r) => `
    <div class="alloc-row">
      <span class="alloc-row__name"><span class="alloc-row__dot" style="background:var(${r.color})"></span>${escapeHtml(r.name)}</span>
      <span class="num" style="font-size:var(--t-sm)">${pct(r.finalPct, 1)} <span style="color:var(--ink-muted)">/ ${pct(r.target, 0)}</span></span>
      <span class="alloc-row__bar">
        <span class="bar-track"><span class="bar-fill" style="width:${clamp(r.finalPct, 0, 100)}%;background:var(${r.color})"></span></span>
      </span>
    </div>`).join('');

  // --- drift meters
  const scale = Math.max(s.tol * 2, Math.ceil(a.worstBefore) + 2, 6);
  $('#driftList').innerHTML = a.rows.map((r) => {
    const d = r.finalPct - r.target;
    const out = Math.abs(d) > s.tol;
    const posPct = clamp(50 + (d / scale) * 50, 1, 99);
    const bandW = clamp((s.tol / scale) * 50, 0, 49);
    return `<div style="margin-bottom:var(--s5)">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--s3);margin-bottom:6px">
        <span class="alloc-row__name"><span class="alloc-row__dot" style="background:var(${r.color})"></span>${escapeHtml(r.name)}</span>
        <span class="num ${out ? 'c-neg' : 'c-mute'}" style="font-size:var(--t-sm)">${d > 0 ? '+' : ''}${pct(d, 1)}</span>
      </div>
      <div class="drift">
        <div class="drift__band" style="left:${50 - bandW}%;right:${50 - bandW}%"></div>
        <div class="drift__center"></div>
        <div class="drift__mark${out ? ' drift__mark--out' : ''}" style="left:${posPct}%"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:var(--t-xs);color:var(--ink-muted);margin-top:4px">
        <span>${pct(-scale, 0)}</span><span>${t('rebalance.driftTarget', { pct: pct(r.target, 0) })}</span><span>+${pct(scale, 0)}</span>
      </div>
    </div>`;
  }).join('');
  $('#driftLegend').textContent = t('rebalance.driftBand', { tol: pct(s.tol, 1) });

  // --- orders
  const acts = a.orders
    .map((o) => {
      const act = Math.abs(o.delta) < 1 || Math.abs(o.drift) <= s.tol ? 'hold' : o.delta > 0 ? 'buy' : 'sell';
      return { ...o, act };
    })
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  // Two very different reasons for an empty order list. Saying "nothing to do"
  // while a 12% drift sits on screen would be a lie.
  const nothingToDo = acts.every((o) => o.act === 'hold');
  const starvedOfCash = nothingToDo && a.outOfBand > 0 && s.mode === 'buy' && s.newCash <= 0;
  $('#orders').innerHTML = nothingToDo
    ? (starvedOfCash
      ? `<div class="empty"><p class="empty__title">${t('rebalance.emptyStarved')}</p>
         <p>${t('rebalance.emptyStarvedSub', { n: a.outOfBand, cash: money(a.cashToFix) })}</p></div>`
      : `<div class="empty"><p class="empty__title">${t('rebalance.emptyOk')}</p>
         <p>${t('rebalance.emptyOkSub', { tol: pct(s.tol, 1) })}</p></div>`)
    : acts.map((o) => `<div class="trade">
        <span class="trade__side trade__side--${o.act}">${t('rebalance.' + o.act)}</span>
        <span>
          <span class="trade__name">${escapeHtml(o.name)}</span><br>
          <span class="trade__sub">${t('rebalance.orderSub', { now: pct(o.finalPct, 1), after: pct(o.afterPct, 1), target: pct(o.target, 0) })}</span>
        </span>
        <span class="trade__amt ${o.act === 'sell' ? 'c-neg' : o.act === 'buy' ? 'c-pos' : 'c-mute'}">${o.act === 'hold' ? '-' : money(Math.abs(o.delta))}</span>
      </div>`).join('');

  // --- buy-only against buy-and-sell
  const buy = costOf(s, 'buy');
  const both = costOf(s, 'both');
  const saving = both.totalCost - buy.totalCost;
  els.cmpClaim.innerHTML = s.newCash <= 0
    ? t('rebalance.cmpNoCash')
    : saving > 0 ? t('rebalance.cmpSave', { saving: money(saving) }) : t('rebalance.cmpNoDiff');
  els.cmpSub.textContent = s.newCash <= 0
    ? t('rebalance.cmpSubNoCash', { cash: money(a.cashToFix) })
    : t('rebalance.cmpSub', { a: pct(buy.worstAfter, 1), b: pct(both.worstAfter, 1), cost: money(both.totalCost) });

  const bars = [
    { label: t('rebalance.barBuyOnly'), v: buy.totalCost, color: '--sage-400' },
    { label: t('rebalance.barBuySell'), v: both.totalCost, color: '--clay-400' },
  ];
  const mx = Math.max(...bars.map((b) => b.v), 1);
  els.cmpBars.innerHTML = bars.map((b) => `<div class="fee-bar">
      <div class="fee-bar__top"><span>${b.label}</span><span class="num">${money(b.v)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(b.v / mx) * 100}%;background:var(${b.color})"></div></div>
    </div>`).join('');

  $('#targetSum').textContent = pct(a.tgtSum, 0);
  $('#targetSum').style.color = Math.abs(a.tgtSum - 100) > 0.5 ? 'var(--clay-400)' : '';
  syncRail(s);
}

function escapeHtml(x) {
  return String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderHoldings(s) {
  $('#holdings').innerHTML = s.holdings.map((h, i) => `
    <div class="holding" data-row="${i}">
      <span class="holding__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>
      <input class="holding__name" value="${escapeHtml(h.name)}" data-k="name" aria-label="Holding ${i + 1} name">
      <input class="holding__num" type="number" value="${h.value}" data-k="value" step="10000" min="0" aria-label="Holding ${i + 1} value">
      <input class="holding__num" type="number" value="${h.target}" data-k="target" step="1" min="0" max="100" aria-label="Holding ${i + 1} target percent">
      <button class="holding__del" type="button" data-del="${i}" aria-label="Remove ${escapeHtml(h.name)}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
      </button>
    </div>`).join('');
}

function syncRail(s) {
  const set = (id, v) => { const n = $('#' + id); if (n && document.activeElement !== n) n.value = v; };
  set('newCash', s.newCash); set('tol', s.tol); set('cost', s.cost); set('tax', s.tax); set('gain', s.gain);
  $('#tolOut').textContent = num(s.tol, 1);
  $('#costOut').textContent = pct(s.cost, 3);
  $('#taxOut').textContent = pct(s.tax, 0);
  $('#gainOut').textContent = pct(s.gain, 0);
  $('#modeSeg').querySelectorAll('[data-mode]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.mode === s.mode)));
  document.querySelectorAll('[data-cur-symbol]').forEach((n) => { n.textContent = curSymbol(); });
  repaint();
}

let repaint = () => {};

function boot() {
  mountShell({ base: '../', tool: 'rebalance' });
  ['vTotal', 'vDrift', 'vCash', 'vCost', 'fTotal', 'fDrift', 'fCash', 'fCost',
   'mDrift', 'cmpClaim', 'cmpSub', 'cmpBars'].forEach((id) => { els[id] = $('#' + id); });

  // The holdings list re-renders only from explicit calls, never from a value
  // change: rebuilding it mid-keystroke would drop focus out of the input.
  store = createStore('rebalance', DEFAULTS, debounce(render, 0));

  renderHoldings(store.get());

  // Holdings list: edit in place, no save button.
  $('#holdings').addEventListener('input', (e) => {
    const row = e.target.closest('[data-row]');
    if (!row) return;
    const i = Number(row.dataset.row), k = e.target.dataset.k;
    const holdings = store.read('holdings').map((h) => ({ ...h }));
    holdings[i][k] = k === 'name' ? e.target.value : Number(e.target.value) || 0;
    store.set({ holdings });   // no re-render of the list: the input is focused
  });
  $('#holdings').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    const i = Number(del.dataset.del);
    const holdings = store.read('holdings').filter((_, x) => x !== i);
    if (!holdings.length) { toast(t('profile.keepOne')); return; }
    store.set({ holdings });
    renderHoldings(store.get());
  });

  $('#btnAdd').addEventListener('click', () => {
    const holdings = [...store.read('holdings'), { name: '', value: 0, target: 0 }];
    store.set({ holdings });
    renderHoldings(store.get());
    const rows = $('#holdings').querySelectorAll('.holding__name');
    rows[rows.length - 1]?.focus();
    rows[rows.length - 1]?.select();
  });

  $('#btnNormalise').addEventListener('click', () => {
    const hs = store.read('holdings');
    const sum = hs.reduce((a, h) => a + Math.max(0, h.target), 0);
    if (!sum) { toast(t('profile.keepOne')); return; }
    const holdings = hs.map((h) => ({ ...h, target: Number(((Math.max(0, h.target) / sum) * 100).toFixed(1)) }));
    store.set({ holdings });
    renderHoldings(store.get());
    toast(t('profile.normalised'));
  });

  $('#presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    $('#presets').querySelectorAll('.preset').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    store.set({ holdings: PRESETS[b.dataset.preset].map((h) => ({ ...h })) });
    renderHoldings(store.get());
  });

  bindNumber($('[data-num="newCash"]'), { step: 10000, min: 0, max: 1e12, onInput: (v) => store.set({ newCash: v }) });

  const painters = [];
  [['tol', (v) => num(v, 1)], ['cost', (v) => pct(v, 3)], ['tax', (v) => pct(v, 0)], ['gain', (v) => pct(v, 0)]]
    .forEach(([id, fmt]) => {
      painters.push(bindRange($('#' + id), (v) => { $('#' + id + 'Out').textContent = fmt(v); store.set({ [id]: v }); }));
    });
  repaint = () => painters.forEach((p) => p());

  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) store.set({ mode: b.dataset.mode });
  });

  $('#curSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]');
    if (!b) return;
    $('#curSeg').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#newCash').step = CURRENCIES[b.dataset.cur].step * 10;
    store.set({ cur: b.dataset.cur });
  });

  $('#btnCopyOrders').addEventListener('click', () => {
    const { s, a } = last;
    const lines = a.orders
      .map((o) => {
        const key = Math.abs(o.delta) < 1 || Math.abs(o.drift) <= s.tol ? 'hold' : o.delta > 0 ? 'buy' : 'sell';
        return `${t('rebalance.' + key).toUpperCase().padEnd(5)} ${o.name.padEnd(22)} ${key === 'hold' ? '' : money(Math.abs(o.delta))}`;
      })
      .join('\n');
    copyText(
      `Ledgerline\n${t('rebalance.mTotal')} ${money(a.total)}\n${t('rebalance.mDrift')} ${pct(a.worstBefore, 1)}\n\n${lines}\n\n${t('rebalance.mCost')} ${money(a.totalCost)}`,
      t('rebalance.ordersCopied')
    );
  });

  $('#btnShare').addEventListener('click', () => copyText(store.shareUrl(), t('common.copied')));
  $('#btnReset').addEventListener('click', () => { store.reset(); renderHoldings(store.get()); });

  mountProfileBridge('rebalance', store, { afterAdopt: () => { renderHoldings(store.get()); render(store.get()); } });

  render(store.get());
  enterWorkbench();
  revealOnScroll();
  window.addEventListener('ledger:theme', () => render(store.get()));
  window.addEventListener('ledger:locale', () => render(store.get()));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
