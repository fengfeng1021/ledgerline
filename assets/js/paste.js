/* Paste-to-update.
   The reason a manual portfolio tracker dies in month two is that updating it
   costs ten minutes. This makes it cost ten seconds: copy the broker's holdings
   table, paste, confirm. No API is involved, so nothing leaves the device.

   Every quote source worth using (TWSE, TPEX, stooq, Yahoo) refuses
   cross-origin reads, so a static page physically cannot fetch prices. This is
   the honest alternative, not a placeholder for one. */

/**
 * Numbers as brokers actually print them: 1,234,567 · $1,234,567.00 ·
 * NT$1,424,700 · 1 234 567. Currency symbols have to be stripped before the
 * test, not after: treating "$1,424,700" as a word leaves "9,000" as the only
 * number on the line, which turns a share count into a market value and shrinks
 * the position 150-fold without ever looking obviously wrong.
 */
const CUR_PREFIX = /^(?:NT|HK|US|S|A|C|R)?\$|^(?:TWD|USD|HKD|JPY|EUR|GBP|SGD|AUD|CAD|CNY|RMB)\s*/i;

const stripCurrency = (tok) =>
  String(tok).trim().replace(CUR_PREFIX, '').replace(/[$€£¥₩]/g, '').trim();

const isNumeric = (tok) => {
  const s = stripCurrency(tok);
  return /\d/.test(s) && /^[-+]?[\d.,\s]+$/.test(s);
};

const toNum = (tok) => {
  const n = Number(stripCurrency(tok).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** 0050, 00878, 006208: a Taiwanese ticker, never an amount. */
const isTicker = (tok) => /^0\d{3,5}[A-Za-z]?$/.test(String(tok).trim());

/**
 * Split a pasted table into rows of { label, numbers }.
 * Handles tab-separated (most brokers), multi-space, and comma-separated text.
 */
export function parseRows(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let cells = line.includes('\t') ? line.split('\t')
      : /\s{2,}/.test(line) ? line.split(/\s{2,}/)
      : line.includes(',') && !isNumeric(line) ? line.split(',')
      : line.split(/\s+/);
    cells = cells.map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    const numbers = [];
    const words = [];
    for (const c of cells) {
      // A ticker is an identifier that happens to be digits. Counting it as an
      // amount would let "0050" compete with the market value.
      if (isTicker(c)) { words.push(c); continue; }
      const n = isNumeric(c) ? toNum(c) : null;
      if (n !== null) numbers.push(n);
      else words.push(c);
    }
    if (!numbers.length) continue;

    const label = words.join(' ').trim();
    if (!label) continue;

    out.push({ label, numbers, raw: line });
  }
  return out;
}

/** Loose match: ticker inside the row, or the holding name inside the row. */
function matches(holdingName, row) {
  const hay = (row.label + ' ' + row.raw).toLowerCase();
  const name = String(holdingName || '').trim().toLowerCase();
  if (!name) return false;
  if (hay.includes(name)) return true;
  // A bare ticker still counts: "0050" against "0050 Yuanta Taiwan 50".
  const first = name.split(/[\s(（]/)[0];
  return first.length >= 2 && hay.includes(first);
}

/**
 * Pick the market value from a row's numbers.
 * Brokers put quantity, price, cost and value on the same line, and the value
 * is reliably the largest: shares times price exceeds either factor.
 */
function pickValue(numbers, previous) {
  const positives = numbers.filter((n) => n > 0);
  if (!positives.length) return null;
  const max = Math.max(...positives);
  // Prefer a candidate close to the previous value when one exists: an
  // unchanged position should not be re-read as its own share count.
  if (previous > 0) {
    const near = positives.filter((n) => n >= previous * 0.4 && n <= previous * 2.5);
    if (near.length) {
      return near.reduce((a, b) => (Math.abs(b - previous) < Math.abs(a - previous) ? b : a));
    }
  }
  return max;
}

/**
 * Diff a paste against the current holdings. Returns one entry per holding that
 * appears in the text and never writes anything: the caller confirms first.
 */
export function planUpdate(holdings, text) {
  const rows = parseRows(text);
  const plan = [];
  const used = new Set();

  holdings.forEach((h, i) => {
    const rowIndex = rows.findIndex((r, ri) => !used.has(ri) && matches(h.name, r));
    if (rowIndex < 0) return;
    used.add(rowIndex);
    const value = pickValue(rows[rowIndex].numbers, Number(h.value) || 0);
    if (value === null) return;
    plan.push({
      index: i,
      name: h.name,
      from: Number(h.value) || 0,
      to: Math.round(value),
      delta: Math.round(value) - (Number(h.value) || 0),
    });
  });

  const fromTotal = holdings.reduce((a, h) => a + (Number(h.value) || 0), 0);
  const toTotal = holdings.reduce((a, h, i) => {
    const p = plan.find((x) => x.index === i);
    return a + (p ? p.to : Number(h.value) || 0);
  }, 0);

  return { plan, rows: rows.length, fromTotal, toTotal };
}
