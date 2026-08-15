// The frozen default constants for a buffett-screening-us run.
//
// One place, so the code and the prose cannot drift apart. Every entry
// carries the provenance label the doctrine contract requires:
//   buffett   — he wrote it; the letter is named (doctrine canon)
//   implied   — direct consequence of something he wrote
//   policy    — author's policy; the screen author's choice
// The prose twin is references/freeze-template.md. A run that wants
// different numbers edits the template copy in its run directory first,
// before any candidate data is visible — not this file mid-run.
//
// The values below are the ones used in the 2026-08-15 verification run
// over the S&P 500; they are defaults, not doctrine.

export const AS_OF_DEFAULT = new Date().toISOString();

// policy — universe and funnel size
export const N_SHORTLIST = 20; // shortlist size N
export const VALUATION_BUDGET = 20; // low/base/high valuations in lo order
export const COMPETENCE_NOTE = "user-declared allow-list; unenforced if '*'";

// policy — window and conventions (see us-gaap-conventions.md for the
// field-level mapping; that file is the authoritative mapping doc)
export const WINDOW = { fy_count: 10, extra_prior_years: 1, min_fy_days: 340, max_fy_days: 380 };
export const NORMALIZED_TAX_RATE = 0.21; // policy, flat
export const EARNINGS_NORMALIZATION = "none"; // as-filed pre-tax continuing income

// gate 3 earning power — policy thresholds
export const G3 = { positive_each_last_5: true, min_positive_of_10: 8 };

// gate 4 moat floor — policy thresholds on the computable outcome half
// (RONTOA); the causal half has no automated source and stays unknown.
export const G4 = { ron_toa_pass_median: 0.12, ron_toa_fail_median: 0.08, all_years_positive_for_pass: true, min_years: 5 };

// gate 5 survivability — the doctrine layer's default policy, all policy
export const G5 = {
  coverage_min: 3.0,
  coverage_years: 5,
  debt_max_multiple: 3.0, // gross debt / 3y median OEP
  maturity_pct: 0.25, // <= 25% of gross debt due within 12m, or cash covers it
};

// gate 6 management — no automated adjudication in the default run:
// the gate stays unknown for every candidate. See governance.md.

// gate 7 price + valuation model — all policy. The margin formula is the
// binding choice: 20% + (high-low)/base capped at 50% produced universal
// price-gate failures in the 2026-08-15 verification run. Declare it
// deliberately in the freeze, do not inherit it silently.
export const G7 = {
  discount_rates: { low: 0.10, base: 0.09, high: 0.08 },
  growth: { low: 0.00, base: 0.02, high: 0.04 },
  terminal_growth: 0.025, // strictly below required return
  horizon: 10,
  margin_base: 0.20,
  margin_cap: 0.50,
  maintenance_capex_defaults: { base: 0.60, high: 0.50 }, // low = max(0.60, DDA/capex)
};

// policy — scored criterion weights (max total 23)
export const SCORED = [
  { id: "S1", name: "roe", max: 2, rule: "10y median ROE >=15% -> 2; >=10% -> 1; na on non-positive avg equity" },
  { id: "S2", name: "moat_depth", max: 4, rule: "10y median RONTOA >=18% -> 4; >=12% -> 3; >=8% -> 1" },
  { id: "S3", name: "oep_conversion", max: 2, rule: "5y cum OEP / 5y cum consolidated NI >=1.0 -> 2; >=0.7 -> 1; denom<=0 -> 0" },
  { id: "S4", name: "incremental_roic", max: 2, rule: "dNOPAT/dNTOA >=12% -> 2; <12% -> 0; dNTOA<=0 -> na" },
  { id: "S5", name: "conservatism", max: 1, rule: "gross debt / 3y median OEP <= 1.5 -> 1" },
  { id: "S6", name: "share_count", max: 3, rule: "10y diluted share CAGR <=0 -> 2; <=1%/yr -> 1. stock comp/OEP <=5% -> 1" },
  { id: "S7", name: "one_dollar", max: 2, rule: ">=1.0 -> 2; >=0.7 -> 1; retained<=0 -> 0" },
  { id: "S8", name: "management_record", max: 3, rule: "unknown in the default run (0 lo, 3 hi)" },
  { id: "S9", name: "discount_to_value", max: 4, rule: "price<=low -> 4; <=base -> 3; <=high -> 2; >high -> 0; unvalued -> unknown" },
];

// policy — ranking tie-break (total order)
export const TIE_BREAK = ["lo desc", "hi desc", "RONTOA 10y median desc", "ROE 10y median desc", "ticker asc"];

// accounting-model classification — policy rule, evidence in
// freeze-template.md; specialist tags in us-gaap-conventions.md.
export const CLASSIFICATION = {
  materiality: 0.10,
  lookback_fy: 3,
  sic_ranges: { bank: [6000, 6099], insurer: [6300, 6499], other_financial: [[6100, 6299], [6700, 6799]] },
  order: [
    "project_finance_or_nonrecourse",
    "bank_or_deposit_taker",
    "insurer_or_reinsurer",
    "regulated_utility",
    "mixed_specialized",
    "other_specialized_financial",
    "ordinary_nonfinancial",
    "unknown",
  ],
};

// Same-entity CIK re-registrations observed in the verification run: the
// new CIK carries only recent quarters while annual history stays on the
// old CIK. The mapping layer merges the old CIK's series as a secondary
// source (primary file wins per year). Add cases here as they appear —
// this is mapping, not doctrine.
export const ALT_CIKS = { "2115436": "34088" }; // Exxon Mobil (new -> old)

// Price source: Yahoo Finance v8 chart API (no key). stooq became
// unusable from automation in 2026-08 (JavaScript proof-of-work wall);
// see data-sources.md.
export const PRICE_LOOKBACK_START = "2015-01-01";
export const PRICE_STALE_DAYS = 0; // close-on-or-before the as-of date
