---
name: buffett-screening-us
description: >-
  Implements the buffett-screening doctrine for US-listed companies —
  a Buffett-style quality screen over the S&P 500 or another US
  universe, run on SEC EDGAR XBRL filings with Yahoo chart prices.
  Hard dependency: load buffett-screening first and follow its
  contract; this skill only supplies what differs for US filers — the
  EDGAR data layers with rate limiting and checkpoint resumption, the
  US GAAP XBRL concept mapping with its fallback chains and null
  semantics, the accounting-model classification rule, the US
  governance evidence sources, and frozen defaults. Do not trigger for
  A-shares, HK or other markets; for IFRS-only foreign private issuers
  the screen returns `unknown`, never a best-effort mapping.
---

# Buffett Screening — US Implementation

This skill is the US adapter for `buffett-screening`. The doctrine
skill is normative here: its freeze-before-candidates contract, its four
states, its gate-versus-scored split, its pruning bounds, and its
reporting obligations all apply unchanged. Load it first; this file and
`references/` state only what US filers change.

## What US Filers Change

**The raw layer is SEC EDGAR XBRL.** The doctrine layer's rule against
vendor pre-computed fields applies with force and is easy to honor here:
companyfacts is the as-filed fact layer, and every derived figure is
computed in-repo from the stored raw bodies. The trap is the mapping,
not the vendor — [references/us-gaap-conventions.md](references/us-gaap-conventions.md)
carries the concept table with named fallback chains, the instant-vs-
duration fact distinction, and the null semantics (value / absent-or-
stale = 0 / tagged-but-missing = `unknown`). Read it before trusting a
computed ratio; every rule in it was forced by a real filer.

**The universe defaults to the S&P 500, but the data layer is
universe-agnostic.** [references/data-sources.md](references/data-sources.md)
carries the verified endpoints — the SEC ticker map, the constituent
list, submissions + companyfacts, the 10-K locator, and the Yahoo chart
price source — with rate limits, checkpoint resumption, and the CIK
re-registration and stub-period quirks. stooq is dead for automation
(JavaScript proof-of-work wall, observed 2026-08); do not add it back.

**Governance evidence is thinner than A-shares but not absent.**
[references/governance.md](references/governance.md) fixes what the
default run leaves `unknown` (moat causal half, management gate), which
US sources exist when a run does adjudicate, and the maintenance-capex
adjudication task that feeds the valuation within the frozen budget.

## Scope (Frozen Universe)

- Default universe: S&P 500 constituents at the as-of instant, joined
  to SEC CIKs; dual-class pairs deduplicated on CIK. Any other US
  ticker list works — the pipeline reads a population file, not an
  index.
- Accounting model: only `ordinary_nonfinancial` is evaluated. Banks,
  deposit-takers, insurers, regulated utilities, brokers, REITs,
  captive-finance conglomerates and non-recourse structures are **not
  evaluated** — out of scope, counted population-wide, never failed.
  Classification rule in [references/freeze-template.md](references/freeze-template.md).
- History window: the 10 most recent completed fiscal years plus one
  prior year for opening balances. IFRS-only 20-F filers and
  post-spinoff stub periods are classification `unknown` — honest, not
  approximated.
- As-of: one timestamp for the whole run; prices are the last close on
  or before it.

## Workflow

The doctrine funnel runs unchanged: accounting-model classification,
competence allow-list, intrinsic-attribute gates, computed criteria,
qualitative gates, price last. What differs is the land-and-derive
stage:

**Freeze.** Start from [references/freeze-template.md](references/freeze-template.md):
every threshold, convention and budget with its provenance label —
*Buffett-stated*, *implied*, or *author's policy*. Declare the price
gate's margin formula deliberately — in the verification run a 50% cap
failed every valued candidate, and the cap was the binding choice, not
the valuation. Copy the template into the run directory and hash it
before any candidate data is fetched.

**Land the raw layers.** Run `fetch-population.mjs`, then
`fetch-facts.mjs` for the population, `fetch-prices.mjs` for pending
candidates, and `fetch-10k-list.mjs` to locate the latest 10-K for the
valuation set. Every response is stored raw with URL, fetch time, and
mapping version; the scripts checkpoint per key, so a rate-limited or
killed run resumes instead of restarting. Completeness is judged per
required field, not per row.

**Derive, never accept.** `derive.mjs` implements the concept table in
us-gaap-conventions.md — fallback chains, instant facts, stale-series
skip, the absent-tag policy, the gross-debt and NTOA composites, and
the OEP definition — and reports per-filer `absent_components` and
`stale_flags` beside the output, so the null semantics stay auditable.
`classify.mjs` fixes the accounting model. `screen.mjs` runs gates 3–5
and scored criteria S1–S7; `score-s7.mjs` folds in the one-dollar test
once prices exist.

**Value last, over the pending set.** `value.mjs` values the top of the
pending set in `lo` order within the frozen budget, using the
maintenance-capex guesses produced per governance.md; `finalize.mjs`
folds the price verdicts back and emits funnel, scope, coverage and
ranking; `report-data.mjs` extracts every number the report quotes, so
the report contains no hand-typed figure.

**Run the funnel to convergence or budget.** Same loop as the doctrine
layer, same honest terminator: on this doctrine an unresolved moat
causal half normally leaves the run provisional. The budget here is
request-count and wall-clock, because rate limiting is part of the
environment.

## US Failure Modes

| Symptom | Control |
|---|---|
| Balance-sheet facts filtered as flows | Instant facts (no `start`) are period-end values — us-gaap-conventions.md fact selection |
| A ratio flips sign because two filers disagree on convention | Magnitudes where the criterion means a magnitude; sign domain checked per operand |
| Tag migrated or discontinued → decade-old value paired with today | Stale-series skip (2y) with a flag; a stale series is not a number |
| Absent tag treated as zero when it is really missing | Three-way null semantics: absent = 0, tagged-but-missing = `unknown`, value = fact |
| Pre-ASC842 operating leases counted as missing | Regime rule: on-balance-sheet lease components are 0 before 2019 — the regime put them off-balance-sheet |
| E&P capex invisible (oil-and-gas tags) → OEP = CFO | O&G capex composite; untagged core capex → OEP `unknown` |
| CIK re-registration (Exxon) empties the history | ALT_CIKS merge of the old CIK's series |
| Dual-class pairs counted twice | Deduplicate on CIK; one fetch, two display tickers |
| IFRS 20-F facts mapped by best effort | us-gaap only; IFRS-only filers are `unknown`, not evaluated |
| Captive finance folded into industrial ratios | FinancingReceivableAllowance marker; under-detection disclosed (GM/F/DE vs CAT) |
| Realtime quote feed as the price source | Yahoo chart history endpoint only; no trade → `unknown` |
| Margin-of-safety cap decided by accident | Declared in the freeze; the verification run's 50% cap failed everyone — that is a finding, not a bug fix |
| A point-estimate valuation with decimals | low/base/high only; the low case decides the gate |

## Reporting

Everything the doctrine layer owes, plus the US scope counts:
population by accounting model (what the model could not read, named
**not evaluated**), the classification rule version and its residual
under-detection, per-criterion coverage percentages (a criterion that
resolves for 3% of the population must say so — the one-dollar test
did), the valuation inputs per valued candidate with each
maintenance-capex guess quoted to its filing, and the price-gate
outcome stated as the frozen formula's product. State the data-mapping
version, the as-of instant, and the price source beside every figure.
And say what the result is not: a screen under a stated rule set over a
stated universe, not a recommendation, not Buffett's opinion, and —
where the moat and management gates remain `unknown` — a list of
companies worth reading about.
