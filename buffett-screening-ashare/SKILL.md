---
name: buffett-screening-ashare
description: >-
  Implements the buffett-screening doctrine for A-shares on the Shanghai
  main board, Shenzhen main board and ChiNext — 筛选A股, a
  Buffett-style quality screen over 沪深主板和创业板, in Chinese
  financial-statement reality (CAS). Hard dependency: load
  buffett-screening first and follow its contract; this skill only
  supplies what differs for A-shares — the CAS accounting adaptations,
  the Eastmoney + cninfo data layers with rate limiting and checkpoint
  resumption, the A-share governance evidence sources, and frozen
  defaults. Do not trigger for HK, US or other markets, and never for
  the excluded boards: STAR market, Beijing Stock Exchange, NEEQ, B
  shares, or ST-marked stocks.
---

# Buffett Screening — A-Share Implementation

This skill is the A-share adapter for `buffett-screening`. The doctrine
skill is normative here: its freeze-before-candidates contract, its four
states, its gate-versus-scored split, its pruning bounds, and its
reporting obligations all apply unchanged. Load it first; this file and
`references/` state only what A-shares change.

## What A-Shares Change

**The accounting is CAS, not US GAAP.** The computable definitions in
the doctrine layer were written against US statements. CAS differs in
the places that decide a screen: the operating-profit line already
contains investment income, fair-value changes and disposal gains;
goodwill is a recurring impairment hazard; and the split between
parent-attributable and minority profit is disclosed outright. Read
[references/cas-conventions.md](references/cas-conventions.md) before
computing anything. Every mapping there names the source field.

**The data layers are Eastmoney plus cninfo.** Eastmoney's datacenter
APIs supply the bulk population, the annual summaries, and the full CAS
statements; cninfo is the designated disclosure platform and supplies
the raw annual reports and the announcement record that the governance
gate runs on. [references/data-sources.md](references/data-sources.md)
carries the verified endpoints, field names, units, and the rate-limit
and resumption rules. The doctrine layer's rule against vendor
pre-computed fields applies with force here: Eastmoney publishes
derived ratios (weighted ROE, margins, YoY growth) next to the raw
fields — use the raw fields only.

**Governance has stronger, cheaper evidence.** A-shares offer
structured signals the US doctrine leaves `unknown`: audit-opinion
type, inquiry letters, regulator investigations, controlling-shareholder
pledging, and the gap between earnings pre-announcements and reported
results. [references/governance.md](references/governance.md) maps each
to a gate and a source. None of them converts `unknown` into `pass` by
itself; they make `fail` or `unknown` better evidenced.

## Scope (Frozen Universe)

- Boards: Shanghai main board, Shenzhen main board, ChiNext. Code
  prefixes 600/601/603/605, 000/001/002/003, 300/301.
- Excluded: STAR market (688), Beijing Stock Exchange, NEEQ, B shares,
  ST-marked stocks. The ST exclusion is a universe cut, not a gate
  verdict — say so in the report, with the excluded count.
- Listed at least five full calendar years before the as-of instant.
- History window: the five most recent complete fiscal years, plus one
  prior year for opening balances. CAS fiscal years are calendar years.
- As-of: one timestamp for the whole run; prices are that day's close,
  CST trading calendar.

## Workflow

The doctrine funnel runs unchanged: accounting-model classification,
competence allow-list, intrinsic-attribute gates, computed criteria,
qualitative gates, price last. What differs is the land-and-derive
stage:

**Freeze.** Start from [references/freeze-template.md](references/freeze-template.md):
every threshold, convention and budget with its provenance label —
*Buffett-stated*, *implied*, or *author's policy*. The template's
values are defaults; changing any of them after candidates are visible
is answer-fitting under the doctrine contract. State the as-of instant
and the data-mapping version.

**Land the raw layers.** Run `fetch-population.mjs`, then
`fetch-statements.mjs` for the population that survives the cheap
gates, `fetch-prices.mjs` for price-gate candidates, and
`fetch-cninfo.mjs` for the annual reports and announcement record of
survivors. Every response is stored raw with URL, fetch time, and
mapping version; the scripts checkpoint per company-period, so a
rate-limited or killed run resumes instead of restarting. Runs land
under `~/.buffett-screening/ashare/<runId>/` by default (`BUFFETT_RUNS_DIR`
overrides the family root) — see data-sources.md. A row count
is not a population count: the bulk table mixes NEEQ and B-share rows
into the same pages, and one company can appear in several market
buckets across its life — deduplicate on code, keep the latest period.

**Derive, never accept.** `derive.mjs` computes the frozen metrics from
the stored raw bodies — adjusted EBIT, RONTOA, ROE, the owner-earnings
proxy, gross debt and coverage — and reports per-field coverage and
null-as-zero counts beside the output, so the frozen null semantics in
cas-conventions.md stay auditable. Three A-share-specific traps, all
observed in the verification pass:

- The summary statements (`RPT_DMSK_FN_*`) lack goodwill, parent
  equity, long-term borrowings and the cash-flow add-back detail — the
  full statements (`RPT_F10_FINANCE_G*`) carry them. Mismatching the
  two produces precise-looking wrong numbers.
- Eastmoney lists derived ratios beside raw fields under similar
  names. A gate fed `WEIGHTAVG_ROE` is vendor policy, not yours.
- Quarterly rows share the table with annual rows; filter on the
  annual report-type field, never on row order.

**Run the funnel to convergence or budget.** Same loop as the doctrine
layer, same honest terminator: on this doctrine an unresolved moat
causal half normally leaves the run provisional. The budget here is
request-count and wall-clock, because rate limiting is part of the
environment — see data-sources.md.

## A-Share Failure Modes

| Symptom | Control |
|---|---|
| NEEQ or B-share rows polluting the population | Filter on market code, then on code prefix; count and report what the filter dropped |
| ST names sneaking through | Universe excludes the risk-warning board market codes outright; ST is not evaluated, not failed |
| Quarterly rows averaged into an annual window | Select rows by the annual report-type field; verify one row per company-period |
| Vendor ROE or margins used as gates | Raw fields only; every derived field is computed in-repo from stored bodies |
| 营业利润 used as operating profit | CAS 营业利润 contains investment income, fair-value changes, disposal gains — use the adjusted EBIT in cas-conventions.md |
| Goodwill ignored in tangible capital | A-share goodwill is a recurring impairment hazard; deduct it and score its size |
| 借壳 or major restructuring treated as continuity | History window restarts at the completion year; insufficient window is `unknown` |
| Pre-announcement-to-actual gap ignored | It is the strongest A-share management-honesty signal; governance.md defines it |
| 停牌 gaps read as flat prices | Missing trading days are `unknown`, never zero; price-gate timestamp policy is frozen |
| 万元 vs 元 units mixed | Every stored body records its unit; mapping version covers it |
| Realtime-quote dependency | The quote feed is unreliable from automation; history endpoints are the frozen price source |

## Reporting

Everything the doctrine layer owes, plus the A-share scope counts:
population by board, ST/risk-warning excluded count, listing-age
exclusions, and the audit-opinion distribution on survivors. State the
data-mapping version, the as-of instant, and the price source beside
every figure. And say what the result is not: a screen under a stated
rule set over a stated universe, not a recommendation, not Buffett's
opinion, and — where the moat and management gates remain `unknown` —
a list of companies worth reading about.
