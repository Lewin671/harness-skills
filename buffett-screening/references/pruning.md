# Provable Pruning And Convergence

Evaluating every listed company exhaustively is usually impossible: the
cheap bulk source carries a few fields, the complete per-company
filings cost a request each. So the pipeline computes a score bound
from the cheap source and only fetches companies whose bound could
still place. That is sound — *if* the bound is provable. It is the step
where a screen most often turns into a sample while still being
described as complete.

## A Bound Is Not A Guess With Margin

The tempting shortcut is to compute the criterion from whatever the
bulk source happens to carry, then relax the threshold by a fixed
margin to absorb the difference. It does not work, because a proxy's
error is a distribution, not a bound. A margin absorbs the typical case
and silently drops the tail — and the tail is exactly where the
unusual, interesting companies live.

A worked example. The figures below come from a run whose artifacts are
not published with this skill, so treat them as an illustration of the
failure mode rather than as evidence you can audit — this file demands
provenance for reported numbers, and these do not have it here. The
mechanism is what matters, and it reproduces on any screen with the same
shape. A screen needed
`operating cash flow / consolidated net profit` and
`net profit / average parent equity`, but the bulk table carried only
*parent-attributable* profit and *period-end total* equity. Both were
used as proxies with a 20% margin. Both are unbounded:

- Consolidated and parent-attributable profit diverge by however much
  the minority interest is. Measured across 2,390 company-years, the
  99th percentile of relative deviation was 31.7%, and 2.4% of the
  sample exceeded the 20% margin outright.
- Period-end total equity and average parent equity differ by the
  minority stake and the period's equity movement combined — and not
  even in a guaranteed direction: a large enough decline in parent
  equity can put the period-end total below the average. Unbounded in
  magnitude *and* unsigned, which is the point of the example.

One company had a 51% minority interest. Its proxied return looked
mediocre, its bound was cut, it was never fetched. Its actual value on
the exact definition was 78.6% — it should have ranked **first**. The
pipeline had been reporting "this is pruning, not sampling" the whole
time.

## Two Bounds This Domain Will Tempt You Into

**Price multiples do not bound intrinsic value.** P/E, P/B, EV/EBITDA
and earnings yield relate to intrinsic value through the growth path,
the reinvestment requirement, the capital structure and the required
return — every one of them unobserved in the bulk source. A company
trading at 40 times earnings can sit below a conservative intrinsic
value and one at 8 times can sit far above it. Pre-filtering the
population on a multiple is not pruning; it is replacing the doctrine
with the cigar-butt vintage it repudiated. Price runs last, over
survivors, and drops nobody before then.

**The owner-earnings proxy does not bound literal owner earnings.**
`CFO − total capex` differs from Buffett's definition by growth capex
and by the maintenance working-capital term, in a direction that
depends on how fast the company is expanding. A high-reinvestment
compounder — the exact profile the doctrine is hunting — shows the
worst proxy value in the population. Pruning on it selects against the
thing being screened for.

## What Makes A Bound Provable

Two constructions qualify.

**Identical fields.** If the bulk source and the exact source carry the
same field, a criterion computed only from those fields gives the same
answer in both. Then a `fail` in the cheap pass is a `fail` in the
exact pass, and pruning on it is sound.

Do not assume identity from matching column names — and do not accept
an empirical join as proof either. Joining the two sources over every
company-period fetched both ways and asserting zero maximum relative
difference is *validation*, not a guarantee: the overlap is exactly the
part you did fetch, and a scope- or template-specific divergence can
live entirely in the tail you did not. Financial-sector filings are the
usual place this breaks, because they use a different statement
template and the bulk table maps them by best effort.

Require a population-wide invariant as well, and state which one: a
documented shared definition (both sources specify the same field, the
same scope, the same aggregation), a common canonical origin (one
derived from the other, or both from the same filing), or a structural
argument covering every sub-population — including the ones served by a
different statement template.

Then run the join as a check on that claim. Record the invariant, the
sample size, and the observed maximum difference; all three belong in
the report, because together they are the load-bearing support under
the completeness statement.

**Monotone relations.** Occasionally a proxy is provably one-sided.
"One-sided" is a claim about three things at once, and stating fewer
than three gets the direction wrong:

1. **The operand sign domain.** A larger denominator lowers `n/d` only
   while `n >= 0`. With a negative numerator a larger denominator moves
   the ratio *up*, toward zero. Loss-making years and negative equity
   are common in any wide screen, so establish that the operands cannot
   change sign — or exclude the sign-crossing companies from the
   argument and handle them exactly.
2. **The comparator.** A proxy that can only understate proves a `pass`
   for a minimum threshold (`ratio >= T`) and proves nothing for a
   maximum threshold (`ratio <= T`), where it is the overstating proxy
   that proves the `pass`.
3. **Which side you need.** Deciding that a company *cannot qualify*
   requires a bound on the optimistic side. A one-sided bound in the
   pessimistic direction raises confidence in a `pass` and justifies
   dropping nothing.

Get any of the three wrong and the construction will mark a hard gate
proven while the exact value fails — the silent admission the whole
contract exists to prevent.

Everything else — different scope, different aggregation, a field the
bulk source simply lacks — is unusable for pruning. Mark the criterion
undetermined, give the company the maximal bound, and fetch it. This
costs requests. It is the price of the completeness claim.

## Score Intervals

Each evaluated candidate carries `[lo, hi]`:

- `lo` — points from criteria *proven* satisfied.
- `hi` — `lo` plus the points from every criterion still `unknown`.
- `na` adds to neither. It is not a free pass and not a penalty; it
  caps what that candidate can reach, which is the honest consequence
  of a framework that does not fit it.

`lo` ranks. `hi` decides what still needs work.

## The Convergence Test

Scores alone are not the whole ordering. When many candidates share the
top score, placement is decided by the tie-break rule, so a bound on
the *score* is too weak — an unresolved candidate can tie on score and
still lose on the tie-break, or win it.

**First, there has to be a cutoff.** It is the key of the candidate
holding *N*-th place, and it only exists once N candidates are
**guaranteed admissible** — every hard gate proven `pass`, every scored
criterion settled, so their keys cannot move. With N=5 and only two
such candidates, second place is not a fifth-place bound; comparing
challengers against it prunes exactly the candidates that belong in
slots three through five. A provisional incumbent is no better: if it
later fails a gate it leaves the shortlist, and every pruning decision
taken against its key was invalid. Until N guaranteed incumbents exist,
**nothing may be dropped on placement** — resolve candidates in
best-case-key order and let the set fill.

In this domain, be honest about what "guaranteed" costs. If the moat
gate legitimately stays `unknown` on every candidate, then no candidate
is guaranteed admissible, no cutoff exists, and nothing may be pruned
on placement at all. The screen then converges only over the computable
gates, and the report must say that the ranking is over the computable
evidence with the qualitative gates outstanding. Declaring convergence
by quietly treating an unresolved moat gate as a pass is the same
silent admission in its most consequential form.

**Then compare best case against it.** Build the challenger's full sort
key under the most favourable assumption available to it:

- Unknown criteria contribute their **maximum** possible points.
- Unknown tie-break values take the **most favourable** value, not zero
  and not the current value. A missing figure that ranks descending is
  optimistically `+inf`. Defaulting it to zero silently declares the
  candidate a loser and is the same class of error as the proxy margin.

A challenger can be set aside only when this best-case key still loses
to the cutoff. "Loses" needs care: if the sort key ends in a unique
discriminator, the keys form a total order and strict comparison is
exact. Without one, keys can tie, and a challenger tying the cutoff can
still take *N*-th place — so compare with *reaches or ties*, not
*strictly beats*. Prefer the unique discriminator; it makes the test
decidable.

Two counters must both reach zero:

1. **Unresolved challengers** — candidates outside the guaranteed
   incumbent set whose best-case key reaches the cutoff. Scope this to
   challengers deliberately: counting all evaluated candidates includes
   the incumbents themselves, whose keys beat the cutoff by
   construction, and the counter can then never reach zero.
2. **Never-fetched candidates** whose coarse bound reaches the cutoff.

Report both. Non-zero on either means provisional, and saying so costs
far less than being caught claiming otherwise.

## Drive The Fetch Threshold From The Result

The fetch cutoff is derived state, not a constant. Hardcoding "fetch
everything whose bound is 100" is only correct while the shortlist's
last place actually scores 100. If it scores 80, every candidate bounded
at 80 belongs in the pool, and the hardcoded run will never notice.

Compute the threshold from the current *guaranteed* shortlist each
round — treating "no cutoff yet" as "fetch everything" — re-run until
both counters are zero, and let the loop, not a constant, decide when
to stop.

## Order Of Operations

1. Classify the accounting model, then the competence allow-list and
   the other intrinsic-attribute gates. No accounting, no
   interpretation, no proxy risk.
2. Compute the provable-bound criteria from the bulk source. Prune only
   on a proven `fail`.
3. Fetch the survivors' filings; compute every criterion exactly.
4. Resolve the qualitative gates in best-case-key order.
5. Value the candidates that have cleared every other gate, and apply
   the price gate. **Only here can a candidate become guaranteed
   admissible**, because price is itself a hard gate: a candidate whose
   price gate is unresolved has not passed every hard gate, so it
   cannot be one of the N incumbents that establish the cutoff. A
   cutoff built before this step rests on provisional incumbents —
   exactly the error this file warns about — and every pruning decision
   taken against it is invalid. Until step 5 has produced N guaranteed
   incumbents, nothing may be dropped on placement.
6. Recompute the threshold and repeat from 3 until both counters are
   zero.

That ordering has a cost worth stating rather than hiding: valuation is
the most expensive step and it cannot be used to narrow the field,
because no cheap multiple bounds intrinsic value. The pool arriving at
step 5 is therefore limited only by the quality gates. When it is too
large to value, the honest responses are to tighten a threshold *in the
freeze* and rerun, or to report the run as converged over the quality
gates with price left unresolved. Pre-filtering on a multiple to make
the arithmetic fit is the one response that is not available.

Log what each stage dropped and why. A pipeline that reports only
survivors cannot be audited, and the exclusion counts are the part a
reader can actually check.
