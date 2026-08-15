# Provable Pruning And Convergence

Evaluating every member of a large population exhaustively is usually
impossible: the cheap bulk source carries a few fields, the complete
per-entity source costs a request each. So the pipeline computes a
score bound from the cheap source and only fetches entities whose bound
could still place. That is sound — *if* the bound is provable. It is
the step where a screen most often turns into a sample while still
being described as complete.

## A Bound Is Not A Guess With Margin

The tempting shortcut is to compute the criterion from whatever the
bulk source happens to carry, then relax the threshold by a fixed
margin to absorb the difference. It does not work, because a proxy's
error is a distribution, not a bound. A margin absorbs the typical
case and silently drops the tail — and the tail is exactly where
unusual, interesting candidates live.

A worked example from a real run. A financial screen needed
`operating cash flow / consolidated net profit` and
`net profit / average parent equity`, but the bulk table carried only
*parent-attributable* profit and *period-end total* equity. Both were
used as proxies with a 20% margin. Both are unbounded:

- Consolidated and parent-attributable profit diverge by however much
  the minority interest is. Measured across 2,390 entity-years, the
  99th percentile of relative deviation was 31.7%, and 2.4% of the
  sample exceeded the 20% margin outright.
- Period-end total equity exceeds average parent equity by however
  much the minority stake and the period's equity movement are.

One entity had a 51% minority interest. Its proxied return looked
mediocre, its bound was cut, it was never fetched. Its actual value on
the exact definition was 78.6% — it should have ranked **first**. The
pipeline had been reporting "this is pruning, not sampling" the whole
time.

## What Makes A Bound Provable

Two constructions qualify.

**Identical fields.** If the bulk source and the exact source carry the
same field, a criterion computed only from those fields gives the same
answer in both. Then a `fail` in the cheap pass is a `fail` in the
exact pass, and pruning on it is sound.

Do not assume identity from matching column names. Verify it: join the
two sources over every entity-period already fetched both ways and
assert the maximum relative difference is zero. Record the sample size
and the result — it is the load-bearing claim under the completeness
statement, and it belongs in the report.

**Monotone relations.** Occasionally a proxy is provably one-sided —
a denominator that can only be larger yields a value that can only be
smaller, so a proxy `pass` implies a real `pass`. Useful for *raising*
confidence, but note the direction: a one-sided bound in the wrong
direction cannot justify dropping anything. Deciding a candidate
*cannot qualify* needs a bound on the optimistic side.

Everything else — different scope, different aggregation, a field the
bulk source simply lacks — is unusable for pruning. Mark the criterion
undetermined, give the entity the maximal bound, and fetch it. This
costs requests. It is the price of the completeness claim.

## Score Intervals

Each evaluated candidate carries `[lo, hi]`:

- `lo` — points from criteria *proven* satisfied.
- `hi` — `lo` plus the points from every criterion still `unknown`.
- `na` (structurally inapplicable) adds to neither. It is not a free
  pass and not a penalty; it caps what that candidate can reach, which
  is the honest consequence of a framework that does not fit it.

`lo` ranks. `hi` decides what still needs work.

## The Convergence Test

Scores alone are not the whole ordering. When many candidates share the
top score, placement is decided by the tie-break rule, so a bound on
the *score* is too weak — an unresolved candidate can tie on score and
still lose on the tie-break, or win it.

Build the full sort key under the most favourable assumption for the
unresolved candidate, and compare it against the actual key of the one
currently in last place of the shortlist:

- Unknown criteria contribute their **maximum** possible atom count.
- Unknown tie-break values take the **most favourable** value, not zero
  and not the current value. A missing figure that ranks descending is
  optimistically `+inf`. Defaulting it to zero silently declares the
  candidate a loser and is the same class of error as the proxy margin.

A candidate can be set aside only when its best-case key still loses.
Two counters must both reach zero:

1. Evaluated candidates whose best-case key beats the cutoff.
2. Never-fetched candidates whose coarse bound reaches the cutoff.

Report both. Non-zero on either means provisional, and saying so costs
far less than being caught claiming otherwise.

## Drive The Fetch Threshold From The Result

The fetch cutoff is derived state, not a constant. Hardcoding "fetch
everything whose bound is 100" is only correct while the shortlist's
last place actually scores 100. If it scores 80, every candidate bounded
at 80 belongs in the pool, and the hardcoded run will never notice.

Compute the threshold from the current shortlist each round, re-run
until the two counters are zero, and let the loop — not a constant —
decide when to stop.

## Order Of Operations

1. Gate on intrinsic attributes (identity, membership, hard limits).
   No accounting or interpretation, so no proxy risk.
2. Compute the provable-bound criteria from the bulk source. Prune only
   on a proven `fail`.
3. Fetch the survivors exactly; compute every criterion.
4. Resolve the expensive checks in best-case-key order.
5. Recompute the threshold and repeat from 3 until both counters
   are zero.

Log what each stage dropped and why. A pipeline that reports only
survivors cannot be audited, and the exclusion counts are the part a
reader can actually check.
