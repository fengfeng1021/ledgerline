/* Ledgerline chart engine — hand-built SVG.
   No chart library, so no chart library's default look.
   Rules enforced here: max 5 ticks/axis, horizontal grid only, direct end labels,
   crosshair readout instead of floating cards, screen-reader table twin. */

import { drawPath, fadeIn, growBars } from './motion.js';

const NS = 'http://www.w3.org/2000/svg';
const SERIES_VAR = ['--accent', '--sage-400', '--slate-400', '--plum-400'];

const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  return n;
};

const niceTicks = (lo, hi, count = 4) => {
  if (!isFinite(lo) || !isFinite(hi)) return [0];
  if (lo === hi) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out.length ? out : [lo, hi];
};

/**
 * Line chart with optional shaded band (for uncertainty) and stacked areas
 * (for composition). One object, used by five of the six tools.
 *
 * spec = {
 *   series: [{ key, label, values:[n], color?, dashed?, area? }],
 *   band?:  { lo:[n], hi:[n], color? },
 *   x:      { values:[n], format(v) },
 *   y:      { format(v), min?, max?, zero? },
 *   markers?: [{ x:index, label }],
 *   height?, readout?: HTMLElement, table?: { caption, xLabel }
 * }
 */
export function lineChart(mount, spec) {
  const W = 1000;
  const H = spec.height ?? 380;
  const PAD = { t: 16, r: spec.endLabels === false ? 16 : 84, b: 30, l: 58 };
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;

  const xs = spec.x.values;
  const n = xs.length;
  if (!n) { renderEmpty(mount); return null; }

  let lo = spec.y.min, hi = spec.y.max;
  if (lo == null || hi == null) {
    let mn = Infinity, mx = -Infinity;
    const scan = (arr) => arr.forEach((v) => { if (isFinite(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } });
    spec.series.forEach((s) => scan(s.values));
    if (spec.band) { scan(spec.band.lo); scan(spec.band.hi); }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    if (spec.y.zero !== false) mn = Math.min(mn, 0);
    if (mn === mx) { mx = mn + Math.abs(mn || 1) * 0.1; }
    const padY = (mx - mn) * 0.08;
    lo = lo ?? mn - (mn === 0 ? 0 : padY);
    hi = hi ?? mx + padY;
  }

  const xAt = (i) => PAD.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yAt = (v) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', preserveAspectRatio: 'none' });
  svg.style.height = H + 'px';
  svg.style.maxHeight = '58vh';

  // --- grid (horizontal only) + y ticks
  const yTicks = niceTicks(lo, hi, 4).slice(0, 5);
  yTicks.forEach((t) => {
    const y = yAt(t);
    if (y < PAD.t - 1 || y > PAD.t + ih + 1) return;
    svg.appendChild(el('line', { x1: PAD.l, x2: PAD.l + iw, y1: y, y2: y, class: 'chart__grid' }));
    const label = el('text', { x: PAD.l - 10, y: y + 3.5, class: 'chart__tick', 'text-anchor': 'end' });
    label.textContent = spec.y.format(t);
    svg.appendChild(label);
  });

  // --- x axis + up to 5 ticks
  svg.appendChild(el('line', { x1: PAD.l, x2: PAD.l + iw, y1: PAD.t + ih, y2: PAD.t + ih, class: 'chart__axis-line' }));
  const stepX = Math.max(1, Math.round((n - 1) / 4));
  for (let i = 0; i < n; i += stepX) {
    const t = el('text', { x: xAt(i), y: H - 10, class: 'chart__tick', 'text-anchor': i === 0 ? 'start' : 'middle' });
    t.textContent = spec.x.format(xs[i], i);
    svg.appendChild(t);
  }

  // --- band (uncertainty context, fades rather than draws)
  let bandNode = null;
  if (spec.band) {
    const up = spec.band.hi.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' L');
    const dn = spec.band.lo.map((v, i) => `${xAt(i)},${yAt(v)}`).reverse().join(' L');
    bandNode = el('path', {
      d: `M${up} L${dn} Z`,
      class: 'chart__band',
      fill: `var(${spec.band.color || '--accent'})`,
      opacity: 0,
    });
    svg.appendChild(bandNode);
  }

  // --- stacked area fills (composition context)
  const areaNodes = [];
  spec.series.forEach((s, si) => {
    if (!s.area) return;
    const color = s.color || SERIES_VAR[si % 4];
    const base = s.areaBase ?? Math.max(lo, 0);
    const top = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' L');
    const p = el('path', {
      d: `M${xAt(0)},${yAt(base)} L${top} L${xAt(n - 1)},${yAt(base)} Z`,
      fill: `var(${color})`, stroke: 'none', opacity: 0,
    });
    svg.appendChild(p);
    areaNodes.push({ node: p, to: s.areaOpacity ?? 0.12 });
  });

  // --- lines
  const paths = [];
  spec.series.forEach((s, si) => {
    const color = s.color || SERIES_VAR[si % 4];
    const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(v)}`).join(' ');
    const p = el('path', {
      d, class: 'chart__line', stroke: `var(${color})`,
      'stroke-dasharray': s.dashed ? '5 5' : null,
      'stroke-width': s.width ?? 2,
    });
    svg.appendChild(p);
    paths.push(p);
  });

  // --- markers (a moment worth naming, e.g. "crossover")
  (spec.markers || []).forEach((m) => {
    if (m.x < 0 || m.x >= n) return;
    const x = xAt(m.x);
    svg.appendChild(el('line', { x1: x, x2: x, y1: PAD.t, y2: PAD.t + ih, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-dasharray': '3 4', opacity: 0.5 }));
    const t = el('text', { x: x + 6, y: PAD.t + 12, class: 'chart__tick', fill: 'var(--accent)' });
    t.textContent = m.label;
    svg.appendChild(t);
  });

  // --- direct end labels beat a legend
  if (spec.endLabels !== false) {
    spec.series.forEach((s, si) => {
      const v = s.values[n - 1];
      if (!isFinite(v)) return;
      const color = s.color || SERIES_VAR[si % 4];
      const t = el('text', {
        x: PAD.l + iw + 8, y: yAt(v) + 4,
        class: 'chart__end-label', fill: `var(${color})`,
      });
      t.textContent = s.endLabel ?? spec.y.format(v);
      svg.appendChild(t);
    });
  }

  // --- crosshair layer
  const cross = el('g', { opacity: 0, 'pointer-events': 'none' });
  const cLine = el('line', { y1: PAD.t, y2: PAD.t + ih, class: 'chart__crosshair' });
  cross.appendChild(cLine);
  const dots = spec.series.map((s, si) =>
    el('circle', { r: 4, class: 'chart__dot', fill: `var(${s.color || SERIES_VAR[si % 4]})` }));
  dots.forEach((d) => cross.appendChild(d));
  svg.appendChild(cross);

  const hit = el('rect', { x: PAD.l, y: PAD.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' });
  svg.appendChild(hit);

  mount.innerHTML = '';
  mount.appendChild(svg);

  // --- readout: one line of text, not a floating card
  const readout = spec.readout;
  const showAt = (i) => {
    cross.setAttribute('opacity', '1');
    const x = xAt(i);
    cLine.setAttribute('x1', x); cLine.setAttribute('x2', x);
    spec.series.forEach((s, si) => {
      const v = s.values[i];
      dots[si].setAttribute('cx', x);
      dots[si].setAttribute('cy', isFinite(v) ? yAt(v) : -99);
      dots[si].setAttribute('opacity', isFinite(v) ? 1 : 0);
    });
    if (readout) {
      readout.innerHTML =
        `<span><span class="readout__k">${spec.x.readoutLabel || 'At'}</span><span class="readout__v">${spec.x.format(xs[i], i)}</span></span>` +
        spec.series.map((s, si) =>
          `<span><span class="readout__k" style="color:var(${s.color || SERIES_VAR[si % 4]})">${s.label}</span>` +
          `<span class="readout__v">${spec.y.format(s.values[i])}</span></span>`).join('');
    }
  };
  const hide = () => {
    cross.setAttribute('opacity', '0');
    if (readout) readout.innerHTML = `<span class="readout__empty">${spec.readout_empty || 'Hover the chart to read any point'}</span>`;
  };
  const idxFrom = (clientX) => {
    const r = svg.getBoundingClientRect();
    const rel = ((clientX - r.left) / r.width) * W;
    return Math.round(((rel - PAD.l) / iw) * (n - 1));
  };
  const onMove = (e) => {
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const i = Math.max(0, Math.min(n - 1, idxFrom(cx)));
    if (isFinite(i)) showAt(i);
  };
  hit.addEventListener('mousemove', onMove);
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('touchstart', onMove, { passive: true });
  hit.addEventListener('touchmove', onMove, { passive: true });
  hit.addEventListener('touchend', hide);
  hide();

  // --- motion
  paths.forEach((p, i) => drawPath(p, { delay: i * 0.06 }));
  areaNodes.forEach((a, i) => fadeIn(a.node, a.to, { delay: 0.15 + i * 0.05 }));
  if (bandNode) fadeIn(bandNode, spec.band.opacity ?? 0.1, { delay: 0.1 });

  // --- accessible twin
  if (spec.table) attachTable(mount, spec, xs);
  svg.setAttribute('aria-label', spec.table?.caption || 'Projection chart');

  return { showAt, hide };
}

/**
 * Bar chart. Grouped or stacked. Used where the story is discrete amounts
 * (dividend months, mortgage interest vs principal).
 */
export function barChart(mount, spec) {
  const W = 1000;
  const H = spec.height ?? 300;
  const PAD = { t: 16, r: 16, b: 30, l: 58 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const xs = spec.x.values, n = xs.length;
  if (!n) { renderEmpty(mount); return; }

  const stacked = spec.stacked !== false;
  const totals = xs.map((_, i) =>
    stacked ? spec.series.reduce((a, s) => a + (s.values[i] || 0), 0)
            : Math.max(...spec.series.map((s) => s.values[i] || 0)));
  const hi = spec.y.max ?? (Math.max(...totals, 0) * 1.08 || 1);
  const lo = Math.min(0, ...spec.series.flatMap((s) => s.values));
  const yAt = (v) => PAD.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

  const slot = iw / n;
  const gap = Math.min(6, slot * 0.22);
  const bw = Math.max(1, slot - gap);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', preserveAspectRatio: 'none' });
  svg.style.height = H + 'px';

  niceTicks(lo, hi, 4).slice(0, 5).forEach((t) => {
    const y = yAt(t);
    if (y < PAD.t - 1 || y > PAD.t + ih + 1) return;
    svg.appendChild(el('line', { x1: PAD.l, x2: PAD.l + iw, y1: y, y2: y, class: 'chart__grid' }));
    const lab = el('text', { x: PAD.l - 10, y: y + 3.5, class: 'chart__tick', 'text-anchor': 'end' });
    lab.textContent = spec.y.format(t);
    svg.appendChild(lab);
  });
  svg.appendChild(el('line', { x1: PAD.l, x2: PAD.l + iw, y1: yAt(0), y2: yAt(0), class: 'chart__axis-line' }));

  const bars = [];
  for (let i = 0; i < n; i++) {
    const x0 = PAD.l + i * slot + gap / 2;
    if (stacked) {
      let acc = 0;
      spec.series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const y0 = yAt(acc + v), y1 = yAt(acc);
        acc += v;
        const r = el('rect', {
          x: x0, y: Math.min(y0, y1), width: bw, height: Math.max(0.5, Math.abs(y1 - y0)),
          fill: `var(${s.color || SERIES_VAR[si % 4]})`, rx: 1,
        });
        svg.appendChild(r); bars.push(r);
      });
    } else {
      const sw = bw / spec.series.length;
      spec.series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const y0 = yAt(v), y1 = yAt(0);
        const r = el('rect', {
          x: x0 + si * sw, y: Math.min(y0, y1), width: Math.max(1, sw - 1),
          height: Math.max(0.5, Math.abs(y1 - y0)),
          fill: `var(${s.color || SERIES_VAR[si % 4]})`, rx: 1,
        });
        svg.appendChild(r); bars.push(r);
      });
    }
  }

  const stepX = Math.max(1, Math.round(n / 6));
  for (let i = 0; i < n; i += stepX) {
    const t = el('text', { x: PAD.l + i * slot + slot / 2, y: H - 10, class: 'chart__tick', 'text-anchor': 'middle' });
    t.textContent = spec.x.format(xs[i], i);
    svg.appendChild(t);
  }

  mount.innerHTML = '';
  mount.appendChild(svg);
  growBars(bars);
  if (spec.table) attachTable(mount, spec, xs);
  svg.setAttribute('aria-label', spec.table?.caption || 'Bar chart');
}

/** Donut for allocation. Direct labels, no legend, no 3D, no shadow. */
export function donut(mount, slices, opts = {}) {
  const S = 240, R = 104, r = opts.inner ?? 70, C = S / 2;
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, role: 'img' });
  svg.style.maxWidth = '240px';
  svg.style.margin = '0 auto';

  let a0 = -Math.PI / 2;
  const arcs = [];
  slices.forEach((s) => {
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
    const path = el('path', {
      d: `M${p(R, a0)} A${R},${R} 0 ${big} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${big} 0 ${p(r, a0)} Z`,
      fill: `var(${s.color})`, stroke: 'var(--surface-panel)', 'stroke-width': 2,
    });
    path.appendChild(el('title')).textContent = `${s.label}: ${(s.value / total * 100).toFixed(1)}%`;
    svg.appendChild(path);
    arcs.push(path);
    a0 = a1;
  });

  if (opts.centerTop || opts.centerBottom) {
    const a = el('text', { x: C, y: C - 2, 'text-anchor': 'middle', class: 'chart__end-label', fill: 'var(--ink-strong)', style: 'font-size:19px' });
    a.textContent = opts.centerTop || '';
    svg.appendChild(a);
    const b = el('text', { x: C, y: C + 16, 'text-anchor': 'middle', class: 'chart__tick' });
    b.textContent = opts.centerBottom || '';
    svg.appendChild(b);
  }

  mount.innerHTML = '';
  mount.appendChild(svg);
  if (arcs.length && window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.gsap.fromTo(arcs,
      { opacity: 0, scale: 0.9, transformOrigin: `${C}px ${C}px` },
      { opacity: 1, scale: 1, duration: 0.5, ease: 'power3.out', stagger: 0.05 });
  }
  svg.setAttribute('aria-label', opts.label || 'Allocation breakdown');
}

/** Scatter with an optional traced frontier. Used by the allocation lab. */
export function scatter(mount, spec) {
  const W = 1000, H = spec.height ?? 400;
  const PAD = { t: 20, r: 24, b: 44, l: 62 };
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const pts = spec.points;
  if (!pts.length) { renderEmpty(mount); return; }

  const xsAll = pts.map((p) => p.x).concat(spec.frontier?.map((p) => p.x) || []);
  const ysAll = pts.map((p) => p.y).concat(spec.frontier?.map((p) => p.y) || []);
  const xlo = spec.x.min ?? Math.min(...xsAll) * 0.9, xhi = spec.x.max ?? Math.max(...xsAll) * 1.06;
  const ylo = spec.y.min ?? Math.min(...ysAll) * 0.9, yhi = spec.y.max ?? Math.max(...ysAll) * 1.06;
  const xAt = (v) => PAD.l + ((v - xlo) / (xhi - xlo || 1)) * iw;
  const yAt = (v) => PAD.t + ih - ((v - ylo) / (yhi - ylo || 1)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', preserveAspectRatio: 'none' });
  svg.style.height = H + 'px';

  niceTicks(ylo, yhi, 4).slice(0, 5).forEach((t) => {
    const y = yAt(t);
    svg.appendChild(el('line', { x1: PAD.l, x2: PAD.l + iw, y1: y, y2: y, class: 'chart__grid' }));
    const l = el('text', { x: PAD.l - 10, y: y + 3.5, class: 'chart__tick', 'text-anchor': 'end' });
    l.textContent = spec.y.format(t); svg.appendChild(l);
  });
  svg.appendChild(el('line', { x1: PAD.l, x2: PAD.l + iw, y1: PAD.t + ih, y2: PAD.t + ih, class: 'chart__axis-line' }));
  niceTicks(xlo, xhi, 4).slice(0, 5).forEach((t) => {
    const l = el('text', { x: xAt(t), y: H - 22, class: 'chart__tick', 'text-anchor': 'middle' });
    l.textContent = spec.x.format(t); svg.appendChild(l);
  });

  const ax = el('text', { x: PAD.l + iw / 2, y: H - 4, class: 'chart__tick', 'text-anchor': 'middle' });
  ax.textContent = spec.x.label || ''; svg.appendChild(ax);
  const ay = el('text', { x: 12, y: PAD.t + ih / 2, class: 'chart__tick', 'text-anchor': 'middle',
    transform: `rotate(-90 12 ${PAD.t + ih / 2})` });
  ay.textContent = spec.y.label || ''; svg.appendChild(ay);

  let fPath = null;
  if (spec.frontier?.length) {
    fPath = el('path', {
      d: spec.frontier.map((p, i) => `${i ? 'L' : 'M'}${xAt(p.x)},${yAt(p.y)}`).join(' '),
      class: 'chart__line', stroke: 'var(--ink-500)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4',
    });
    svg.appendChild(fPath);
  }

  const nodes = [];
  pts.forEach((p) => {
    const g = el('g', { style: 'cursor:pointer' });
    const c = el('circle', {
      cx: xAt(p.x), cy: yAt(p.y), r: p.big ? 8 : 5.5,
      fill: `var(${p.color || '--slate-400'})`,
      stroke: 'var(--surface-panel)', 'stroke-width': 2,
    });
    g.appendChild(c);
    if (p.label) {
      const t = el('text', { x: xAt(p.x) + (p.big ? 13 : 10), y: yAt(p.y) + 4, class: 'chart__end-label', fill: `var(${p.color || '--ink-second'})` });
      t.textContent = p.label; g.appendChild(t);
    }
    g.appendChild(el('title')).textContent = p.title || p.label || '';
    svg.appendChild(g);
    nodes.push(c);
  });

  mount.innerHTML = '';
  mount.appendChild(svg);
  if (fPath) drawPath(fPath, { duration: 1 });
  if (nodes.length && window.gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.gsap.fromTo(nodes, { scale: 0, transformOrigin: 'center' },
      { scale: 1, duration: 0.5, ease: 'back.out(2)', stagger: 0.03, delay: 0.25 });
  }
  svg.setAttribute('aria-label', spec.label || 'Risk and return scatter plot');
}

/* ------------------------------------------------------------- internals */

function renderEmpty(mount) {
  mount.innerHTML =
    '<div class="empty"><p class="empty__title">Nothing to plot yet</p>' +
    '<p>Adjust an assumption on the left and the projection appears here.</p></div>';
}

function attachTable(mount, spec, xs) {
  const t = document.createElement('table');
  t.className = 'visually-hidden';
  const step = Math.max(1, Math.round(xs.length / 24));
  const head = spec.series.map((s) => `<th scope="col">${s.label}</th>`).join('');
  const rows = [];
  for (let i = 0; i < xs.length; i += step) {
    rows.push(
      `<tr><th scope="row">${spec.x.format(xs[i], i)}</th>` +
      spec.series.map((s) => `<td>${spec.y.format(s.values[i])}</td>`).join('') + '</tr>');
  }
  t.innerHTML =
    `<caption>${spec.table.caption}</caption>` +
    `<thead><tr><th scope="col">${spec.table.xLabel}</th>${head}</tr></thead>` +
    `<tbody>${rows.join('')}</tbody>`;
  mount.appendChild(t);
}

export { SERIES_VAR };
