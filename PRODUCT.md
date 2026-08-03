# Ledgerline - Product context

## What it is

A financial file that lives in the visitor's own browser, plus six models that
read it. Static site, no backend, no accounts, no telemetry.

The file is the product. The tools are what read it. That order matters: six
calculators with no shared state is a set of one-time visits, and nobody returns
to a calculator. A file accumulates, and the things that accumulate (net worth
history, decisions, an action list derived from real drift) are the only reason
to come back.

**Localisation.** Traditional Chinese is the primary locale, English the
fallback, chosen from `navigator.languages` with a script check so a Simplified
tag is not served Traditional text. Currency is guessed from region and then
owned by the file.

## Who it is for

Self-directed retail investors who currently do this work in a spreadsheet: they understand
compounding, they have opinions about fees, and they have been burned by a "free" tool that
wanted their brokerage login. They are not beginners and they are not institutions.

## Why these six

Chosen for search demand, spreadsheet-replacement value, and non-overlap. Every one is a
question people actually type into a search bar, and every one is currently answered by either
a 1998-era form or a lead-generation funnel.

| Tool | The question | Why the incumbent fails |
|---|---|---|
| **Compound** | "What does regular investing actually become?" | Existing calculators ignore fees and inflation, so the answer is fiction. |
| **FIRE** | "When can I stop?" | Single-point answers hide sequence-of-returns risk entirely. |
| **Rebalance** | "What do I buy to get back to target?" | Every tool says *sell*; nobody models cash-only rebalancing or tax drag. |
| **Dividend** | "What lands in my account, and when?" | Yield is quoted annually; cash flow arrives quarterly and unevenly. |
| **Mortgage** | "What does paying extra actually save?" | Banks show the payment, not the interest curve or the break-even. |
| **Allocation** | "Is this mix better, or just different?" | Risk is described in words like "moderate" instead of numbers. |

## Hard constraints

- **Static hosting.** GitHub Pages. No server, no build step, no npm install to view.
- **No market data feeds.** Anything requiring a live quote is out of scope. Users type their
  own numbers; the tools model the consequences.
- **Not advice.** Every tool ships a plain disclosure. No tool recommends a product.
- **Offline-capable after first load.** Assets are the only network dependency.

## Deliberately excluded

Budgeting and expense tracking (crowded, needs bank connections), tax filing (jurisdictional),
crypto portfolio tracking (needs live feeds), anything with a login.

## Voice

Direct. Numbers first, sentence second. No "unlock", no "supercharge", no exclamation marks.
When a model has a limitation, the tool says so next to the result rather than in a footnote.
