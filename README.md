# Ledgerline

Six financial models, each given a real interface. No accounts, no uploads, no telemetry.
Every calculation runs in the visitor's browser.

**Live: https://fengfeng1021.github.io/ledgerline/**

## The tools

| Tool | The question it answers | What makes it different |
|---|---|---|
| [Compound](compound/) | What does regular investing actually become? | Fees and inflation are in the model, so the headline is money you could spend |
| [FIRE](fire/) | When can you stop, and does the money last? | 600 simulated return sequences instead of one flattering average |
| [Rebalance](rebalance/) | What do you buy to get back to target? | Works out the cash-only route first, and prices the sell order after tax |
| [Dividend](dividend/) | What lands in the account, and when? | A month-by-month calendar after tax, not an annual yield |
| [Mortgage](mortgage/) | What does paying extra actually save? | The interest curve, and the break-even against investing the same money |
| [Allocation](allocation/) | Is this mix better, or only different? | Volatility, correlation and risk contribution as numbers, against the frontier |

## Design principles

The full system is in [DESIGN.md](DESIGN.md); the product context is in [PRODUCT.md](PRODUCT.md).
Three rules do most of the work:

1. **Every number a user can change is monospaced and tabular.** That single rule is what makes
   six separate tools feel like one instrument.
2. **Assumptions on the left, consequences on the right.** Identical across all six, so learning
   one tool teaches the other five.
3. **A model that has a limitation says so next to the result**, not in a footnote nobody reads.

Motion is GSAP, and every animation answers a question: a counter tweens because the model
recomputed and the two values are the same value; a chart path draws because the curve is an
output; the hub's pinned section scrubs because scroll position is the model's time axis.
All of it collapses to static under `prefers-reduced-motion`.

## Interaction contract

Shared by every tool:

- No submit button. Inputs recompute on `input`, debounced 90ms.
- State lives in the URL after the `#`, so any result is a shareable link.
- State persists to `localStorage`, restored silently on return.
- <kbd>↑</kbd><kbd>↓</kbd> steps a focused numeric field, <kbd>Shift</kbd> steps by ten.
- <kbd>⌘</kbd><kbd>K</kbd> or <kbd>Ctrl</kbd><kbd>K</kbd> opens the tool switcher.
- Every chart has a hidden `<table>` twin for screen readers.
- Light and dark are both real themes, not inversions of each other. Contrast is audited at
  WCAG AA or better on every text pair in both.

## Running it

No build step, no dependencies to install. It is static files.

```bash
npx serve fintools -l 4399
```

Then open `http://localhost:4399`. Opening `index.html` directly from the filesystem will not
work, because the code is ES modules and browsers block those over `file://`.

## Structure

```
index.html            hub, the only persuade-mode surface
assets/
  css/tokens.css      colour, type, shape, spacing, both themes
  css/ui.css          the component library, shared by all six tools
  css/hub.css         hub-only composition
  js/core.js          formatting, state, URL serialisation, shell
  js/chart.js         SVG chart engine: line, bar, donut, scatter
  js/motion.js        GSAP choreography
  js/hub.js           hub behaviour
compound/  fire/  rebalance/  dividend/  mortgage/  allocation/
                      one index.html + app.js each
```

Each tool's `app.js` opens with its model as a plain function. If a number looks wrong, the
arithmetic is the first thing in the file.

## What these are not

Financial advice. Every model here applies a smooth average to a market that has never once
delivered one. They are built to compare decisions against each other, not to predict a balance
on a date. Where a model is optimistic, the tool says which direction it is wrong in.
