/* My finances - the file every tool reads, and the only page that accumulates. */

import {
  money, moneyShort, pct, num, years as fmtYears, setCurrency, curSymbol, CURRENCIES,
  bindNumber, debounce, bindRange, toast, mountShell, clamp, escapeHtml, t,
} from '../assets/js/core.js';
import { lineChart } from '../assets/js/chart.js';
import { countTo, enterWorkbench, revealOnScroll } from '../assets/js/motion.js';
import { monthNames, formatDate, formatAgo, detectCurrency } from '../assets/js/i18n.js';
import {
  loadProfile, saveProfile, clearProfile, demoProfile, hasProfile,
  derive, actions, addSnapshot, addJournal, exportProfile, importProfile,
  uid, CLASSES, CLASS_DEFAULTS, monthlyPayment,
} from '../assets/js/profile.js';

const PALETTE = ['--accent', '--sage-400', '--slate-400', '--plum-400', '--clay-400', '--amber-600'];
const $ = (s) => document.querySelector(s);

let P = null;
const save = debounce(() => { saveProfile(P); renderDerived(); }, 260);

/* ------------------------------------------------------------- assumptions */

const ASSUMPTIONS = [
  { k: 'rate',      labelKey: 'profile.aReturn',    min: 0,    max: 15, step: 0.1,  fmt: (v) => pct(v, 1) },
  { k: 'inflation', labelKey: 'profile.aInflation', min: 0,    max: 8,  step: 0.1,  fmt: (v) => pct(v, 1) },
  { k: 'fee',       labelKey: 'profile.aFee',       min: 0,    max: 3,  step: 0.01, fmt: (v) => pct(v, 2) },
  { k: 'swr',       labelKey: 'profile.aSwr',       min: 2,    max: 7,  step: 0.1,  fmt: (v) => pct(v, 1) },
  { k: 'tol',       labelKey: 'profile.aTol',       min: 0,    max: 15, step: 0.5,  fmt: (v) => pct(v, 1) },
  { k: 'tax',       labelKey: 'profile.aTax',       min: 0,    max: 45, step: 1,    fmt: (v) => pct(v, 0) },
];

/* ------------------------------------------------------------------ render */

function renderAll() {
  const filled = hasProfile(P);
  $('#emptyState').hidden = filled;
  $('#live').hidden = !filled;
  setCurrency(P.currency);
  paintCurrencySeg();
  if (!filled) return;
  renderHoldings();
  renderLoans();
  renderAssumptions();
  renderCashFields();
  renderDerived();
}

/** Everything computed from the file: metrics, actions, timeline, journal. */
function renderDerived() {
  const d = derive(P);

  countTo($('#vNet'), d.net, money);
  $('#fNet').textContent = t('profile.mNetFoot', { assets: money(d.assets), debt: money(d.debt) });

  if (d.changeVsLast === null) {
    $('#vChange').textContent = '-';
    $('#fChange').textContent = t('profile.mChangeNone');
    $('#vChange').className = 'metric__value num';
  } else {
    countTo($('#vChange'), d.changeVsLast, (v) => (v >= 0 ? '+' : '') + money(v));
    $('#vChange').className = 'metric__value num ' +
      (d.changeVsLast > 0 ? 'metric__value--pos' : d.changeVsLast < 0 ? 'metric__value--neg' : '');
    $('#fChange').textContent = t('profile.mChangeFoot', { when: formatAgo(d.last.date) });
  }

  countTo($('#vSaving'), d.surplus, money);
  $('#vSaving').className = 'metric__value num ' + (d.surplus < 0 ? 'metric__value--neg' : 'metric__value--pos');
  $('#fSaving').textContent = t('profile.mSavingFoot', {
    income: money(P.income), spend: money(P.spend), loan: money(d.loanPayment),
  });

  countTo($('#vRunway'), d.runwayMonths, (v) => fmtYears(v / 12));
  $('#fRunway').textContent = t('profile.mRunwayFoot');

  renderActions(d);
  renderTimeline(d);
  renderJournal();

  $('#targetSum').textContent = pct(d.targetSum, 0);
  $('#targetSum').style.color = Math.abs(d.targetSum - 100) > 0.5 ? 'var(--clay-400)' : '';
}

/** The list that answers "why come back". Everything here is a real state. */
function renderActions(d) {
  const list = actions(P, d);
  const months = monthNames('long');
  if (!list.length) {
    $('#actions').innerHTML =
      `<div class="empty"><p class="empty__title">${escapeHtml(t('profile.actionsNone'))}</p>` +
      `<p>${escapeHtml(t('profile.actionsNoneSub'))}</p></div>`;
    return;
  }
  $('#actions').innerHTML = list.map((a) => {
    const vars = { ...a.vars };
    if (vars.monthIndex !== undefined) vars.month = months[vars.monthIndex];
    (a.money || []).forEach((k) => { if (vars[k] !== undefined) vars[k] = money(vars[k]); });
    const whyVars = { ...a.whyVars };
    if (whyVars.cash !== undefined) whyVars.cash = money(whyVars.cash);
    return `<div class="action action--${a.tone}">
      <span class="action__tick"></span>
      <div>
        <div class="action__what">${t(a.key, vars)}</div>
        <div class="action__why">${escapeHtml(t(a.whyKey, whyVars))}</div>
      </div>
      ${a.tool ? `<a class="action__go" href="../${a.tool}/">${escapeHtml(t('profile.actGo'))}
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5"/></svg></a>` : '<span></span>'}
    </div>`;
  }).join('');
}

function renderHoldings() {
  const freqOpts = [12, 4, 2, 1, 0];
  $('#holdings').innerHTML = P.holdings.map((h, i) => `
    <div class="holding holding--profile" data-row="${i}">
      <span class="holding__dot" style="background:var(${PALETTE[i % PALETTE.length]})"></span>
      <input class="holding__name" value="${escapeHtml(h.name)}" data-k="name" aria-label="${escapeHtml(t('profile.colName'))} ${i + 1}">
      <input class="holding__num" type="number" value="${h.value}" data-k="value" step="10000" min="0" aria-label="${escapeHtml(t('profile.colValue'))} ${i + 1}">
      <input class="holding__num" type="number" value="${h.target}" data-k="target" step="1" min="0" max="100" aria-label="${escapeHtml(t('profile.colTarget'))} ${i + 1}">
      <input class="holding__num" type="number" value="${h.yield}" data-k="yield" step="0.1" min="0" max="30" aria-label="${escapeHtml(t('profile.colYield'))} ${i + 1}">
      <select class="holding__sel holding__freq" data-k="freq" aria-label="${escapeHtml(t('profile.colFreq'))} ${i + 1}">
        ${freqOpts.map((f) => `<option value="${f}"${Number(h.freq) === f ? ' selected' : ''}>${escapeHtml(t('freq.' + f))}</option>`).join('')}
      </select>
      <button class="holding__del" type="button" data-del="${i}" aria-label="${escapeHtml(t('profile.remove', { name: h.name }))}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
      </button>
    </div>
    <div class="holding holding--profile" data-row="${i}" style="padding-top:0;padding-bottom:10px">
      <span></span>
      <select class="holding__sel" data-k="cls" aria-label="${escapeHtml(t('profile.colClass'))} ${i + 1}">
        ${CLASSES.map((c) => `<option value="${c}"${(h.cls || 'other') === c ? ' selected' : ''}>${escapeHtml(t('class.' + c))}</option>`).join('')}
      </select>
      <select class="holding__sel" data-k="start" style="grid-column:span 2" aria-label="${escapeHtml(t('profile.colFreq'))} ${i + 1}">
        ${monthNames('short').map((m, mi) => `<option value="${mi + 1}"${Number(h.start) === mi + 1 ? ' selected' : ''}>${escapeHtml(t('freq.from', { month: m }))}</option>`).join('')}
      </select>
      <span></span><span></span><span></span>
    </div>`).join('');
}

function renderLoans() {
  if (!P.loans.length) {
    $('#loans').innerHTML =
      `<div class="empty" style="padding:var(--s6) var(--s3)"><p class="empty__title">${escapeHtml(t('profile.noLoans'))}</p>` +
      `<p>${escapeHtml(t('profile.noLoansSub'))}</p></div>`;
    return;
  }
  $('#loans').innerHTML = P.loans.map((l, i) => `
    <div style="padding-bottom:var(--s4);margin-bottom:var(--s4);border-bottom:1px solid var(--hairline-soft)" data-loan="${i}">
      <div style="display:flex;gap:var(--s2);align-items:center;margin-bottom:var(--s3)">
        <input class="holding__name" value="${escapeHtml(l.name)}" data-lk="name" style="flex:1"
               aria-label="${escapeHtml(t('profile.loanName'))} ${i + 1}">
        <button class="holding__del" type="button" data-delloan="${i}" style="opacity:1"
                aria-label="${escapeHtml(t('profile.remove', { name: l.name }))}">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
        </button>
      </div>
      <div class="grid-fields" style="grid-template-columns:1.4fr 1fr 1fr">
        <div class="mini-field">
          <label>${escapeHtml(t('profile.loanPrincipal'))}</label>
          <input class="holding__num" type="number" value="${l.principal}" data-lk="principal" step="100000" min="0">
        </div>
        <div class="mini-field">
          <label>${escapeHtml(t('profile.loanRate'))}</label>
          <input class="holding__num" type="number" value="${l.rate}" data-lk="rate" step="0.01" min="0" max="30">
        </div>
        <div class="mini-field">
          <label>${escapeHtml(t('profile.loanTerm'))}</label>
          <input class="holding__num" type="number" value="${l.term}" data-lk="term" step="1" min="1" max="40">
        </div>
      </div>
      <p class="field__hint" style="margin-top:8px">${escapeHtml(t('mortgage.mPay'))}: <span class="num">${money(monthlyPayment(l))}</span></p>
    </div>`).join('');
}

function renderAssumptions() {
  $('#assume').innerHTML = ASSUMPTIONS.map((a) => `
    <div class="field" style="margin:0">
      <label class="field__label" for="a_${a.k}">${escapeHtml(t(a.labelKey))}</label>
      <div class="range-row">
        <input class="range" id="a_${a.k}" data-assume="${a.k}" type="range"
               min="${a.min}" max="${a.max}" step="${a.step}" value="${P.assumptions[a.k]}">
        <output class="range-val" id="a_${a.k}_out">${a.fmt(P.assumptions[a.k])}</output>
      </div>
    </div>`).join('');

  ASSUMPTIONS.forEach((a) => {
    const input = $('#a_' + a.k);
    bindRange(input, (v) => {
      $('#a_' + a.k + '_out').textContent = a.fmt(v);
      P.assumptions[a.k] = v;
      save();
    });
  });
}

function renderCashFields() {
  const set = (id, v) => { const n = $(id); if (n && document.activeElement !== n) n.value = v; };
  set('#pCash', P.cash); set('#pEmergency', P.emergency); set('#pProperty', P.property);
  set('#pIncome', P.income); set('#pSpend', P.spend);
  document.querySelectorAll('[data-cur-symbol]').forEach((n) => { n.textContent = curSymbol(); });
}

/** The net worth line. Two points is enough to be worth looking at. */
function renderTimeline(d) {
  const snaps = P.snapshots;
  if (snaps.length >= 2) {
    lineChart($('#tlChart'), {
      series: [{ key: 'net', label: t('profile.snapshotNet'), values: snaps.map((s) => s.net), color: '--accent', area: true, areaOpacity: 0.1 }],
      x: { values: snaps.map((s, i) => i), format: (v, i) => formatDate(snaps[i].date), readoutLabel: t('profile.snapshotCol') },
      y: { format: moneyShort },
      height: 260,
      endLabels: false,
      table: { caption: t('profile.timelineTitle'), xLabel: t('profile.snapshotCol') },
    });
  } else {
    $('#tlChart').innerHTML =
      `<div class="empty" style="padding:var(--s6) var(--s3)"><p class="empty__title">${
        escapeHtml(snaps.length ? t('profile.snapshotNeedTwo') : t('profile.snapshotEmpty'))}</p>` +
      `<p>${escapeHtml(t('profile.snapshotEmptySub'))}</p></div>`;
  }

  $('#snaps').innerHTML = [...snaps].reverse().map((s, ri) => {
    const idx = snaps.length - 1 - ri;
    const prev = idx > 0 ? snaps[idx - 1] : null;
    const delta = prev ? s.net - prev.net : null;
    return `<div class="snap">
      <span class="snap__date">${escapeHtml(formatDate(s.date))}</span>
      <span class="snap__note">${escapeHtml(s.note || '')}</span>
      <span class="snap__net">${money(s.net)}</span>
      <span class="delta ${delta === null ? '' : delta >= 0 ? 'delta--pos' : 'delta--neg'}">${
        delta === null ? '' : (delta >= 0 ? '+' : '') + moneyShort(delta)}</span>
      <button class="snap__del" type="button" data-delsnap="${idx}" aria-label="${escapeHtml(t('profile.snapshotDel'))}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
      </button>
    </div>`;
  }).join('');
}

function renderJournal() {
  if (!P.journal.length) {
    $('#journal').innerHTML =
      `<div class="empty"><p class="empty__title">${escapeHtml(t('profile.journalEmpty'))}</p>` +
      `<p>${escapeHtml(t('profile.journalEmptySub'))}</p></div>`;
    return;
  }
  $('#journal').innerHTML = P.journal.map((e, i) => `
    <div class="entry">
      <div class="entry__head">
        <span class="entry__what">${escapeHtml(e.what)}</span>
        <span class="entry__date">${escapeHtml(formatDate(e.date))}</span>
      </div>
      ${e.why ? `<p class="entry__why">${escapeHtml(e.why)}</p>` : ''}
      <button class="entry__del" type="button" data-delentry="${i}" aria-label="${escapeHtml(t('profile.journalDel'))}">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>
      </button>
    </div>`).join('');
}

function paintCurrencySeg() {
  $('#curSeg').querySelectorAll('[data-cur]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.cur === P.currency)));
}

/* -------------------------------------------------------------------- wire */

function boot() {
  mountShell({ base: '../', tool: 'profile' });
  P = loadProfile();
  if (!P.currency) P.currency = detectCurrency();
  renderAll();

  $('#btnDemo').addEventListener('click', () => {
    P = saveProfile(demoProfile());
    renderAll();
    toast(t('profile.demoLoaded'));
  });

  // Holdings: edit in place. The list is only rebuilt on add and remove, so a
  // keystroke never pulls focus out of the field being typed into.
  $('#holdings').addEventListener('input', (e) => {
    const row = e.target.closest('[data-row]');
    if (!row) return;
    const h = P.holdings[Number(row.dataset.row)];
    const k = e.target.dataset.k;
    if (!h || !k) return;
    if (k === 'name' || k === 'cls') h[k] = e.target.value;
    else h[k] = Number(e.target.value) || 0;
    if (k === 'cls') { const dflt = CLASS_DEFAULTS[h.cls]; if (dflt) { h.r = dflt.r; h.v = dflt.v; } }
    save();
  });
  $('#holdings').addEventListener('change', (e) => {
    if (e.target.tagName !== 'SELECT') return;
    const row = e.target.closest('[data-row]');
    if (!row) return;
    const h = P.holdings[Number(row.dataset.row)];
    const k = e.target.dataset.k;
    if (h && k) { h[k] = k === 'cls' ? e.target.value : Number(e.target.value); save(); }
  });
  $('#holdings').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    if (P.holdings.length <= 1) { toast(t('profile.keepOne')); return; }
    P.holdings.splice(Number(del.dataset.del), 1);
    saveProfile(P); renderHoldings(); renderDerived();
  });

  $('#btnAdd').addEventListener('click', () => {
    P.holdings.push({ id: uid(), name: '', value: 0, target: 0, yield: 0, freq: 4, start: 1, cls: 'equity' });
    saveProfile(P); renderHoldings(); renderDerived();
    const rows = $('#holdings').querySelectorAll('.holding__name');
    rows[rows.length - 1]?.focus();
  });

  $('#btnNormalise').addEventListener('click', () => {
    const sum = P.holdings.reduce((a, h) => a + Math.max(0, Number(h.target) || 0), 0);
    if (!sum) { toast(t('profile.keepOne')); return; }
    P.holdings.forEach((h) => { h.target = Number(((Math.max(0, h.target) / sum) * 100).toFixed(1)); });
    saveProfile(P); renderHoldings(); renderDerived();
    toast(t('profile.normalised'));
  });

  // Cash and income
  [['cash', 10000], ['emergency', 10000], ['property', 100000],
   ['income', 5000], ['spend', 5000]].forEach(([k, step]) => {
    bindNumber($(`[data-num="${k}"]`), {
      step, min: 0, max: 1e12,
      onInput: (v) => { P[k] = v; save(); },
    });
  });

  // Loans
  $('#loans').addEventListener('input', (e) => {
    const row = e.target.closest('[data-loan]');
    if (!row) return;
    const l = P.loans[Number(row.dataset.loan)];
    const k = e.target.dataset.lk;
    if (!l || !k) return;
    l[k] = k === 'name' ? e.target.value : Number(e.target.value) || 0;
    save();
  });
  $('#loans').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delloan]');
    if (!del) return;
    P.loans.splice(Number(del.dataset.delloan), 1);
    saveProfile(P); renderLoans(); renderDerived();
  });
  $('#btnAddLoan').addEventListener('click', () => {
    P.loans.push({ id: uid(), name: t('mortgage.h1'), principal: 0, rate: 2.35, term: 20 });
    saveProfile(P); renderLoans(); renderDerived();
  });

  // Currency
  $('#curSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cur]');
    if (!b) return;
    P.currency = b.dataset.cur;
    setCurrency(P.currency);
    saveProfile(P);
    paintCurrencySeg();
    renderAll();
  });

  // Snapshots
  $('#btnSnap').addEventListener('click', () => {
    P = addSnapshot(P, $('#snapNote').value);
    $('#snapNote').value = '';
    renderDerived();
    toast(t('profile.snapshotDone'));
  });
  $('#snaps').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delsnap]');
    if (!del) return;
    P.snapshots.splice(Number(del.dataset.delsnap), 1);
    saveProfile(P); renderDerived();
  });

  // Journal
  $('#btnJournal').addEventListener('click', () => {
    const what = $('#jWhat').value.trim();
    if (!what) { $('#jWhat').focus(); return; }
    P = addJournal(P, what, $('#jWhy').value.trim());
    $('#jWhat').value = ''; $('#jWhy').value = '';
    renderJournal();
    toast(t('profile.journalSaved'));
  });
  $('#journal').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delentry]');
    if (!del) return;
    P.journal.splice(Number(del.dataset.delentry), 1);
    saveProfile(P); renderJournal();
  });

  // Data
  $('#btnExport').addEventListener('click', () => { exportProfile(P); toast(t('profile.exported')); });
  $('#btnImport').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      P = await importProfile(f);
      renderAll();
      toast(t('profile.imported'));
    } catch (err) {
      toast(t('profile.importFail'));
    }
    e.target.value = '';
  });
  $('#btnClear').addEventListener('click', () => {
    if (!confirm(t('profile.clearConfirm'))) return;
    clearProfile();
    P = loadProfile();
    renderAll();
    toast(t('profile.cleared'));
  });

  window.addEventListener('ledger:locale', () => { renderAll(); });
  window.addEventListener('ledger:theme', () => renderDerived());

  enterWorkbench();
  revealOnScroll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
