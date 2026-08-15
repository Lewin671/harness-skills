# CAS Accounting Conventions

The doctrine layer's computable definitions assume US statements. This
file states the A-share (CAS / 企业会计准则) versions, each frozen at
field level against the Eastmoney full-statement tables
(`RPT_F10_FINANCE_GBALANCE`, `_GINCOME`, `_GCASHFLOW`). Every field
name below is the API's own; the summary tables (`RPT_DMSK_FN_*`) lack
several of them and must not be used for the exact stage. All figures
are consolidated annual rows, in CNY yuan, filtered by the annual
report-type field.

## Income And Tax

CAS 营业利润 already contains non-operating items, so the operating
profit for all return, coverage and valuation computations is the
adjusted EBIT:

```
EBIT = OPERATE_PROFIT
     − OTHER_INCOME              (其他收益, e.g. government grants)
     − INVEST_INCOME             (投资收益)
     − FAIRVALUE_CHANGE_INCOME   (公允价值变动收益)
     − ASSET_DISPOSAL_INCOME     (资产处置收益)
     + FE_INTEREST_EXPENSE       (利息支出总额, the gross interest line)
```

What stays inside, deliberately: 信用减值损失 and 资产减值损失 are real
costs and are not added back (doctrine rule); 利息收入 and exchange
effects remain netted inside 财务费用, a small conservative tilt.
`NOPAT = EBIT × (1 − t)` with the tax rate frozen at **25%** (author's
policy; high-tech 15% filers are conservatively penalized — say so in
the report).

Profit scope: **parent-attributable** (`PARENT_NETPROFIT`) for
common-equity returns and the one-dollar test; **consolidated** for
cash-flow metrics (OEP, conversion) — the same scope rule as the
doctrine layer, and CAS discloses both lines outright.

## Capital

**ROE** = `PARENT_NETPROFIT / average(TOTAL_PARENT_EQUITY)`, opening
and closing balances; `na` on non-positive average equity.

**Net tangible operating assets**, the CAS form of the doctrine's
tangible-capital idea:

```
NTOA = TOTAL_ASSETS
     − MONETARYFUNDS          (policy: all cash treated as non-operating)
     − GOODWILL
     − INTANGIBLE_ASSET
     − LONG_EQUITY_INVEST
     − TRADE_FINASSET − FVTPL_FINASSET − FVTOCI_FINASSET
     − HOLD_MATURITY_INVEST − OTHER_NONCURRENT_FINASSET − INVEST_REALESTATE
     − ACCOUNTS_PAYABLE − NOTE_PAYABLE − CONTRACT_LIAB
     − ADVANCE_RECEIVABLES − STAFF_SALARY_PAYABLE − TAX_PAYABLE
     − OTHER_PAYABLE − ACCRUED_EXPENSE
```

Financing liabilities (`SHORT_LOAN`, `LONG_LOAN`, `BOND_PAYABLE`,
`LEASE_LIAB`, `NONCURRENT_LIAB_1YEAR`, `DIVIDEND_PAYABLE`,
`INTEREST_PAYABLE`) are not subtracted: they are part of capital
structure, not operating funding. `USERIGHT_ASSET` and `LEASE_LIAB`
are both carried (CAS 21 capitalization), so leases move through both
sides consistently. Average of opening and closing.

`RONTOA = NOPAT / average(NTOA)`. Ten-year dispersion is not
available on the five-year window; report the five-year median,
minimum and dispersion instead, and say the window is shorter than the
doctrine layer's illustration.

## Debt And Survival

```
gross debt = SHORT_LOAN + NONCURRENT_LIAB_1YEAR + LONG_LOAN
           + BOND_PAYABLE + LEASE_LIAB
```

- **Coverage**: `EBIT / FE_INTEREST_EXPENSE` ≥ 3× in **each** of the
  five years. `FE_INTEREST_EXPENSE` is the P&L interest line, not cash
  interest paid — a proxy, disclosed as such. Zero debt and zero
  interest expense in a year satisfies that year; a non-positive
  denominator with debt outstanding is `fail`, never a ratio.
- **Debt to owner-earnings proxy**: gross debt ≤ 3× the three-year
  median OEP; non-positive OEP with debt outstanding is `fail`.

## Cash And Owner Earnings

**Owner-earnings proxy**: `OEP = NETCASH_OPERATE − CONSTRUCT_LONG_ASSET`
(consolidated). Never call it owner earnings.

**Add-backs** for the literal owner-earnings build are available in the
cash-flow supplementary fields: `FA_IR_DEPR` (fixed-asset depreciation),
`IA_AMORTIZE`, `LPE_AMORTIZE`, `IR_DEPR`, `OILGAS_BIOLOGY_DEPR`. Policy:
these five are add-backs; `ASSET_IMPAIRMENT` (provisions for
receivables, inventory, goodwill) is **not** added back without
reconciliation — real impairments are costs. Maintenance capex is not a
disclosed field anywhere in the data layer; the literal owner-earnings
figure stays `unknown` unless the annual report supports reconciling
asset age, capacity and replacement projects. The valuation base case
therefore starts from `NOPAT + DD&A` and states its
maintenance-versus-growth capex assumption; a base case that quietly
substitutes depreciation for maintenance capex is the doctrine layer's
named failure mode.

**Conversion**: five-year cumulative OEP over five-year cumulative
`PARENT_NETPROFIT`, only when every component is present and the
denominator is positive. Cash-flow fields are consolidated; pairing
them with parent profit repeats the minority-scope error the doctrine
layer documents — either deduct minority shares on both sides or mark
`unknown`.

## Goodwill

Deducted from NTOA (above). `GOODWILL / TOTAL_PARENT_EQUITY` is a
scored signal, not a gate. Historical goodwill impairments appear as
`ASSET_IMPAIRMENT_LOSS` and count as management-gate evidence:
acquisitions later written off.

## Real Estate Developers

Ordinary non-financial classification, but their economics distort the
cash measures: `CONTRACT_LIAB` (pre-sale deposits) inflates operating
cash before revenue recognition, and the OEP/debt pair behaves unlike
an industrial. Report the sub-group separately; do not swap in a
specialized model this skill does not implement.

## Window, Listing Age, Restructurings

- Window: the five most recent complete fiscal years plus one prior
  year for opening balances. CAS fiscal years are calendar years.
- Listing age: `LISTING_DATE` (from the org-info table) at least five
  full years before the as-of instant.
- 借壳 and major restructuring: where control changed or a major asset
  restructuring was completed, the window restarts at the completion
  year; a shorter resulting window is `unknown`, not a pass. Evidence:
  `FORMERNAME`, announcement record.

## Audit Opinion

The full-statement rows carry `OPINION_TYPE` per period. Policy:
standard unqualified is a pass-side fact for the survivability gate;
any qualified, disclaimer, adverse, or emphasis-of-matter opinion is
`fail`-class evidence at the survivability gate and management-gate
evidence; missing opinion data is `unknown`. An unqualified opinion is
evidence about the audit, not about management — the doctrine layer's
wording rules apply.

## Units And Mapping Version

G-table figures are CNY yuan (verified against 贵州茅台's published
totals). cninfo PDFs are typically in 万元 — the mapping version
records every unit conversion. A ratio mixing yuan and 万元 is wrong
by 10,000 and looks precise; every stored raw body records its unit
alongside URL and fetch time.

## Null Semantics (Frozen, Verified)

Eastmoney omits zero-amount line items: in the G-tables a zero amount
is usually returned as `null`, not `0` (verified across the 2020–2025
sample: trading-asset fields are `null` in every row). The doctrine
layer forbids treating a missing component as zero without a policy, so
this policy is frozen and audited:

- **Core fields must be present.** `OPERATE_PROFIT`, `TOTAL_ASSETS`,
  `TOTAL_PARENT_EQUITY`, `NETCASH_OPERATE`, `CONSTRUCT_LONG_ASSET`, and
  the five gross-debt fields: `null` makes the derived figure
  `unknown`, never zero.
  - **Operational consequence (measured 2026-08-15 on a 43-company
    universe):** `BOND_PAYABLE` is `null` for most filers without
    bonds and `LEASE_LIAB` for many without leases — the API omits
    zero lines — so the debt gate lands `unknown` on a large share of
    the population (16/43 in that run, including 贵州茅台 and 迈瑞医疗,
    which are near-zero-debt). This is the frozen semantics doing its
    job (never invent a zero), but a run should *expect* it and the
    report must not read as "these companies failed": they are
    pending, and reading the annual report's debt note resolves them.
    Consider a per-run policy decision (frozen before candidates are
    visible) on whether `BOND_PAYABLE`/`LEASE_LIAB` `null` with
    `SHORT_LOAN`/`LONG_LOAN`/`NONCURRENT_LIAB_1YEAR` present and zero
    counts as provable zero debt; the default keeps it `unknown`.
- **Adjustment and subtraction fields: `null` counts as zero.** The
  EBIT adjustments (other income, investment income, fair-value and
  disposal gains) and the NTOA subtraction list treat `null` as zero,
  because the API convention is omission-of-zero, not absence-of-line.
  The directions differ and are disclosed: a missing NTOA subtraction
  inflates the denominator and deflates returns (conservative), while
  a missing EBIT adjustment overstates EBIT (optimistic). The latter is
  bounded in practice — investment income is `null` in zero of the
  verification rows, other income in six of eighteen — and the
  per-field null counts travel with every derived output, so the bias
  is visible rather than silent.
- **`FE_INTEREST_EXPENSE: null` counts as zero only when gross debt is
  provably zero.** Interest `null` with debt outstanding is `unknown` —
  zero interest with debt is a finding, not a default.
- **The assumption is audited.** The derive step records, per field,
  how many rows took the null-as-zero path, and the report carries
  that count next to the coverage statistic.
