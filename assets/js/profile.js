/* Ledgerline profile - the single financial file every tool reads.
   This is what turns six calculators into one thing worth coming back to:
   holdings, cash, loans and assumptions are entered once, and the snapshot
   history is the only data on this site that accumulates. */

import { detectCurrency, getLocale } from './i18n.js';

const KEY = 'ledgerline:profile';
export const SCHEMA_VERSION = 1;

export const CLASSES = ['equity', 'bond', 'cash', 'reit', 'commodity', 'other'];

/** Class defaults, used when a holding has no explicit risk numbers yet. */
export const CLASS_DEFAULTS = {
  equity:    { r: 7.2, v: 16 },
  bond:      { r: 3.1, v: 6 },
  cash:      { r: 2.0, v: 0.6 },
  reit:      { r: 6.0, v: 18 },
  commodity: { r: 4.0, v: 18 },
  other:     { r: 5.0, v: 12 },
};

function emptyProfile() {
  return {
    version: SCHEMA_VERSION,
    createdAt: null,
    updatedAt: null,
    currency: detectCurrency(),
    holdings: [],
    cash: 0,
    emergency: 0,
    // Non-investable assets: the home you live in, a car. They belong in net
    // worth but must never appear in a rebalance or an allocation, because you
    // cannot sell a third of your kitchen to buy bonds.
    property: 0,
    income: 0,          // take-home, monthly
    spend: 0,           // monthly
    loans: [],
    assumptions: {
      rate: 6,          // expected nominal annual return
      inflation: 2.2,
      fee: 0.3,
      swr: 4,
      tol: 5,           // rebalance tolerance, percentage points
      tax: 20,          // dividend withholding
      corr: 0.25,
      rf: 2,
    },
    snapshots: [],      // { date, net, assets, debt, note }
    journal: [],        // { date, what, why }
  };
}

/**
 * Example data. Locale-aware, because a Taiwanese example priced in yen and a
 * US example holding 0050 are both nonsense. Realistic, obviously editable,
 * and never presented as advice.
 */
export function demoProfile() {
  const p = emptyProfile();
  const today = new Date().toISOString().slice(0, 10);
  p.createdAt = today;
  p.updatedAt = today;

  if (getLocale().startsWith('zh')) {
    p.currency = 'TWD';
    p.holdings = [
      { id: uid(), name: '0050',   value: 1_450_000, target: 45, yield: 3.2, freq: 2, start: 1, cls: 'equity' },
      { id: uid(), name: 'VT',     value: 980_000,   target: 30, yield: 1.9, freq: 4, start: 3, cls: 'equity' },
      { id: uid(), name: '00679B', value: 620_000,   target: 20, yield: 4.1, freq: 4, start: 2, cls: 'bond' },
      { id: uid(), name: '00878',  value: 310_000,   target: 5,  yield: 5.4, freq: 4, start: 2, cls: 'equity' },
    ];
    p.cash = 420_000;
    p.emergency = 300_000;
    p.property = 9_800_000;
    p.income = 95_000;
    p.spend = 48_000;
    p.loans = [{ id: uid(), name: '房貸', principal: 6_800_000, rate: 2.35, term: 22 }];
  } else {
    // The example figures are written at a dollar-sized scale, so only
    // currencies of a similar magnitude are adopted. Showing ¥48,000 for a
    // holding that means $48,000 would read as a rounding error, not a portfolio.
    const near = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD'];
    const guess = detectCurrency();
    p.currency = near.includes(guess) ? guess : 'USD';
    p.holdings = [
      { id: uid(), name: 'VTI',  value: 48_000, target: 45, yield: 1.3, freq: 4, start: 3, cls: 'equity' },
      { id: uid(), name: 'VXUS', value: 31_000, target: 30, yield: 3.0, freq: 4, start: 3, cls: 'equity' },
      { id: uid(), name: 'BND',  value: 19_500, target: 20, yield: 3.8, freq: 12, start: 1, cls: 'bond' },
      { id: uid(), name: 'VNQ',  value: 9_200,  target: 5,  yield: 3.9, freq: 4, start: 3, cls: 'reit' },
    ];
    p.cash = 14_000;
    p.emergency = 10_000;
    p.property = 320_000;
    p.income = 5_400;
    p.spend = 2_900;
    p.loans = [{ id: uid(), name: 'Mortgage', principal: 228_000, rate: 5.9, term: 24 }];
  }
  return p;
}

export const uid = () =>
  'h' + Math.abs(Date.now() ^ (performance.now() * 1000 | 0)).toString(36) + (uid.n = (uid.n || 0) + 1).toString(36);

/* ------------------------------------------------------------------ io */

export function loadProfile() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* noop */ }
  if (!raw || typeof raw !== 'object') return emptyProfile();
  return migrate(raw);
}

function migrate(p) {
  const base = emptyProfile();
  const out = {
    ...base, ...p,
    assumptions: { ...base.assumptions, ...(p.assumptions || {}) },
    holdings: Array.isArray(p.holdings) ? p.holdings.map((h) => ({ ...h, id: h.id || uid() })) : [],
    loans: Array.isArray(p.loans) ? p.loans.map((l) => ({ ...l, id: l.id || uid() })) : [],
    snapshots: Array.isArray(p.snapshots) ? p.snapshots : [],
    journal: Array.isArray(p.journal) ? p.journal : [],
  };
  out.version = SCHEMA_VERSION;
  return out;
}

export function saveProfile(p) {
  p.updatedAt = new Date().toISOString().slice(0, 10);
  if (!p.createdAt) p.createdAt = p.updatedAt;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode */ }
  window.dispatchEvent(new CustomEvent('ledger:profile', { detail: p }));
  return p;
}

export function clearProfile() {
  try { localStorage.removeItem(KEY); } catch (e) { /* noop */ }
  window.dispatchEvent(new CustomEvent('ledger:profile', { detail: emptyProfile() }));
}

export const hasProfile = (p) =>
  !!(p && (p.holdings.length || p.cash > 0 || p.income > 0 || p.loans.length));

export function exportProfile(p) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ledgerline-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importProfile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const parsed = JSON.parse(String(fr.result));
        if (!parsed || typeof parsed !== 'object' || !('holdings' in parsed)) throw new Error('shape');
        resolve(saveProfile(migrate(parsed)));
      } catch (e) { reject(e); }
    };
    fr.onerror = () => reject(new Error('read'));
    fr.readAsText(file);
  });
}

/* ------------------------------------------------------------ derived */

/** Everything the overview and the action list need, computed in one pass. */
export function derive(p) {
  const invested = p.holdings.reduce((a, h) => a + Math.max(0, Number(h.value) || 0), 0);
  const cash = Math.max(0, Number(p.cash) || 0);
  const property = Math.max(0, Number(p.property) || 0);
  const assets = invested + cash + property;
  const debt = p.loans.reduce((a, l) => a + Math.max(0, Number(l.principal) || 0), 0);
  const net = assets - debt;

  const loanPayment = p.loans.reduce((a, l) => a + monthlyPayment(l), 0);
  const surplus = (Number(p.income) || 0) - (Number(p.spend) || 0) - loanPayment;

  const spend = Math.max(1, Number(p.spend) || 0);
  // Runway counts liquid assets only. You cannot eat a house.
  const runwayMonths = (cash + invested) / spend;
  const emergencyMonths = (Number(p.emergency) || 0) / spend;

  const targetSum = p.holdings.reduce((a, h) => a + Math.max(0, Number(h.target) || 0), 0);
  const rows = p.holdings.map((h) => {
    const value = Math.max(0, Number(h.value) || 0);
    const target = targetSum > 0 ? (Math.max(0, Number(h.target) || 0) / targetSum) * 100 : 0;
    const now = invested > 0 ? (value / invested) * 100 : 0;
    return { ...h, value, target, now, drift: now - target };
  });
  const worstDrift = rows.reduce((mx, r) => (Math.abs(r.drift) > Math.abs(mx.drift) ? r : mx),
    { drift: 0, name: '' });

  // New money that would fix every overweight without a single sell order.
  const requiredTotal = rows.reduce(
    (mx, r) => (r.target > 0 ? Math.max(mx, r.value / (r.target / 100)) : mx), 0);
  const cashToFix = Math.max(0, requiredTotal - invested);

  const annualDividend = p.holdings.reduce(
    (a, h) => a + Math.max(0, Number(h.value) || 0) * ((Number(h.yield) || 0) / 100), 0);
  const netDividend = annualDividend * (1 - (p.assumptions.tax || 0) / 100);

  const last = p.snapshots.length ? p.snapshots[p.snapshots.length - 1] : null;
  const prev = p.snapshots.length > 1 ? p.snapshots[p.snapshots.length - 2] : null;
  const changeVsLast = last ? net - last.net : null;
  const lastToPrev = last && prev ? last.net - prev.net : null;

  return {
    invested, cash, property, assets, debt, net,
    loanPayment, surplus, runwayMonths, emergencyMonths,
    rows, worstDrift, cashToFix, targetSum,
    annualDividend, netDividend,
    last, prev, changeVsLast, lastToPrev,
  };
}

export function monthlyPayment(loan) {
  const P = Math.max(0, Number(loan.principal) || 0);
  const r = (Number(loan.rate) || 0) / 100 / 12;
  const n = Math.max(1, Math.round((Number(loan.term) || 0) * 12));
  if (!P) return 0;
  if (r <= 0) return P / n;
  return (P * r) / (1 - Math.pow(1 + r, -n));
}

/** Which calendar months a holding pays in. */
export function payMonths(h) {
  const freq = Number(h.freq) || 0;
  if (!freq) return [];
  const step = 12 / freq;
  const start = Math.max(1, Math.min(12, Number(h.start) || 1));
  return Array.from({ length: freq }, (_, k) => (((start - 1 + k * step) % 12) + 12) % 12);
}

/* ------------------------------------------------------------ actions */

/**
 * The list that gives a reason to return. Every item is a real state of the
 * file, not a nag: drift outside the band, cash landing this month, data going
 * stale, or an emergency fund that is too thin to be investing on top of.
 */
export function actions(p, d, today = new Date()) {
  const out = [];
  const tol = p.assumptions.tol || 5;

  if (Math.abs(d.worstDrift.drift) > tol && d.rows.length > 1) {
    out.push({
      kind: 'drift', tone: 'warn', tool: 'rebalance',
      key: 'profile.actDrift',
      vars: { name: d.worstDrift.name, drift: fmtPct(Math.abs(d.worstDrift.drift)) },
      whyKey: 'profile.actDriftWhy',
      whyVars: { tol: fmtPct(tol), cash: d.cashToFix },
      money: ['cash'],
    });
  }

  if (d.emergencyMonths > 0 && d.emergencyMonths < 3) {
    out.push({
      kind: 'emergency', tone: 'warn', tool: null,
      key: 'profile.actEmergency', vars: { months: d.emergencyMonths.toFixed(1) },
      whyKey: 'profile.actEmergencyWhy', whyVars: {},
    });
  }

  const m = today.getMonth();
  const dueThisMonth = p.holdings.filter((h) => payMonths(h).includes(m));
  if (dueThisMonth.length) {
    const amount = dueThisMonth.reduce((a, h) => {
      const annual = Math.max(0, Number(h.value) || 0) * ((Number(h.yield) || 0) / 100);
      return a + (annual / (Number(h.freq) || 1)) * (1 - (p.assumptions.tax || 0) / 100);
    }, 0);
    if (amount > 0) {
      out.push({
        kind: 'dividend', tone: 'good', tool: 'dividend',
        key: 'profile.actDividend',
        vars: { monthIndex: m, amount },
        money: ['amount'],
        whyKey: 'profile.actDividendWhy',
        whyVars: { names: dueThisMonth.map((h) => h.name).join('、') },
      });
    }
  }

  if (!p.snapshots.length) {
    out.push({
      kind: 'snapshot', tone: 'info', tool: null,
      key: 'profile.actNoSnapshot', vars: {},
      whyKey: 'profile.actNoSnapshotWhy', whyVars: {},
    });
  } else if (p.updatedAt) {
    const days = Math.floor((today - new Date(p.updatedAt)) / 86400000);
    if (days > 60) {
      out.push({
        kind: 'stale', tone: 'info', tool: null,
        key: 'profile.actStale', vars: { days },
        whyKey: 'profile.actStaleWhy', whyVars: {},
      });
    }
  }

  return out;
}

const fmtPct = (n) => n.toFixed(1) + '%';

/* ------------------------------------------------------- tool adapters */

/**
 * Each tool asks the profile for exactly the shape it already understands, so
 * the tools keep their own models and gain a shared source of truth.
 */
export const adapt = {
  compound(p, d) {
    return {
      initial: d.invested + d.cash,
      monthly: Math.max(0, d.surplus),
      rate: p.assumptions.rate,
      fee: p.assumptions.fee,
      inflation: p.assumptions.inflation,
      cur: p.currency,
    };
  },

  fire(p, d) {
    const loanYear = d.loanPayment * 12;
    return {
      nest: d.invested + Math.max(0, d.cash - (Number(p.emergency) || 0)),
      income: (Number(p.income) || 0) * 12,
      spend: (Number(p.spend) || 0) * 12 + loanYear,
      // FIRE works in real terms, so the nominal assumption is deflated here.
      rate: Math.max(0, ((1 + p.assumptions.rate / 100) / (1 + p.assumptions.inflation / 100) - 1) * 100),
      fee: p.assumptions.fee,
      swr: p.assumptions.swr,
      cur: p.currency,
    };
  },

  rebalance(p, d) {
    return {
      holdings: p.holdings.map((h) => ({ name: h.name, value: h.value, target: h.target })),
      newCash: Math.max(0, d.cash - (Number(p.emergency) || 0)),
      tol: p.assumptions.tol,
      tax: p.assumptions.tax,
      cur: p.currency,
    };
  },

  dividend(p) {
    return {
      holdings: p.holdings
        .filter((h) => (Number(h.yield) || 0) > 0 && (Number(h.freq) || 0) > 0)
        .map((h) => ({ name: h.name, value: h.value, yield: h.yield, freq: h.freq, start: h.start })),
      tax: p.assumptions.tax,
      spend: Number(p.spend) || 0,
      cur: p.currency,
    };
  },

  mortgage(p) {
    const loan = p.loans[0];
    if (!loan) return null;
    return {
      principal: loan.principal, rate: loan.rate, term: loan.term,
      alt: p.assumptions.rate, cur: p.currency,
    };
  },

  allocation(p) {
    // Collapse holdings into their asset classes: a mix of four ETFs that are
    // all equity is one asset class, not four, and pretending otherwise
    // manufactures diversification that does not exist.
    const byClass = new Map();
    for (const h of p.holdings) {
      const cls = CLASSES.includes(h.cls) ? h.cls : 'other';
      const v = Math.max(0, Number(h.value) || 0);
      byClass.set(cls, (byClass.get(cls) || 0) + v);
    }
    const cash = Math.max(0, Number(p.cash) || 0);
    if (cash > 0) byClass.set('cash', (byClass.get('cash') || 0) + cash);
    const total = [...byClass.values()].reduce((a, b) => a + b, 0) || 1;
    const assets = [...byClass.entries()].map(([cls, v]) => ({
      name: cls,
      clsKey: 'class.' + cls,
      w: Number(((v / total) * 100).toFixed(1)),
      r: CLASS_DEFAULTS[cls].r,
      v: CLASS_DEFAULTS[cls].v,
    }));
    return assets.length >= 2 ? { assets, corr: p.assumptions.corr, rf: p.assumptions.rf } : null;
  },
};

/** Snapshot helpers. */
export function addSnapshot(p, note = '') {
  const d = derive(p);
  const date = new Date().toISOString().slice(0, 10);
  const existing = p.snapshots.findIndex((s) => s.date === date);
  const rec = { date, net: d.net, assets: d.assets, debt: d.debt, note: String(note || '').slice(0, 140) };
  if (existing >= 0) p.snapshots[existing] = rec;
  else p.snapshots.push(rec);
  p.snapshots.sort((a, b) => a.date.localeCompare(b.date));
  return saveProfile(p);
}

export function addJournal(p, what, why) {
  p.journal.unshift({
    date: new Date().toISOString().slice(0, 10),
    what: String(what).slice(0, 120),
    why: String(why || '').slice(0, 400),
  });
  p.journal = p.journal.slice(0, 200);
  return saveProfile(p);
}
