# Which Companies This Skill Can Evaluate

The accounting definitions in [criteria.md](criteria.md) — return on net
tangible operating assets, gross debt over an owner-earnings proxy,
interest coverage — describe an ordinary non-financial operating
company. **That is the only model implemented.**

Banks, insurers and regulated utilities are not a matter of swapping a
ratio. They need different definitions of earning power, capital
productivity, solvency and value: a bank's leverage is its business, an
insurer's economics live in underwriting discipline, reserve adequacy
and the cost and duration of float, and a rate-regulated utility earns
an allowed return on a rate base rather than a market return on
capital. A thin adapter over those would produce exactly the confident,
unsupported admission this skill exists to prevent — so the honest move
is to declare them out of scope and say so in the report, not to
approximate them.

This is a statement about the implementation, not about the doctrine.
Buffett built Berkshire on insurance float. Excluding insurers means
"this screen has no valid insurance model", never "insurance fails
Buffett's criteria" — and it follows that **Berkshire Hathaway itself is
out of scope for this screen**, which is a useful sanity check on any
implementation that claims otherwise.

## Classification

Freeze an `accounting_model` field on every candidate before any
Buffett criterion runs:

```
ordinary_nonfinancial | bank_or_deposit_taker | insurer_or_reinsurer
regulated_utility | other_specialized_financial | mixed_specialized
unknown
```

Derive it from audited filings and regulatory status — **not** from an
index provider's top-level sector label, which is both coarser and
differently motivated. A candidate is outside the implemented scope when
any of these holds:

- It is regulated as a bank, deposit-taking institution, insurer or
  reinsurer.
- It recognises material rate-regulated assets or liabilities.
- A specialised financial or regulated business is at least **10%** of
  consolidated revenue, absolute pre-tax income, or assets in any of the
  last three completed fiscal years.
- Its statements otherwise run on a model where financing liabilities
  are operating inputs — a material lending book, a broker-dealer, a
  captive finance arm of scale.
- The evidence needed to classify it is unavailable. Record `unknown`;
  it blocks. Defaulting an unclassifiable candidate to
  `ordinary_nonfinancial` is the silent-admission failure wearing a
  different hat.

The 10% threshold is author's policy. Freeze it, disclose it, and keep
`mixed_specialized` as a real outcome — without it, a conglomerate gets
evaluated on whichever segment flatters its ratios.

**A financial-sector label is not itself disqualifying.** A payment
network or transaction processor with no material deposit-taking,
lending book, underwriting or rate-regulated operation classifies as
`ordinary_nonfinancial` and is evaluated normally. What decides the
question is whether the balance sheet runs on a model these definitions
can read, not which taxonomy bucket the company sits in.

## Where It Runs

Applicability is hard gate 1, ahead of the circle-of-competence gate,
even though competence is the cheaper filter. Run competence first and
its exclusions absorb candidates the accounting model could never have
evaluated — after which no one can say what fraction of the universe
this skill actually covers.

`na` for a known specialised model; `unknown` for a classification gap.
Neither proceeds to the industrial accounting tests.

## What The Report Owes

Scope counts come **before** the funnel, and they are population-wide,
not first-gate-tripped. The mutually-exclusive first-gate rule in
[SKILL.md](../SKILL.md) governs the funnel; it cannot also carry scope,
because a candidate excluded earlier on competence would then hide a
company this skill was never able to assess.

State: the original population; the eligible ordinary-company
population; excluded counts split by bank, insurer, regulated utility,
other specialised financial, mixed, and classification-unknown; and the
classification rule version, materiality threshold, evidence source and
as-of date.

Then say plainly that these companies were **not evaluated** — they did
not fail Buffett's criteria. A reader who sees a shortlist drawn from an
index needs to know that a fifth of that index was never assessed, and
which fifth.
