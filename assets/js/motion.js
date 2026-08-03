/* Ledgerline motion - GSAP choreography shared by every surface.
   Every animation here answers "what does this communicate?".
   All of it is gated on prefers-reduced-motion via gsap.matchMedia. */

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;
if (gsap && ScrollTrigger) gsap.registerPlugin(ScrollTrigger);

gsap?.defaults({ duration: 0.55, ease: 'power3.out' });

export const mm = gsap ? gsap.matchMedia() : null;
export const MOTION_OK =
  !!gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------- number counters */

const counters = new WeakMap();

/**
 * Tween a metric from its current displayed value to the next one.
 * Communicates: the model recomputed, and these two numbers are the same number.
 *
 * The previous tween is killed by reference. Killing a freshly created object
 * would do nothing, and dragging a slider would leave several tweens writing
 * to the same element at once.
 */
export function countTo(el, value, format, opts = {}) {
  if (!el) return;
  const prev = counters.get(el);
  if (prev?.tween) prev.tween.kill();

  // Continue from whatever is on screen right now, not from the last target.
  const from = prev && isFinite(prev.shown) ? prev.shown : value;

  if (!MOTION_OK || !isFinite(value) || !isFinite(from) || from === value) {
    el.textContent = format(value);
    counters.set(el, { shown: value, tween: null });
    return;
  }

  const obj = { v: from };
  const rec = { shown: from, tween: null };
  counters.set(el, rec);
  rec.tween = gsap.to(obj, {
    v: value,
    duration: opts.duration ?? 0.55,
    ease: 'power2.out',
    onUpdate: () => { rec.shown = obj.v; el.textContent = format(obj.v); },
    onComplete: () => { rec.shown = value; rec.tween = null; el.textContent = format(value); },
  });
}

/** Flash a metric's ground when a result crosses a state boundary. */
export function flash(el) {
  if (!el) return;
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
  setTimeout(() => el.classList.remove('is-flash'), 620);
}

/* ------------------------------------------------------------ chart draw */

/**
 * Draw a path as if it were being derived. Communicates: this curve is an output.
 * Re-runs cheaply on every recompute, so it is kept short.
 */
export function drawPath(path, opts = {}) {
  if (!path) return;
  if (!MOTION_OK) { path.style.strokeDasharray = 'none'; path.style.strokeDashoffset = '0'; return; }
  let len = 0;
  try { len = path.getTotalLength(); } catch (e) { return; }
  if (!len) return;
  gsap.killTweensOf(path);
  gsap.fromTo(
    path,
    { strokeDasharray: len, strokeDashoffset: len },
    {
      strokeDashoffset: 0,
      duration: opts.duration ?? 0.85,
      ease: 'power3.out',
      delay: opts.delay ?? 0,
      onComplete: () => { path.style.strokeDasharray = 'none'; },
    }
  );
}

/** Areas and bands fade rather than draw: they are context, not the claim. */
export function fadeIn(el, to = 1, opts = {}) {
  if (!el) return;
  if (!MOTION_OK) { el.style.opacity = to; return; }
  gsap.fromTo(el, { opacity: 0 }, { opacity: to, duration: opts.duration ?? 0.6, ease: 'power2.out', delay: opts.delay ?? 0 });
}

/** Bars grow from their baseline. Communicates magnitude accumulating. */
export function growBars(nodes, opts = {}) {
  if (!nodes || !nodes.length) return;
  if (!MOTION_OK) { gsap?.set(nodes, { scaleY: 1, opacity: 1 }); return; }
  gsap.fromTo(
    nodes,
    { scaleY: 0, opacity: 0.4 },
    {
      scaleY: 1, opacity: 1,
      duration: 0.6, ease: 'power3.out',
      stagger: { each: opts.each ?? 0.012, from: 'start' },
      transformOrigin: 'center bottom',
    }
  );
}

/* ------------------------------------------------------------ page enter */

/**
 * Reading order on first paint. Rail assumptions, then headline consequences,
 * then supporting panels.
 */
export function enterWorkbench() {
  document.body.classList.add('motion-ready');
  if (!gsap) { document.querySelectorAll('.pre').forEach((n) => n.classList.remove('pre')); return; }
  mm.add(
    { ok: '(prefers-reduced-motion: no-preference)' },
    (ctx) => {
      if (!ctx.conditions.ok) {
        gsap.set('.pre', { opacity: 1, y: 0, clearProps: 'all' });
        return;
      }
      const tl = gsap.timeline({ defaults: { duration: 0.6, ease: 'power3.out' } });
      // Only above-the-fold blocks. Anything marked [data-reveal] belongs to
      // revealOnScroll, and animating it from both places fights over autoAlpha.
      // Some tools open with a .split of two panels rather than a single panel.
      const above = gsap.utils.toArray('.stage > .panel, .stage > .split')
        .filter((n) => !n.hasAttribute('data-reveal'));
      tl.fromTo('.rail .group', { autoAlpha: 0, x: -10 }, { autoAlpha: 1, x: 0, stagger: 0.05 })
        .fromTo('.stage__head', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0 }, '<0.05')
        .fromTo('.metrics', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0 }, '<0.08');
      if (above.length) {
        tl.fromTo(above, { autoAlpha: 0, y: 18 }, { autoAlpha: 1, y: 0, stagger: 0.07 }, '<0.1');
      }
      document.querySelectorAll('.pre').forEach((n) => n.classList.remove('pre'));
    }
  );
}

/** Panels that arrive below the fold reveal on scroll, batched. */
export function revealOnScroll(selector = '[data-reveal]') {
  if (!gsap || !ScrollTrigger) return;
  mm.add({ ok: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
    if (!ctx.conditions.ok) { gsap.set(selector, { autoAlpha: 1, y: 0 }); return; }
    gsap.set(selector, { autoAlpha: 0, y: 22 });
    ScrollTrigger.batch(selector, {
      start: 'top 88%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, { autoAlpha: 1, y: 0, duration: 0.65, ease: 'power3.out', stagger: 0.07, overwrite: true }),
    });
  });
}

/* --------------------------------------------------------- hub story arc */

/**
 * Hub only. The scroll position is the time axis of a compounding model, so the
 * pinned instrument advances as you scroll. That is the whole argument of the site,
 * made physical.
 */
export function hubStory({ onProgress } = {}) {
  // Reveal first, animate second. If the CDN never delivers GSAP, the page must
  // still be readable rather than a screen of invisible text.
  document.body.classList.add('motion-ready');
  if (!gsap || !ScrollTrigger) {
    document.querySelectorAll('.pre').forEach((n) => n.classList.remove('pre'));
    onProgress?.(1);
    return;
  }

  mm.add(
    {
      ok: '(prefers-reduced-motion: no-preference)',
      // Pinning is desktop-only. Hijacking scroll on a phone is hostile, and the
      // pin spacer holds a stale width across a rotation, which pushes the page
      // sideways. matchMedia tears the whole thing down below this breakpoint.
      wide: '(min-width: 1001px) and (prefers-reduced-motion: no-preference)',
    },
    (ctx) => {
      const { ok, wide } = ctx.conditions;

      if (!ok) {
        gsap.set('.hero__line, .hero__cta, .instrument', { autoAlpha: 1, y: 0, clearProps: 'all' });
        onProgress?.(1);
        document.querySelectorAll('.pre').forEach((n) => n.classList.remove('pre'));
        return;
      }

      // Hero: the claim lands one line at a time, the instrument arrives last.
      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      intro
        .fromTo('.hero__line', { autoAlpha: 0, y: 26 }, { autoAlpha: 1, y: 0, duration: 0.8, stagger: 0.08 })
        .fromTo('.hero__sub', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.6 }, '-=0.45')
        .fromTo('.hero__cta > *', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07 }, '-=0.35')
        .fromTo('.instrument', { autoAlpha: 0, y: 34, scale: 0.985 },
                { autoAlpha: 1, y: 0, scale: 1, duration: 0.95 }, '-=0.55');

      document.querySelectorAll('.pre').forEach((n) => n.classList.remove('pre'));

      // Scroll is the model's time axis.
      const story = document.querySelector('[data-story]');
      if (story && onProgress) {
        if (wide) {
          ScrollTrigger.create({
            trigger: story,
            start: 'top top',
            end: '+=' + Math.round(window.innerHeight * 2.4),
            pin: '[data-story-pin]',
            scrub: 0.8,
            invalidateOnRefresh: true,
            onUpdate: (self) => onProgress(self.progress),
          });
        } else {
          // Narrow screens read the story as an ordinary scroll: the model still
          // advances, it just does not hold the viewport hostage to do it.
          ScrollTrigger.create({
            trigger: story,
            start: 'top bottom',
            end: 'bottom top',
            scrub: 0.6,
            onUpdate: (self) => onProgress(self.progress),
          });
        }
      }

      // Story captions hand off one at a time.
      gsap.utils.toArray('[data-story-step]').forEach((step) => {
        gsap.fromTo(step,
          { autoAlpha: 0.16 },
          {
            autoAlpha: 1,
            duration: 0.3,
            scrollTrigger: { trigger: step, start: 'top 72%', end: 'bottom 40%', toggleActions: 'play reverse play reverse' },
          });
      });

      return () => { onProgress?.(1); };
    }
  );
}

/** Tool cards on the hub: hover lifts the card and advances its sparkline. */
export function bindToolCards() {
  if (!gsap) return;
  mm.add({ ok: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
    if (!ctx.conditions.ok) return;
    gsap.utils.toArray('.tool-card').forEach((card) => {
      const spark = card.querySelector('.tool-card__spark path');
      const arrow = card.querySelector('.tool-card__go');
      const enter = () => {
        gsap.to(card, { y: -3, borderColor: 'var(--ink-500)', duration: 0.3, ease: 'power2.out' });
        gsap.to(arrow, { x: 4, duration: 0.3, ease: 'power2.out' });
        if (spark) drawPath(spark, { duration: 0.6 });
      };
      const leave = () => {
        gsap.to(card, { y: 0, borderColor: 'var(--hairline-soft)', duration: 0.35, ease: 'power2.out' });
        gsap.to(arrow, { x: 0, duration: 0.35, ease: 'power2.out' });
      };
      card.addEventListener('mouseenter', enter);
      card.addEventListener('focusin', enter);
      card.addEventListener('mouseleave', leave);
      card.addEventListener('focusout', leave);
    });
  });
}

export function refreshScroll() { ScrollTrigger?.refresh(); }
