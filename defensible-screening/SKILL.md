---
name: defensible-screening
description: >-
  Use when a task asks you to apply a stated rule set to a large
  population and return the best N — stock screens, vendor shortlists,
  candidate ranking, dependency audits, log triage, paper selection.
  These tasks fail in a specific way: the model picks a few familiar
  answers first and then fits the metrics around them, producing a
  result that reads as rigorous and is fabricated. This skill supplies
  the contract that makes the output defensible: criteria frozen before
  the candidates are visible, verdicts where missing data blocks a
  candidate at a hard gate instead of quietly passing it, pruning that rests
  on a provable bound rather than a plausible approximation, an
  explicit convergence test, and per-number provenance. Do not trigger
  for one-off lookups, for ranking a handful of items the user already
  named, or when the user wants a quick opinion rather than a result
  they could be asked to defend.
---

# Defensible Screening

Screening tasks are easy to fake and hard to falsify. A ranked table
with computed-looking numbers reads as rigorous whether or not the
pipeline behind it exists. Three failures dominate, and none of them
announce themselves in the output:

- **Answer-first.** Recall a few well-known members of the population,
  then find metrics that flatter them. The scoring is real; the
  selection was not.
- **Silent admission.** Missing data becomes zero, or "not found"
  becomes "not present", and a candidate passes a gate it never met.
- **Unprovable pruning.** The population is too large to evaluate
  exhaustively, so most of it is dropped by an approximation that was
  never shown to be an upper bound.

The contract below exists to make each of those detectable.

## The Contract

1. **Freeze the criteria before the candidates are visible.**
   Thresholds, period definitions, unit conventions, and the
   tie-break order all go into a constants module first. Adjusting any
   of them after seeing the shortlist is answer-fitting, whatever the
   justification.
2. **Four states, not two.** Every check yields `pass` / `fail` /
   `unknown` / `na`. `unknown` is never scored as 0 and never as full
   marks — it widens the candidate's `[lo, hi]` score interval. `na`
   means the check cannot exist for this candidate; it scores nothing
   and claims nothing.
3. **`unknown` blocks admission the way `fail` does — at hard gates.**
   Separate the two kinds of check first: a *hard gate* decides
   admission, a *scored criterion* only contributes points. At a hard
   gate a candidate is admitted only on `pass`; `fail` means checked
   and unqualified, `unknown` means not checked, `na` means not proven
   either way, and none of the three is a reason to include. A scored
   criterion never disqualifies — its `fail` simply earns zero. Wiring
   these two together in one rule is the most common way to get either
   a shortlist that discards anyone who loses a single point, or one
   that walks candidates through gates they never satisfied. See
   [references/verification.md](references/verification.md).
4. **Prune only on a provable bound.** See
   [references/pruning.md](references/pruning.md). If a cheap proxy
   might disagree with the exact computation by an unbounded amount,
   it cannot decide what gets dropped.
5. **Every number traces to a source.** Persist raw responses; a
   reported figure that cannot be walked back to a stored record is an
   assertion, not a finding.

## Workflow

**Freeze.** Write the constants module and the tie-break order.
State the as-of instant, the period boundaries, and — where two
conventions exist for the same word — which one applies. Mixed
conventions are a common silent error: a ratio whose numerator and
denominator come from different scopes is wrong even when both inputs
are correct.

**Land the raw layer.** Fetch into local storage, storing the response
body alongside the fetch time, URL, page, and row count. Derive
structured tables from that, never straight from the wire. A summary
endpoint's row count is not a population count — it can hold multiple
periods, restatements, and revisions of the same record, so deduplicate
on the full key before aggregating.

**Fan out through the funnel.** Apply the gates that rest on intrinsic
attributes first (they involve no ambiguity), then the ones needing
computation. Record the *first* gate each candidate trips, so the
exclusion counts are mutually exclusive and can be summed.

**Iterate to convergence.** Compute `[lo, hi]` for everything
evaluated, resolve expensive checks in upper-bound order, and stop only
when the test in [references/pruning.md](references/pruning.md) passes.
No cutoff exists until N candidates are *guaranteed* admissible — until
then nothing may be dropped on placement. Once it does, two counters
must reach zero: unresolved challengers outside that guaranteed set
whose best case still reaches the cutoff, and never-fetched candidates
whose coarse bound still reaches it. Non-zero means the list is
provisional, and it must be reported as provisional.

**Verify what the data cannot decide.** Some gates have no structured
source. Handle them per
[references/verification.md](references/verification.md): scope the
check to candidates that could still place, keep keyword hits as
material for human adjudication rather than automatic disqualification,
and word a negative result as *not detected in the named sources*.

**Report the exclusions before the winners.** Lead with the population
size and the mutually-exclusive exclusion counts, then the shortlist,
then the unresolved items. A reader cannot judge a top-five without
knowing what the other candidates died of.

## Failure Modes

| Symptom | Control |
|---|---|
| Familiar names appear, then metrics justify them | Publish population size, per-gate exclusion counts, and per-candidate computation before naming anyone |
| A cheap proxy decides what to drop | Prune only on fields proven identical to the exact ones; verify the claim, do not assume it |
| Missing value silently becomes 0 or full marks | Four-state verdicts; at a hard gate only `pass` admits |
| "Searched and found nothing" written as "does not exist" | Word it as not detected in the named sources, and list them |
| A structural impossibility recorded as missing data | Distinguish `na` from `unknown`; `na` scores nothing and claims nothing |
| Current low value presented as a low historical percentile | Persist the historical series and the percentile formula; check for look-ahead bias |
| Aggregate table summed without deduplication | Deduplicate on entity + period + revision; keep the latest restatement |
| Ties presented as a ranking | State how many share the top score and that the order comes from the tie-break rule |
| Exclusion counts that overlap | Count the first gate tripped; put multi-trip labels in an appendix |
| Retry overwrites previously fetched columns with nulls | Merge per column, or replace only after a complete fetch |

## Reporting

The output owes the reader four things beyond the ranked table: the
funnel with mutually-exclusive counts; which criteria were computed
exactly, which used a documented proxy, and which were not covered at
all; whether the list converged or is provisional, with the count still
unresolved; and what the result is not — a screen under a stated rule
set is not a recommendation, and candidates sharing the top score are
not meaningfully ordered by the tie-break.

Say plainly when a criterion could not be evaluated. A framework that
does not fit part of the population (a margin test against businesses
with no cost-of-sales line) should mark those candidates `na` and say
so, rather than either dropping them from the population without
license or pretending the metric computed.
