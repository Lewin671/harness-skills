# US GAAP Concept Mapping And Null Semantics

The doctrine layer's computable definitions were written against US
statements; this file is the field-level mapping that implements them
for SEC XBRL. It is the authoritative twin of `derive.mjs` — the script
is this table, executable. Every rule here was forced by a real case
observed in the 2026-08-15 verification run over the S&P 500; the cases
are listed at the end, because the mapping without them reads like
caution theater.

## Fact Selection

- Namespaces: `us-gaap` only, plus the single `dei` cover-page fact
  below. IFRS (`ifrs-full`) facts are never mapped by best effort — an
  IFRS-only filer is classification `unknown`, not a guess.
- Forms accepted as annual: `10-K`, `20-F`, `40-F`, `10-K405`, `10-KT`
  (`10-K/A` facts dedupe to the same period end). Stub periods shorter
  than 340 days or longer than 380 are rejected — a spinoff's stub
  period is not an annual observation.
- **Balance-sheet facts are instant** (`start` missing or equal to
  `end`). Filtering instant facts as duration (or vice versa) silently
  empties whole statements — the first bug this mapping existed to fix.
- Deduplicate on (entity, period end), keep the latest `filed` — the
  latest restatement. A row count is not a period count.

## Null Semantics (three outcomes, never a silent zero)

For each concept and year exactly one of:

1. **Value** — a fact exists at that period end.
2. **0** — the filer never tags the concept at all, or its series is
   **stale** (last fact more than 2 years before the year in question:
   the tag migrated or was discontinued). XBRL omits zero facts, so
   absent-tag-as-zero is the regime's own convention.
3. **`unknown`** (null) — the filer tags the concept but not at this
   year. A missing component of a sum is `unknown`, never zero; treating
   it as zero inflates denominators and manufactures `fail`s.

A stale series is not a small error — it is a different company's
numbers wearing the same name. The derive layer reports, per filer,
which components were resolved by the absent-tag rule (`absent_components`)
and which series went stale (`stale_flags`), so the choice stays
auditable.

## Concept Table

Chains are tried in order per year; a tag whose series is stale yields
to the next tag. `magnitude` means the criterion reads a magnitude and
sign conventions differ between filers — take `|value|`.

| Concept | Tag chain | Kind | Policy |
|---|---|---|---|
| Revenue | Revenues, RevenueFromContractWithCustomerExcludingAssessedTax, SalesRevenueNet | flow | first value wins |
| Pre-tax continuing income | IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest, IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments, then Domestic+Foreign summed | flow | composite fallback named `domestic+foreign` |
| Operating income (EBIT) | OperatingIncomeLoss; fallback pre-tax + interest expense | flow | fallback only when the tag is absent |
| Net income | NetIncomeLoss, ProfitLoss | flow | consolidated |
| Net income to common | NetIncomeLossAvailableToCommonStockholdersBasic; fallback net income | flow | scope fallback documented |
| COGS | CostOfGoodsAndServicesSold, CostOfRevenue | flow | |
| CFO | NetCashProvidedByUsedInOperatingActivities | flow | required; missing → OEP `unknown` |
| PP&E capex | PaymentsToAcquirePropertyPlantAndEquipment, PaymentsToAcquireProductiveAssets; else O&G composite below | flow, magnitude | missing → OEP `unknown` |
| O&G capex composite | PaymentsToAcquireOilAndGasPropertyAndEquipment + PaymentsToAcquireOtherPropertyPlantAndEquipment | flow, magnitude | E&P filers tag drilling under oil-and-gas tags, not PP&E |
| Intangible capex | PaymentsToAcquireIntangibleAssets | flow, magnitude | absent/stale → 0 |
| OEP | CFO − PP&E capex − intangible capex | derived | never called owner earnings (Buffett-stated, 1986 letter) |
| Interest paid | InterestPaidNet, InterestPaid; fallback interest expense | flow, magnitude | coverage reads a magnitude |
| D&A | DepreciationDepletionAndAmortization, DepreciationAmortizationAndAccretionNet, DepreciationAndAmortization, Depreciation | flow | last resort is PP&E depreciation only — disclosed |
| Dividends / repurchases / issuance | PaymentsOfDividendsCommonStock→PaymentsOfDividends; PaymentsForRepurchaseOfCommonStock→PaymentsForRepurchaseOfEquity; ProceedsFromIssuanceOfCommonStock→ProceedsFromIssuanceOrSaleOfEquity | flow, magnitude | outflows are negative as filed |
| Stock comp | ShareBasedCompensation | flow, magnitude | a real cost — never added back |
| Diluted shares | WeightedAverageNumberOfDilutedSharesOutstanding | either | annual weighted average |
| Equity | StockholdersEquity | instant | parent equity; preferred not stripped (disclosed) |
| Assets | Assets | instant | classification denominators |
| Cash / ST investments | CashAndCashEquivalentsAtCarryingValue, ShortTermInvestments | instant | |
| Shares outstanding | CommonStockSharesOutstanding, then `dei:EntityCommonStockSharesOutstanding` | instant | cover-page fact is the usual survivor |
| AR / inventory / prepaid / PPE net / AP | AccountsReceivableNetCurrent, InventoryNet, PrepaidExpenseAndOtherAssetsCurrent, PropertyPlantAndEquipmentNet, AccountsPayableCurrent | instant | absent tag → 0 (flagged) |
| AR noncurrent | AccountsReceivableNetNoncurrent | instant | absent tag → 0 (flagged) |
| Accrued liabilities | AccruedLiabilitiesCurrent, OtherAccruedLiabilitiesCurrent; or combined AccountsPayableAndAccruedLiabilitiesCurrent when AP is absent | instant | combined tag replaces AP+accrued, never adds to them |
| Operating leases (ROU + liability) | OperatingLeaseRightOfUseAsset / OperatingLeaseLiabilityCurrent / OperatingLeaseLiabilityNoncurrent | instant | **pre-2019 = 0**: before ASC 842 the regime put them off-balance-sheet; absence there is structural, not missing data |
| Finance leases | FinanceLeaseLiabilityCurrent→CapitalLeaseObligationsCurrent; FinanceLeaseLiabilityNoncurrent→CapitalLeaseObligationsNoncurrent→FinanceLeaseLiability→CapitalLeaseObligations | instant | the total tags absorb the split when the split tags migrated |
| NCI equity / pension OCI | StockholdersEquityAttributableToNoncontrollingInterest, AccumulatedOtherComprehensiveIncomeLossPensionAndOtherPostretirementBenefitPlansAdjustmentNetOfTax | instant | valuation bridge |
| 12m maturities | LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths | instant | absent with debt outstanding → `unknown` |
| Nonrecourse debt | NonrecourseDebt | instant | classification evidence |

## Gross Debt (composite, per year)

`debt_current + debt_noncurrent + finance-lease current + finance-lease
noncurrent`, with each leg resolved stale-aware:

- `debt_current`: `DebtCurrent` if present; else `LongTermDebtCurrent` +
  `CommercialPaper` (absent/stale components = 0); if all absent/stale,
  0.
- `debt_noncurrent`: `LongTermDebtNoncurrent` → `LongTermDebt` →
  `LongTermDebtAndCapitalLeaseObligations`. Note the filer semantics of
  `LongTermDebt`: some filers include the current portion in it (HD
  does); since the current leg only adds components **not** inside the
  noncurrent tag, the gross total stays right either way.
- Operating leases are **not** capitalized into debt (freeze policy);
  their liability is carried in NTOA instead.

## NTOA (net tangible operating assets)

`AR current + AR noncurrent + inventory + prepaid + PP&E net +
operating-lease ROU − (AP + accrued + operating-lease liability current
+ noncurrent)`, absent components = 0 (flagged), tagged-but-missing =
`unknown`. A non-positive average NTOA year is `unknown`, never a
spectacular ratio — asset-light filers legitimately sit here, and the
report says so instead of printing 12,000% as a fact.

## Classification Evidence (gate 1)

Specialist tags, 10% materiality against the named base, last 3
completed FYs: `LoansAndLeasesReceivableNetReportedAmount` and
`Deposits` (vs assets), `PolicyLiabilities` (presence),
`RegulatoryAssets` (presence), `NonrecourseDebt` (vs gross debt),
`FinancingReceivableAllowanceForCreditLosses` (captive finance marker,
vs assets). SIC from `submissions.json` for the bank (6000–6099),
insurer (6300–6499) and other-financial (6100–6299, 6700–6799) ranges.
Rule order in freeze-template.md; first match wins.

## Cases That Forced These Rules (2026-08-15 verification run)

| Case | What broke | Rule it forced |
|---|---|---|
| Balance-sheet facts have no `start` (instant) | 0 facts extracted → everything `unknown` | instant facts accepted |
| AAPL: accrued liabilities under OtherAccruedLiabilitiesCurrent, AP+accrued combined tag | NTOA `unknown` for the whole name | accrued chain + combined-tag rule |
| PG: pre-tax line split into Domestic/Foreign, no total | gate 3 `unknown` | domestic+foreign composite |
| BALL: revenue under SalesRevenueNet | classification `unknown` | revenue chain |
| AAPL 2018+: intangible-capex tag discontinued | OEP silently understated | stale-skip, series flagged |
| HD: `LongTermDebt` includes current portion | gross debt wrong by sign | composite ordering above |
| EOG: capex under OilAndGasPropertyAndEquipment | OEP = CFO (overstated) | O&G capex composite; missing core capex → OEP `unknown` |
| SNA: capex line untagged entirely | false precision | OEP `unknown`, valuation `unknown` |
| AMAT: finance-lease split missing in the latest year | — | tagged-but-missing stays `unknown` |
| XOM: CIK re-registered, history on old CIK | 0 annual facts | ALT_CIKS merge |
| HONA: post-spinoff stub periods | misread as annual | 340–380 day filter, `unknown` |
| MA/AMAT/MSFT: D&A under three different tags | valuations aborted | D&A chain |
| SNA/CAT/F: captive finance under custom tags | folded into industrial ratios | allowance tag as marker; under-detection disclosed |
