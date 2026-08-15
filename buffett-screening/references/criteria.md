# Gates, Scored Criteria, And Their Definitions

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
the data into a pass — and in this domain the gaps are systematic, not
random: maintenance capex is undisclosed by almost everyone, and no
filing states whether a moat will last.

`na` is for a criterion that cannot exist for this candidate, not one
that happens to be missing. A gross-margin test against a business with
no cost-of-sales line is `na`; one missing fiscal year is a fetch
problem and stays `unknown`. Require evidence of structural absence
across a source template, not a single gap — collapsing the first into
`na` lets one failed request launder a candidate past the `unknown`
block. And `na` must cost something: it adds nothing to `hi`, so an
`na`-carrying candidate cannot reach a perfect score, which is the
honest consequence of a framework that does not fit it.

## Frozen Conventions

Fix all of these before any candidate is visible. Each is a place where
two defensible readings produce different answers, and choosing after
seeing results is answer-fitting.

- Consolidated, audited annual statements, latest restatement, for a
  current screen; point-in-time filings for any backtest.
- The latest ten completed fiscal years. Never mix annual and
  trailing-twelve-month observations inside one historical test.
- Amounts attributable to **common shareholders** wherever the
  numerator is a common-equity return. Consolidated versus
  parent-attributable profit is the classic silent scope error.
- **Average** opening and closing balance-sheet capital, not
  period-end. Period-end capital in a denominator is wrong in a
  direction that varies by company.
- Separate models for ordinary non-financials, banks, insurers, and
  regulated utilities. No shared leverage or capital rule across them.
- A missing component of a sum yields `unknown`, never zero. Treating
  it as zero understates the total, which in a denominator inflates the
  ratio and can manufacture a `fail`.
- Currency, ADR-to-ordinary ratios, and diluted share count.
- The non-cash add-back policy, named line by line. Recurring stock
  compensation is a real cost; so is an impairment that reflects
  capital genuinely destroyed. "Non-cash" does not mean costless.

## Hard Gates

In funnel order. Each blocks on anything other than `pass`.

**1. Applicability.** The candidate's accounting model is one this skill
implements — ordinary non-financial operating companies — and the
required fields exist. Banks, insurers, regulated utilities and other
specialised financial models get `na`; an unclassifiable candidate gets
`unknown`. Both block. See
[applicability.md](applicability.md) for the classification rule and
the disclosure it owes.

This runs **before** the competence gate, even though competence is the
cheaper filter. Otherwise a competence exclusion absorbs candidates the
accounting model could never have evaluated, and the report can no
longer say how much of the universe this skill actually covers.

**2. Circle of competence.** The user's declared industry or
business-model allow-list, applied as an intrinsic-attribute filter. No
accounting and no judgment call by the model. Do not implement it as a
model self-assessment — see [adjudication.md](adjudication.md).

**3. Demonstrated earning power, not a turnaround.** Normalized pre-tax
income from continuing operations, defined as pre-tax income from
continuing operations minus identified non-recurring gains plus
identified non-recurring losses, evaluated over ten complete fiscal
years. The persistence rule — for example positive in each of the last
five years and in at least eight of ten — is **author's policy**. The
normalization rule must be frozen: excluding weak years as one-offs
after seeing them is exactly the fabrication this contract prevents.

**4. The moat floor.** A named causal barrier plus corroborating
outcome evidence. Structurally this gate has two halves that behave
differently and must be resolved separately; see
[adjudication.md](adjudication.md). Expect it to remain `unknown` on
most candidates after an automated pass, and report it that way.

**5. Financial survivability.** No going-concern qualification and no
unresolved default or covenant breach, plus a debt-service stress test
that must be written down rather than left to the implementer. A gate
stated as "passes a stress test" is not a gate: two implementations
will not agree, and the usual resolution is to invent a pass. The
default policy, all of it author's choice and all of it to be frozen
and disclosed:

- Adjusted EBIT over cash interest at least 3× in **each** of the last
  five years, not on average. Three times allows roughly a two-thirds
  fall in EBIT before coverage reaches 1×.
- Gross debt no more than 3× the three-year median owner-earnings
  proxy — a deliberately short repayment horizon.
- No more than 25% of gross debt maturing within twelve months without
  cash and committed facilities to cover it, so the test does not rest
  on refinancing that may not be available.

Any of the three unmeasurable leaves the gate `unknown`, which blocks.
This is a floor, not the whole leverage view — "little or no debt"
beyond survival is a scored criterion, because Buffett's preference for
it is a matter of degree.

**6. Management: integrity reviewed, and no disqualifying capability
record.** Buffett asks for businesses "operated by honest **and
competent** people" (1977), so a gate covering only honesty leaves half
the criterion unenforced and admits demonstrably poor operators on a
clean compliance record. Both halves must clear:

- *Integrity* — the named filing, audit, regulator and adjudication
  sources were reviewed and no unresolved material disqualifier was
  found. This certifies that the review happened, not that management is
  honest; no evidence can prove that. Word the verdict accordingly.
- *Capability* — no unresolved evidence of value-destroying capital
  allocation: acquisitions later written off, repurchases executed well
  above contemporaneous estimated value, serial issuance without
  matching value received. This is a floor against disqualifying
  evidence, not a demonstration of skill — the positive record stays
  scored, because outcomes cannot separate skill from an inherited
  franchise.

Expect this gate to rest at `unknown` after an automated pass, for the
same reason the moat gate does. See [adjudication.md](adjudication.md).

**7. Sensible price, with a real margin.** Current price at or below the
low-case intrinsic value **less a required discount**. The discount is
not optional trim: `price <= low case` admits a candidate priced exactly
at conservative value, which is the case Buffett explicitly rules out —
"If we calculate the value of a common stock to be only slightly higher
than its price, we're not interested in buying" (1992 letter). He
published no percentage, so the size is author's policy; it must rise
with the width of the low-to-high valuation range, since a wide range
means the low case is itself uncertain. Runs **last**, over survivors
only. If value cannot be estimated within a useful range, the verdict is
`unknown`, which blocks — not "cheap".

## Scored Criteria

Points only; none of these can disqualify, and none may offset a failed
gate. Weights are author's policy — Buffett published none — and must
be disclosed as such.

Return strength and stability; owner-earnings generation and a low
maintenance-capital burden; moat depth and expected duration beyond the
floor; the opportunity to reinvest at high incremental returns;
management's operating and capital-allocation record; balance-sheet
conservatism beyond survival; and the discount to conservative value.

## Computable Definitions

**Return on equity.** Normalized income attributable to common,
divided by average common equity over the period. Report the ten-year
median, minimum and dispersion rather than a single year. Return `na`
on non-positive average equity instead of a spectacular ratio. ROE is
inflatable by buybacks, leverage, impairments and a thin equity base,
so it is evidence about accounting returns, not about business quality
— which is why the next measure exists.

**Return on net tangible operating assets.** NOPAT divided by average
net tangible operating assets. NOPAT is adjusted EBIT times one minus
the normalized tax rate. Net tangible operating assets are tangible
operating assets minus non-interest-bearing operating liabilities,
excluding excess cash, non-operating investments, goodwill, acquired
intangibles and financing debt. Freeze the treatment of leases and of
internally expensed intangibles. This is the closest structured
expression of the 1983 unleveraged-tangible-capital idea, and it is
still an accounting approximation.

**Owner earnings, literal.** Net income plus depreciation, depletion
and amortization plus qualifying non-cash charges, minus **maintenance**
capital expenditure and minus the additional working capital required
to maintain competitive position and unit volume. This is Buffett's
definition and it is **not computable from structured data**:
maintenance capex is not a disclosed field. He says so himself in the
same appendix — the maintenance-capex term "must be a guess — and one
sometimes very difficult to make" — and still calls the result the
relevant figure for valuation, preferring to be "vaguely right" over
"precisely wrong". A screen that reports a precise owner-earnings
figure has therefore departed from the definition it claims to
implement. Depreciation is not a substitute for the term, and neither
is a management label — reconcile asset age, capacity and replacement
projects, or return `unknown`.

**Owner-earnings proxy.** Cash flow from operations minus total
capitalized expenditure, under a frozen policy on what counts as
capitalized (PP&E, capitalized software and intangible spend). This
subtracts growth capex as well as maintenance capex and is distorted by
working-capital releases. It is a reproducible cash-surplus measure and
nothing more. **Never call it owner earnings**, and never use it as a
pruning bound on the literal definition — the two differ by an unbounded
amount in an unknown direction.

**Owner-earnings conversion.** Cumulative five-year owner-earnings
proxy over cumulative five-year normalized **consolidated** net income,
computed only when the denominator is positive and every component is
present. Both sides must sit in the same ownership scope: the proxy is
built from consolidated cash flow and consolidated capital expenditure,
so pairing it with parent-attributable income puts the minority owners'
cash in the numerator and not the denominator, which inflates
conversion by exactly the minority share. Where non-controlling
interests are material, either deduct their share on both sides or mark
the metric `unknown` — do not mix the two scopes and report a ratio.

**Incremental return on capital.** The change in average NOPAT between
two smoothed windows, divided by the change in average net tangible
operating assets between the same windows. Mark `na` and route to
manual review when incremental capital is zero or negative.
Acquisitions, disposals and reclassifications invalidate it silently.

**Leverage.** Gross debt as short-term debt plus long-term debt plus
finance leases, stating whether operating leases are capitalized.
Report gross debt over the three-year median owner-earnings proxy, and
adjusted EBIT over cash interest for each of five years. None of this
measures bank, insurer, utility or project-finance risk — those need
their own adapters.

**Share-count stewardship.** Diluted share CAGR; repurchase prices
against contemporaneous estimated value; issuance proceeds against
value surrendered; stock compensation as a share of owner earnings.

**The one-dollar test.** Over a frozen window:

```
value created    = Δ market capitalisation + repurchases − equity issued
capital retained = Σ (normalised income to common − dividends − repurchases)
```

Compute only when retained capital is positive. **Do not add dividends
to the numerator.** A dividend is earnings handed straight to
shareholders, not value produced by retained capital; crediting it above
the line while deducting it below counts the same distribution twice and
inflates the ratio. Worked check: opening market capitalisation 100,
income 20, dividends 10, closing market capitalisation 110. The retained
10 produced exactly 10 of market value, so the ratio is
`10 / 10 = 1`. Adding dividends to the numerator would report 2.
Repurchases *are* added back, because the cash left the company and
depressed market capitalisation while still reaching shareholders. Multiple expansion and market cycles
contaminate it, and Buffett himself qualified the naive five-year
market-value formulation — so treat it as a scored signal, never a
gate.

## Intrinsic Value Is A Model, Not A Field

Discount **unlevered** owner earnings over a frozen horizon, add a
terminal value with the terminal growth rate strictly below the
required return, then add excess cash and non-operating investments and
subtract debt, lease obligations, pension deficits and minority
interests, and divide by diluted shares.

*Unlevered* is load-bearing and is **not** the owner-earnings figure
defined above. That one starts from net income, which is already net of
interest, so discounting it and then subtracting debt charges the
financing twice and understates equity value on every leveraged
company. Build the valuation input from operating profit instead:

```
unlevered owner earnings = NOPAT + DD&A + qualifying non-cash charges
                           − maintenance capex − required ΔWC
```

with NOPAT as adjusted EBIT times one minus the normalised tax rate.
The alternative is internally consistent too — discount the levered,
net-income-based owner earnings at a cost of equity and subtract no
debt — but the two must not be mixed. State which one the freeze
selected.

Freeze every one of these before running it: horizon, starting
normalized earnings, the maintenance-versus-growth split, the growth
path, terminal growth, required return, the excess-cash definition, the
capital-structure adjustments, share count, and the price timestamp.
Produce a low, base and high case; report the low case for the gate.

A single point estimate with several decimal places is the
characteristic output of a fabricated valuation. The range is the
result; the point estimate is a presentation choice that hides the
assumptions doing the work.
