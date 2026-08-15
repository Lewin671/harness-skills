# Governance And The Qualitative Budget

The doctrine layer's management gate has two halves — integrity reviewed
and no disqualifying capability record — and its moat gate has a causal
half no structured source can answer. This file fixes what a US run can
and cannot automate, and where the frozen work budget goes.

## What The Default Run Does NOT Adjudicate

The default run adjudicates **nothing** qualitative. The moat causal
half and the management gate sit at `unknown` for every candidate, the
run ends provisional on the budget, and the output is a referral list
with the unresolved gates named. This is the designed outcome, not a
shortfall; a run that resolves them by writing prose has fabricated
them. Declare the budget for human adjudication in the freeze before
the run; the default is zero.

## US Evidence Sources, When A Run Does Adjudicate

Evidence is from record, not from prose; keyword hits are material, not
verdicts — route them to a human decision and keep the ruling as the
authoritative record.

- **Auditor changes and audit opinions**: the opinion rides the 10-K;
  auditor changes appear in 8-K item 4.01 filings. Check the named
  filing, cite the accession number, and word a clean review as
  *no disqualifying evidence detected in the named sources*, never
  "has no such history".
- **Restatements**: the XBRL layer itself shows them — a fact re-filed
  under a later `filed` date with a changed value is a restatement
  record, stored raw. The derive layer keeps the latest revision; the
  existence of revisions is itself management-gate evidence worth
  counting.
- **Regulator and court records**: SEC EDGAR full-text search
  (`efts.sec.gov/LATEST/search-index?q=...`) and DOJ/CFTC press
  releases are the named sources. A miss is weak evidence (the corpus
  is not complete); word it that way.
- **The one-dollar test and share-count stewardship** (S6, S7) are the
  structured, automatable halves of the capability review — serial
  issuance, buybacks above contemporaneous value, and retained capital
  that produced no market value all show up there.
- **Capital-allocation outcomes**: acquisitions later written off live
  in impairment and goodwill facts; the doctrine layer's add-back
  policy says impairments are real costs, which is what makes them
  visible.

## Maintenance-Capex Adjudication (Valuation Input, Budgeted)

The valuation's maintenance-capex term must be a guess (Buffett-stated,
1986 letter appendix), and a guess needs a source. For each valued
candidate, within the frozen budget, delegate exactly this:

1. Fetch the latest 10-K (URL from `fetch-10k-list.mjs`) and read the
   MD&A capital-expenditures discussion.
2. Extract the filing's own numbers: recent and planned total capex,
   and any maintenance-versus-growth split it discloses.
3. Return a maintenance share of **total** capex for three cases with a
   one-sentence basis quoting the filing: `pct_base` (default 0.60),
   `pct_high` (default 0.50), `pct_low` (default: use the freeze's
   `max(60%, DDA/capex)`). Deviate from defaults **only** on the
   filing's own evidence — a stated split, a clearly growth-only
   multi-year program, assets needing near-total replacement. A guess
   invented to look informed is worse than the default.
4. Record ticker, accession number, section, and the quoted passage.
   Unfetchable or silent → defaults, labelled "undisclosed".

The delegate must **not** judge moats, management, or valuations — the
task is the capex number and nothing else. Batch it (five companies per
delegate is a workable size) and inject the returned numbers into the
valuation stage; every number that cannot be walked back to a quoted
passage is dropped.
