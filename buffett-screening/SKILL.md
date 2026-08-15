---
name: buffett-screening
description: >-
  Use when a task asks you to screen a population of companies against
  Warren Buffett's investment criteria — "find me Buffett-style stocks",
  a quality-compounder shortlist, a moat-and-management filter over an
  index or a market. These tasks fail in a specific way: the model
  recalls a few famous Berkshire holdings, writes a paragraph about
  their moat, attaches ratios that sound like Buffett's rules, and
  cites shareholder letters that state no such rules. This skill
  supplies the doctrine with its primary sources, separates what
  Buffett actually said from the threshold table popular screeners
  invented, and carries the contract that makes the output auditable:
  criteria frozen before the candidates are visible, missing evidence
  blocking a hard gate instead of quietly passing it, pruning that
  rests on a provable bound, and per-number provenance. Do not trigger
  for valuing one company the user already named, for a general
  investment opinion, or when the user wants a quick take rather than
  a result they could be asked to defend.
---

# Buffett Screening

Two things make this domain unusually easy to fake. The criteria are
famous, so a plausible checklist is available without reading a single
letter. And the load-bearing half of the doctrine — circle of
competence, the durability of a moat, the honesty of management — has no
queryable dataset, so a model asked to judge it always produces a
paragraph, and the paragraph always passes.

The result looks like Buffett and is a fabrication: invented thresholds
attributed to letters that never state them, whole-company acquisition
rules applied to a stock screen, moats declared from a brand name.

Read [references/doctrine.md](references/doctrine.md) before writing
any criterion down. It carries the primary-source canon, which vintage
to encode, and the provenance of every number.

**When the references do not answer the question, go to the letters.**
`sources/` holds every shareholder letter from 1977 on, the Owner's
Manual and the acquisition criteria as plain text, because these files
are a condensation and drop most of the reasoning. Search there before
answering from memory, and *always* before attributing a rule or a
number to Buffett: recalling a quotation is not evidence for it, and a
fabricated citation reads exactly like a real one.
[sources/README.md](sources/README.md) gives the search patterns and
why a miss is weak evidence.

## The Doctrine

> An understandable and sufficiently predictable business, with durable
> favorable economics, run by capable and trustworthy managers,
> conservatively financed, bought at a price materially below a
> conservatively estimated intrinsic value.

The five clauses are conjunctive. Buffett's formulations use *and*: a
cheap price does not compensate for dishonesty, and a high return on
equity does not compensate for a business nobody can explain. That is
why most of these are gates rather than points.

Encode the late doctrine — quality at a sensible price, roughly 1989
onward, with the 1977 four-part formulation as its invariant core. Do
not encode early cigar-butt Buffett, Berkshire's own acquisition-size
constraints, or a blanket rule against technology.

**Buffett published no threshold table.** No ROE floor, no
debt-to-equity ceiling, no P/E limit, no fixed margin of safety. Every
number in the implementation is the screen author's policy and must be
labelled as such. See doctrine.md for the ones commonly misattributed
to him — including the 15% that belongs to Berkshire's own
intrinsic-value growth objective and has nothing to do with an
investee's return on equity.

## The Contract

1. **Freeze the criteria before the candidates are visible.**
   Everything the run depends on goes into a constants module first,
   each entry marked *Buffett-stated*, *implied*, or *author's policy*.
   Adjusting any of them after seeing the shortlist is answer-fitting,
   whatever the justification.
2. **Four states, not two.** Every check yields `pass` / `fail` /
   `unknown` / `na`. `unknown` is never scored as 0 and never as full
   marks — it widens the candidate's `[lo, hi]` score interval. `na`
   means the check cannot exist for this candidate; it scores nothing
   and claims nothing.
3. **`unknown` blocks admission the way `fail` does — at hard gates.**
   A hard gate decides admission and carries no points; a scored
   criterion contributes points and never disqualifies. At a hard gate
   only `pass` admits. See
   [references/criteria.md](references/criteria.md) for which is which.
4. **Prune only on a provable bound.** See
   [references/pruning.md](references/pruning.md). A cheap valuation
   proxy is not a bound on intrinsic value, and a bulk-table ratio is
   not a bound on the exact one.
5. **Every number traces to a source, every doctrine claim to a
   letter.** Persist raw filings; a reported figure that cannot be
   walked back to a stored record is an assertion. A criterion
   presented as Buffett's must name the letter or report it comes
   from, and one that cannot is the author's policy.

## Three Rules That Decide Whether This Works

These are where an LLM implementation of this particular screen breaks.
[references/adjudication.md](references/adjudication.md) develops them.

**Circle of competence is the user's property, not the candidate's.**
Do not ask the model whether it understands a business — it will always
say yes, in fluent detail. Have the user declare the boundary during
the freeze, as an industry or business-model allow-list, and run it as
an intrinsic-attribute gate near the front of the funnel — after the
accounting-model classification, so that scope coverage stays
measurable. A self-assessed competence gate passes everything and is
worse than no gate.

**The moat gate makes this a referral list, not a buy list.** Its
outcome half — returns on tangible operating capital over a decade — is
computable. Its causal half — the specific barrier, and why customers
cannot substitute — has no structured source, so it stays `unknown` and
blocks. The honest output is a ranked set of candidates each carrying an
unresolved moat gate, for human adjudication. A screen that resolves the
causal half by itself has fabricated it.

**Price is evaluated last, and never prunes.** Intrinsic value is a
model output, not a data field, so the price gate cannot run over a large
population. Put it at the end of the funnel. Until then price is
`unknown`: it neither ranks nor drops anyone. Pre-filtering on P/E or P/B
is exactly the unprovable pruning the contract forbids — those ratios
bound intrinsic value by nothing.

## Workflow

**Freeze.** Write the constants module: the competence allow-list, the
fiscal-year window, the accounting-model classification rule, every
threshold with its provenance label, the tie-break order, the shortlist
size `N`, and the work budget that bounds qualitative adjudication and
valuation. State the as-of instant.
Where two conventions exist for one word, say which applies —
consolidated versus parent-attributable profit, average versus
period-end capital, gross versus net debt. A ratio whose numerator and
denominator come from different scopes is wrong even when both inputs
are correct.

**Land the raw layer.** Fetch filings into local storage, keeping the
response body alongside fetch time, URL, and the field-mapping version.
Derive structured tables from that, never straight from the wire. The
mapping is where precise-looking wrong numbers are born; read
[references/criteria.md](references/criteria.md) § Reading The Source
Data before trusting a computed ratio.
Deduplicate on entity, period and revision, keeping the latest
restatement; a row count is not a population count.

**Fan out through the funnel.** Accounting-model classification first,
then the competence allow-list, then the remaining intrinsic-attribute
gates, then the computed ones, then the qualitative ones, then price.

Blocking is not excluding. `fail` and `na` are **terminal** — record the
first gate tripped, stop work, count it. `unknown` is **pending**: it
blocks admission, but the candidate stays in the population and in the
referral list with that gate named. Counting them together either buries
live candidates in the exclusion table or reports as converged a run
that resolved nothing. Out-of-scope counts are population-wide; see
[references/applicability.md](references/applicability.md).

**Iterate to convergence, or to the budget.** Compute `[lo, hi]`,
resolve expensive checks in upper-bound order, and stop when the test in
[references/pruning.md](references/pruning.md) passes — or when the
frozen work budget runs out, whichever comes first. On this doctrine the
budget is the usual terminator, because an unresolved moat gate means no
candidate is guaranteed admissible and the convergence test cannot pass.
That result is **provisional** and says so. pruning.md defines both
paths.

**Report the exclusions before the winners.** Lead with the population
size and the mutually-exclusive exclusion counts, then the shortlist,
then what remains unresolved on each survivor.

## Failure Modes

| Symptom | Control |
|---|---|
| A threshold table presented as Buffett's criteria | Every number labelled Buffett-stated, implied, or author's policy; doctrine.md names the misattributed ones |
| Berkshire's acquisition criteria used to screen stocks | Those clauses are whole-company constraints; the document excludes stock selection outright |
| Famous Berkshire holdings appear, then metrics justify them | Publish population size and per-gate exclusion counts before naming anyone |
| A moat declared from a brand, a margin, or market share | Name the causal barrier; a high ratio without a mechanism is `unknown`, and `unknown` blocks |
| Management judged honest because nothing turned up | Word it as not detected in the named sources; absence never admits |
| `CFO − capex` reported as owner earnings | Call it the owner-earnings proxy and state that maintenance capex is undisclosed |
| Depreciation substituted for maintenance capex | Mark `unknown` unless asset age, capacity and replacement projects were reconciled |
| Every non-cash charge added back | Recurring stock compensation and real impairments are costs; state the add-back policy in the freeze |
| ROE inflated by buybacks, leverage or a negative equity base | Report return on tangible operating capital alongside; `na` on non-positive average equity |
| Bank or insurer measured with an industrial leverage rule | Only the ordinary non-financial model exists; classify first, mark `na`, and report the excluded count population-wide |
| Price gate applied late, but incumbents declared "guaranteed" before it | Price is a hard gate; no cutoff exists until N candidates have cleared it too |
| A distribution added to value created *and* deducted from capital retained | Counts it twice; the one-dollar numerator excludes both dividends and repurchases, or the same policy scores differently depending on how cash was returned |
| Net-income-based owner earnings discounted, then debt subtracted | Charges financing twice; build the valuation input from NOPAT |
| Cyclical peak normalized as earning power | Fix the normalization rule in the freeze; excluding weak years as one-offs after seeing them is answer-fitting |
| A DCF with invented growth and discount assumptions | Freeze horizon, terminal growth and required return; report low/base/high, not a point estimate |
| P/E or P/B used to shrink the population | Price never prunes; it runs last over survivors |
| Ties presented as a ranking | State how many share the top score and that the order comes from the tie-break rule |
| A ratio flips sign because two filers disagree on a convention | Check each operand's sign domain; take magnitudes where the criterion means one |
| A discontinued tag's last value silently pairs with current data | Require the series to reach the compared period; stale is `unknown`, not a number |

## Reporting

The output owes the reader six things beyond the ranked table: the
scope counts, population-wide, naming what the accounting model could
not read and stating that those companies were *not evaluated* rather
than rejected; the funnel with mutually-exclusive counts; which criteria were computed
exactly, which used a documented proxy, and which were not covered;
which gates remain `unknown` on each survivor — the moat causal half
normally among them; whether the list converged or is provisional; and
the provenance split, so a reader can see which rules came from
Buffett and which the author chose.

Say plainly what the result is not. It is a screen under a stated rule
set, not a recommendation and not Buffett's opinion. Candidates sharing
the top score are not meaningfully ordered by the tie-break. And a
shortlist whose moat and management gates are unresolved is a list of
companies worth reading about, which is the most an automated pass over
this doctrine can honestly deliver.
