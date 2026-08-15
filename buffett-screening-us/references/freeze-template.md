# Freeze Template

Start every run from this template. Each entry carries a provenance
label — *Buffett-stated* (canon in the doctrine layer's
references/doctrine.md), *implied*, or *author's policy*. Most numbers
are author's policy, and saying so is not a weakness. Copy this file
into the run directory, fill it in, and record its hash in the run
manifest before any candidate data is fetched; an edit after that is a
freeze violation under the doctrine contract. Where the template says
*to declare*, there is no default — the run cannot start without it.
The values below are the 2026-08-15 verification-run defaults; they are
defaults, not doctrine.

## Run Identity

| Item | Value | Provenance |
|---|---|---|
| As-of instant | *to declare* (one timestamp for the whole run) | Author's policy |
| Universe | S&P 500 constituents per the Wikipedia list (data-sources.md), joined to SEC CIKs; dedupe dual-class pairs on CIK | User scope |
| History window | 10 most recent completed fiscal years + 1 prior year for opening balances | Author's policy |
| Shortlist size N | 20 | Author's policy |
| Competence allow-list | *to declare* (industry or business-model list, or explicitly unenforced — the report must say which) | User-declared |
| Tie-break | `lo` desc, `hi` desc, 10y median RONTOA desc, 10y median ROE desc, ticker asc | Author's policy |

## Work Budget

| Item | Value | Provenance |
|---|---|---|
| Facts stage | 2 requests per entity (submissions + companyfacts); 1,000 requests ≈ 12 minutes at 260 ms spacing, measured 2026-08-15 | Author's policy |
| Price stage | one Yahoo series per pending candidate | Author's policy |
| Valuation | low/base/high for up to 20 candidates in `lo` order; maintenance-capex guesses from 10-K MD&A, batched to delegates, each guess quoted to its filing | Author's policy |
| Manual adjudication | none in the default run — moat causal half and management gate stay `unknown`, the run is provisional and says so | Author's policy |
| Request cap / wall-clock cap | *to declare*; exhaustion is the normal terminator and the result is provisional | Author's policy |

## Frozen Conventions

| Item | Value | Provenance |
|---|---|---|
| Statements | consolidated, audited annual, latest restatement; no TTM | Author's policy |
| Capital | average opening+closing balances; period-end never in a denominator | Author's policy |
| EBIT | OperatingIncomeLoss; fallback pre-tax continuing + interest expense | Author's policy |
| Tax rate | 21% flat | Author's policy |
| Earnings normalization | none — as-filed pre-tax continuing income, no add-backs, no weak-year exclusions | Author's policy |
| Profit scope | common-shareholder for equity numerators; consolidated for cash metrics | Author's policy |
| NTOA / RONTOA | per us-gaap-conventions.md; non-positive NTOA year is `unknown` | Implied (1983 letter); thresholds policy |
| OEP | CFO − PP&E capex − intangible capex; never called owner earnings | Author's policy; the name discipline is Buffett-stated (1986 letter) |
| Gross debt | per us-gaap-conventions.md composite; operating leases not capitalized | Author's policy |
| Add-backs | none (stock comp and impairments are costs) | Author's policy |
| Prices | Yahoo chart API daily closes, last close on or before the date; no trade → `unknown` | Author's policy |

## Gates (defaults; all numeric thresholds are author's policy)

| Gate | Default |
|---|---|
| 3 Earning power | pre-tax continuing income positive in each of the last 5 FYs and ≥ 8 of 10; missing year → `unknown` |
| 4 Moat floor | outcome half: 10y median RONTOA ≥ 12% and every year > 0 → pass; < 8% → fail; between → `unknown`; causal half always `unknown` in an automated run |
| 5 Survivability | EBIT / cash interest ≥ 3× in each of the last 5 years (zero-debt zero-interest year passes); gross debt ≤ 3 × 3y median OEP (debt > 0 with non-positive OEP → fail); ≤ 25% of gross debt maturing within 12 months or cash covers it, else `unknown` (facilities undisclosed in XBRL) |
| 6 Management | `unknown` in the default run — see governance.md |
| 7 Price | price ≤ low case × (1 − margin); margin = 20% + (high−low)/base, capped at 50% |

## Valuation

| Item | Value | Provenance |
|---|---|---|
| Input | unlevered owner earnings = NOPAT + D&A − maintenance capex − ΔWC | Author's policy; unlevered discipline implied (2000 letter) |
| Horizon / terminal growth / required return | 10y / 2.5% / low 10%, base 9%, high 8% | Author's policy |
| Growth paths | low 0%, base 2%, high 4%; growth years deduct reinvestment = growth × (avg NTOA/NOPAT) × NOPAT | Author's policy |
| Maintenance capex | per-candidate 10-K guess, defaults 60% base / 50% high / max(60%, DDA÷capex) low | Author's policy; the guess requirement is Buffett-stated (1986 letter) |
| Bridge to equity | + cash + ST investments − gross debt − operating-lease liability − NCI − pension deficit; ÷ shares outstanding (fallback latest diluted) | Author's policy |
| Output | low / base / high; the low case decides the gate; a point estimate alone is the fabricated-valuation signature | Author's policy |

**Declare the margin deliberately.** The verification run's formula
(20% + range width, capped at 50%) hit the cap for every valued
candidate and the price gate failed 18/18 — the cap, not the valuation,
was the binding choice. A wide low/high range means the low case is
itself uncertain, which is why the discount rises; but 50% below the
low case is far stricter than Buffett's published wording ("materially
below" — 1992 letter; he published no percentage). Pick the cap before
candidates are visible, and live with what it does.

## Accounting-Model Classification (Gate 1)

The doctrine layer implements only the ordinary non-financial model;
this adapter inherits that and fixes its classification rule. Evidence:
XBRL specialist tags (us-gaap-conventions.md) at 10% materiality over
the last 3 completed FYs, plus the filing SIC. First match wins, in
order:

1. `project_finance_or_nonrecourse` — NonrecourseDebt ≥ 10% of gross debt
2. `bank_or_deposit_taker` — loans or deposits ≥ 10% of assets, or SIC 6000–6099
3. `insurer_or_reinsurer` — PolicyLiabilities present, or SIC 6300–6499
4. `regulated_utility` — RegulatoryAssets present and > 0
5. `mixed_specialized` — material financial tags AND COGS present (captive finance / conglomerate)
6. `other_specialized_financial` — SIC 6100–6299 or 6700–6799 (brokers, REITs, other finance)
7. `ordinary_nonfinancial` — revenue/net-income facts in the last 3 FYs, none of the above
8. `unknown` — otherwise (no facts, IFRS-only 20-F, stub-period spinoff) — blocks, and is counted population-wide

Everything except `ordinary_nonfinancial` is **not evaluated** — out of
scope, not failed. Berkshire Hathaway itself classifies as an insurer,
which is the sanity check the doctrine layer names. Known under-detection:
captive finance arms tagged under custom extensions (GM, Ford, John
Deere stayed `ordinary` in the verification run while Caterpillar was
caught) — disclose the residual in the report.

## Thresholds Never Imported

No ROE floor, no debt-to-equity ceiling, no P/E or P/B cutoff, no
fixed margin-of-safety percentage attributed to Buffett, no 15%
investee ROE floor — the doctrine layer's misattribution list applies
verbatim to this template.
