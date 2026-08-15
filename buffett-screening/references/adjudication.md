# Judging What The Data Cannot Decide

Three of Buffett's criteria carry most of the doctrine's weight and
none of them has a queryable source: whether the business is
understandable, whether the moat is durable, and whether management is
honest and capable. This is where a screen either stays honest or
becomes fluent fiction, because a language model asked to judge any of
the three can always produce a confident, well-written verdict, and the
verdict costs nothing to generate.

The rule that governs all three: **evidence that cannot be produced
leaves the gate `unknown`, and `unknown` blocks.** A screen whose moat
and management gates all read `pass` after an automated run has not
satisfied them; it has narrated them.

## Circle Of Competence Belongs To The User

The gate asks whether *the person acting on this screen* can estimate
the business's cash economics a decade out. Asked of a model, the
question is unanswerable in a useful way and yields yes for everything.

So do not implement it as a judgment at all. During the freeze, have
the user declare the boundary — an allow-list of industries or business
models, optionally with named exclusions — and run it near the front of
the funnel, where it is an intrinsic-attribute test with no accounting
and no interpretation.

It runs *second*, after the accounting-model classification in
[applicability.md](applicability.md). Putting competence first would let
its exclusions absorb the companies this skill's accounting model cannot
read at all, and the report could then no longer state what fraction of
the universe was actually assessable.

Two consequences worth stating in the report. The allow-list is the
single most population-shaping decision in the screen, so publish it
with the exclusion counts. And it is a statement about the user, not
about the companies: a business outside the list is not a bad business,
which is why the exclusion reason must be worded as *outside the
declared competence boundary* rather than as a defect.

If the user declines to declare one, say that the competence gate is
unenforced and that every downstream result inherits that gap. Do not
silently substitute the model's own sense of what is understandable.

## The Moat Gate Has Two Halves

They behave differently and must be resolved separately, then combined:
any half failing fails the gate, any half unverified leaves it
`unknown`.

**The outcome half is computable.** The level, stability and dispersion
of returns on net tangible operating assets across ten years, gross
margin stability, pricing and volume behavior through a downturn,
retention or share data where disclosed. This half yields a real
verdict from structured data.

**The causal half is not.** Which specific barrier produces those
returns — low-cost position, brand-conferred pricing power, switching
costs, network effects, a scarce asset, distribution, regulation — and
why a well-funded competitor cannot erode it. This lives in filings,
industry documents and judgment. An automated pass leaves it `unknown`.

The failure mode is inferring the second half from the first. High
returns are what a moat produces; they are also what a cyclical peak, a
one-off, an accounting artifact, or a temporarily unchallenged position
produces. The inference runs the wrong way and it is the most common
way a Buffett screen fabricates its central finding.

Three specific prohibitions, each a real pattern:

- A famous brand does not establish pricing power. Test whether prices
  rose without volume loss.
- A high gross margin does not establish a barrier. Ask what stops a
  competitor from earning it too.
- Market leadership does not establish durability. Leadership is a
  position; the gate asks what defends it.

And per the 2007 letter: a moat that depends on one exceptional
executive is not a business moat. If the causal story is a person, the
gate fails rather than passes.

## Management: What Evidence Can And Cannot Establish

Honesty and capability are assessed from record, not from prose.
Shareholder letters are written to be persuasive, and their quality is
evidence about the writing, not about the writer.

Usable evidence: auditor opinions and any changes of auditor;
restatements; regulator and court records; related-party disclosures;
insider transactions; compensation structure and its relationship to
per-share value; dilution and repurchase behavior against
contemporaneous value; acquisition outcomes measured years later; and
the reconciliation of past statements against what subsequently
happened — which is the single most informative check available and the
one most often skipped.

What none of it establishes: that management is honest. The verdict is
*no disqualifying evidence detected in the named sources, as of this
date* — then name the sources. Never "has no such history". If the
conclusion rests on indirect evidence, such as a disclosure rule that
would have forced a document to exist, say so, and say which candidates
were confirmed directly and which rest on the inference.

Outcomes also cannot cleanly separate skill from luck or from an
inherited good business. A capable-looking record at a company with a
strong franchise is weak evidence about the managers. State the
confound rather than scoring through it.

## Keyword Hits Are Material, Not Verdicts

A hit on *fraud*, *investigation*, *restatement* or *related party* is
a reason to read, never a reason to disqualify. Text matching cannot
tell whether the subject was the company or an unrelated party, whether
the matter concerns the domain the criterion is about, whether it was
resolved in the company's favour, or whether the sentence merely
defines a term in a risk-factor boilerplate.

Route hits to a human decision, record the reasoning and the evidence
alongside the verdict, and keep the manual ruling as the authoritative
record. An automatic disqualification on a keyword produces exclusions
that cannot be defended, which is the mirror image of an automatic
pass.

## Scope The Qualitative Work

Verifying the whole population by hand is not feasible; verifying the
shortlist plus every challenger whose best-case key still reaches the
cutoff is, and is sufficient by the same argument that justifies
pruning. Note the circularity to avoid: an unverified gate leaves the
candidate unresolved, so it cannot be one of the guaranteed incumbents
that establish the cutoff in the first place.

So resolve in best-case-key order — but be precise about when a cutoff
starts to exist, because the qualitative gates are not the last ones.
Price is also a hard gate and runs after these, so clearing the moat and
management gates does **not** make a candidate guaranteed admissible;
only clearing price as well does. A cutoff drawn at the end of
qualitative adjudication is built on provisional incumbents, and pruning
against it can discard candidates that belonged in the shortlist. Until
N candidates have cleared *every* hard gate including price, order the
work by best-case key but drop nothing on placement. See
[pruning.md](pruning.md), which carries the full convergence test.

This is why the qualitative pass is bounded by the *fetch* budget rather
than by a cutoff in the early rounds. Resolve the strongest candidates
first because that is where a cutoff will come from, not because a
cutoff already exists to prune against.

## The Output Is A Referral List

Given the above, an automated pass over this doctrine terminates with
survivors that each carry at least one unresolved gate — normally the
moat's causal half, usually the management review, and the price gate
wherever the valuation range was too wide to decide.

That is the correct result, not a shortfall. Report it as a ranked set
of candidates worth reading, with each survivor's unresolved gates
listed beside it, and state plainly that the ranking orders the
computable evidence only.

Such a candidate is **pending, not excluded** — blocked from admission
while remaining in the population and in the output. It never appears in
the exclusion counts, which belong to `fail` and `na`. And because these
gates rarely resolve without human work, a run that adjudicates none of
them yields no guaranteed incumbents at all, so it terminates on the
frozen budget rather than on convergence, and says so. See
[pruning.md](pruning.md) § Termination. A pipeline that instead returns a clean
buy list has resolved those gates by writing prose, and the prose is
indistinguishable from analysis to every reader including its author.

## Evidence Layer

Persist the raw filing or response body next to fetch time, URL, page,
row count and the field-mapping version, then derive structured tables
from it. A reader who asks where a figure came from gets a specific
record, not a re-derivation.

Track fetch completion **per required field**, not per entity. A
company whose ten annual reports are fetched separately, one of which
failed, has rows in storage and looks done to a naive "has any row"
check; the failed year is then never retried and its criteria stay
`unknown` forever. Base the completeness predicate on the fields the
computations actually read, including the extra prior period an average
balance needs.

On retry, merge per column rather than replacing the row. A retry that
rebuilds the record from only the documents that succeeded *this* run
overwrites previously fetched columns with nulls, and completeness
oscillates between runs instead of accumulating.

Record the point-in-time property of any historical series before using
it in a percentile or a backtest. A series recomputed from today's
restated figures embeds look-ahead bias. The check is direct: back out
the implied denominator across the series and confirm it steps at the
dates new information was published, rather than tracking the observed
value throughout.

Finally, keep qualitative prose out of the hardcoded-number business.
Figures quoted in narrative sections must be injected from the stored
tables at render time. A number typed into a sentence goes stale
silently the next time the data is refreshed — and in this domain the
sentence around it usually carries a Buffett citation, which makes the
staleness look like doctrine.
