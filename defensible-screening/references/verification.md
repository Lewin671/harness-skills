# Verdicts, Evidence, And Unverifiable Criteria

## Four States

A verdict means different things depending on which kind of check
produced it, so fix the kind first. A **hard gate** decides admission
and carries no points. A **scored criterion** contributes points and
never decides admission. Collapsing the two into one rule produces
either a shortlist that throws out anyone who loses a single point, or
one that admits candidates through gates they never satisfied.

| State | Meaning | At a hard gate | At a scored criterion |
|---|---|---|---|
| `pass` | Checked, satisfied | Admits | Full points |
| `fail` | Checked, not satisfied | Blocks | Zero points, no effect on admission |
| `unknown` | Not checked, or data missing | Blocks | Zero to `lo`, full to `hi` |
| `na` | Structurally inapplicable | **Blocks** — inapplicable is not proven | Zero to both `lo` and `hi` |

Only `pass` admits at a hard gate. The instinct to let a candidate
through because nothing disqualifying turned up converts every gap in
the data into a pass; `fail`, `unknown` and `na` all keep it out, and
differ only in what the report says about why. `na` at a hard gate
deserves particular care — a candidate the gate cannot be evaluated
against has not satisfied it, and the honest outcome is either
exclusion with the reason stated, or an explicit, disclosed decision
by the user to waive that gate for that sub-population.

At a scored criterion the three non-`pass` states diverge: `fail` and
`na` are settled at zero, while `unknown` keeps the candidate's `hi`
alive and therefore keeps it in the work queue.

`na` is for a criterion that cannot exist for this candidate, not one
that happens to be missing. A margin test against a business with no
cost-of-sales line is `na`: no amount of refetching will produce the
figure. Two rules keep the distinction from being abused:

- **Require evidence of structural absence, not a single gap.** One
  missing period is a fetch problem. Every period missing, across a
  source template known to omit the field, is structural. Collapsing
  the first into `na` lets one failed request launder a candidate past
  the `unknown` block — an easy bug to introduce while fixing a
  different one.
- **`na` must cost something.** It adds nothing to `hi`, so an
  `na`-carrying candidate cannot reach a perfect score. That is the
  correct consequence: the framework did not fit, and the output should
  show it rather than paper over it.

## Proxy Definitions

Some criteria are computable only through a stand-in — a cash-flow line
used for capital expenditure, a components sum used for a total that is
not reported directly. A proxy is acceptable when it is labelled.

State the substitution where the number appears, not only in a
footnote, and keep the proxy's direction of error in view: if the
substitution is systematically conservative, say so, because a `fail`
produced by a conservative proxy is weaker than one from an exact
computation.

When components are summed, decide explicitly what a missing component
means. Treating it as zero understates the total, which for a ratio's
denominator inflates the result and can manufacture a `fail`. Require
completeness before computing, or return `unknown`.

## Criteria With No Structured Source

Some gates have no queryable dataset — regulatory history, reputational
checks, anything living in documents. Three rules:

**Scope it to candidates that could still place.** Verifying the whole
population is not feasible; verifying the shortlist plus every
challenger whose best-case key still reaches the cutoff is, and is
sufficient by the same argument that justifies pruning. Note the
circularity to avoid: an unverified gate leaves the candidate
unresolved, so it cannot be one of the guaranteed incumbents that
establish the cutoff in the first place. Resolve in best-case-key order
until N are guaranteed, then let the cutoff bound the remaining work.

**Separate the halves that behave differently.** Within one gate, some
sub-checks are reliably visible in cheap metadata and others are not.
Where disclosure rules force a dedicated, predictably-titled document,
scanning titles is sufficient and a clean scan is a real negative.
Where the fact lives in the body of a generically-titled document, a
clean scan proves nothing, and recording it as a pass is exactly the
silent-admission failure. Split the gate, resolve each half on its own
evidence, and combine: any sub-check failing fails the gate; any
sub-check unverified leaves it `unknown`.

**Keyword hits are material for adjudication, not verdicts.** A hit is
a reason to read, not to disqualify. Text matching cannot tell whether
the subject was the entity itself or an unrelated party, whether the
matter concerns the domain the criterion is about, or whether the
sentence merely defines a term. Route hits to a human decision, record
the reasoning and the evidence alongside the verdict, and keep the
manual ruling as the authoritative record.

**Word negatives as what they are.** *Not detected in the named
sources, as of this date* — then name them. Never "has no such
history". If the check rests on indirect evidence (a disclosure rule
that would have forced a document to exist), say that too, and say
which candidates were confirmed directly and which rest on the
inference.

## Evidence Layer

Persist the raw response body next to fetch time, URL, page, row count,
and the field-mapping version, then derive structured tables from it. A
reader who asks "where did this figure come from" gets a specific
record, not a re-derivation. Compression makes this cheap — verbose
JSON with mostly-null fields compresses to roughly a tenth — so keep
the body and expose a single helper that decompresses one record by id.

Track fetch completion **per required field**, not per entity. An
entity whose three source documents are fetched separately, one of
which failed, has rows in storage and looks done to a naive
"has any row" check; the failed document is then never retried and its
criteria stay `unknown` forever. Base the completeness predicate on the
fields the downstream computations actually read, including any extra
period a metric needs for an opening balance.

On retry, merge per column rather than replacing the row. A retry that
rebuilds the record from only the documents that succeeded *this* run
overwrites the previously fetched columns with nulls, and completeness
oscillates between runs instead of accumulating.

Record the point-in-time property of any historical series before using
it for a percentile. A series recomputed from today's figures embeds
look-ahead bias and makes current values look like whatever the
recomputation implies. The check is direct: back out the implied
denominator across the series and confirm it steps at the dates new
information was published, rather than staying proportional to the
observed value throughout.

Finally, keep qualitative prose out of the hardcoded-number business.
Figures quoted in narrative sections should be injected from the stored
tables at render time; a number typed into a sentence goes stale
silently the next time the data is refreshed.
