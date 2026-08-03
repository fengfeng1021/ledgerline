# Ledgerline - Design System

One visual world across seven surfaces. Every tool inherits this file.

## Design read

Reading this as: a suite of **Operate**-mode financial instruments fronted by one **Persuade**-mode hub,
for self-directed retail investors who already use spreadsheets, with a
*precision-instrument* language, leaning toward native CSS tokens + GSAP scroll choreography.

Dials: `DESIGN_VARIANCE 6` · `MOTION_INTENSITY 6` · `VISUAL_DENSITY 7`

Density is high because the audience came from a spreadsheet. Variance is mid because a
misread number is a real financial cost. Motion is mid-high because every number on screen is
the output of a model, and motion is how we show the model reacting.

## The anti-reference

What financial tooling defaults to, and what this explicitly is not:

| Default | Why it is rejected |
|---|---|
| Navy blue + neon green/red | Casino signalling. Encourages the reflex we are trying to slow down. |
| Glass cards floating on gradient mesh | Depth without information. Costs GPU, buys nothing. |
| Filled area charts under every line | Ink that encodes no data. Hides the line it decorates. |
| Big rounded "friendly" fintech radius | Softness reads as approximate. These are exact numbers. |
| Purple-to-blue AI gradient | Says "generated", not "computed". |

## Color

One accent. Locked page-wide. Semantic colors are desaturated deliberately: gain and loss
are facts, not alarms.

```
--ink-950  #07 0A 09    page ground
--ink-900  #0B0F0E      base surface
--ink-850  #10 15 14    raised surface
--ink-800  #151B1A      panel
--ink-700  #1D2523      inset / well
--ink-600  #2A3432      hairline strong
--ink-500  #3D4A47      hairline / disabled ink

--bone-050 #F7F5F1      pure heading
--bone-100 #EDEAE4      body ink
--bone-300 #B9B4AA      secondary ink
--bone-500 #857F76      muted / axis ink

--amber-400 #E8A33D     THE accent. CTAs, focus, active state, primary series.
--amber-300 #F2BE6E     accent hover
--amber-600 #A87422     accent pressed

--sage-400  #7FA88B     positive / gain / on-track
--clay-400  #C4705C     negative / loss / off-track
--slate-400 #6E8794     neutral third series
--plum-400  #9B7FA8     fourth series
```

Contrast audited: `bone-100` on `ink-900` = 15.8:1 · `bone-500` on `ink-900` = 5.6:1 ·
`amber-400` on `ink-900` = 8.9:1 · `ink-950` on `amber-400` = 8.4:1 (primary button).

Light mode is a genuine second theme, not an inversion: paper ground `#F7F5F1`, ink `#12100D`,
same amber, semantics darkened to hold 4.5:1.

## Type

| Role | Face | Setting |
|---|---|---|
| Display | Space Grotesk 500/700 | `clamp(2.4rem, 6vw, 5rem)`, `tracking -0.03em`, `leading 0.95` |
| UI / body | Instrument Sans 400/500/600 | 15px base, `leading 1.55`, body max `62ch` |
| Numerals | IBM Plex Mono 400/500 | `font-variant-numeric: tabular-nums` everywhere a number can change |

Every number that a user can change is mono and tabular. That is the rule that makes the
whole suite feel like one instrument.

## Shape and material

Documented radius rule, applied everywhere:

- `--r-sm 3px` - inputs, buttons, tags, chips
- `--r-md 6px` - cards, panels, dropdowns
- `--r-lg 10px` - sheets, modals, the hub's preview frame

Elevation is drawn with a **hairline plus a ground shift**, never a blur shadow. One inset
top highlight (`inset 0 1px 0 rgb(255 255 255 / .04)`) is the only light source.

## Motion

GSAP core + ScrollTrigger. Everything below is motivated; nothing loops for decoration.

| Moment | Spec | What it communicates |
|---|---|---|
| Number change | `power2.out` 0.5s, tabular counter tween | The model recomputed. Continuity between old and new value. |
| Chart redraw | `strokeDashoffset` 0.9s `power3.out`, area fades `0 -> .12` | The curve is being derived, not swapped. |
| Panel enter | `y 18 -> 0`, `autoAlpha 0 -> 1`, 0.55s, stagger 0.06 | Reading order. |
| Hub scroll story | ScrollTrigger `scrub: 0.8`, pinned instrument frame | Scroll is the time axis of the model. |
| Threshold cross | 0.35s ground tint + hairline flash | State changed (on-track becomes off-track). |
| Press | `scale .985` 90ms | Physical acknowledgement. |

`gsap.matchMedia()` gates every one of these on `(prefers-reduced-motion: no-preference)`.
Under reduce, values snap, charts render at final state, nothing pins.

## Interaction contract

Identical across all six tools. Learn one, you know all six.

1. **No submit button.** Inputs recompute on `input`, debounced 90ms.
2. **Left rail = assumptions. Main = consequences.** Always. Collapses to stacked on `<900px`.
3. **Every assumption is reversible** and shows its unit inline.
4. **State lives in the URL.** Serialised to `#` on idle, so any result is a shareable link.
5. **State persists** to `localStorage` per tool, restored silently on return.
6. **Scenario B** can be forked from A at any time and diffed in place.
7. **Keyboard**: `↑↓` steps a focused numeric field, `⇧↑↓` steps ×10, `⌘/Ctrl+K` opens the tool switcher, `?` opens shortcuts.
8. **Export**: copy plain-text summary, download CSV of the projection table.
9. **Nothing leaves the browser.** No network calls after asset load. Stated once on the hub, never repeated as a badge.

## Chart rules

Hand-built SVG. No chart library, so no library's default look.

- Axis lines `ink-600` at 1px, ticks are text-only, max 5 per axis.
- Series order: amber, sage, slate, plum. Never more than 4.
- Grid: horizontal only, `ink-700`, and only when values must be compared across a gap.
- Direct labels at the end of a line beat a legend. Legend only when 3+ series.
- Zero baseline always shown for bars. Never for a line whose story is shape.
- Hover produces a crosshair and a single readout, not a floating card.
- Every chart has a `<table class="visually-hidden">` twin for screen readers.
