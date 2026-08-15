#!/usr/bin/env node
// Stage 3: derive per-company, per-fiscal-year structured tables from
// the raw companyfacts layer. This script IS the concept table in
// references/us-gaap-conventions.md, executable: fallback chains with
// stale-skip, instant balance facts, absent-tag-as-zero vs
// tagged-but-missing-null, the ASC 842 regime rule, the gross-debt and
// NTOA composites, and the OEP definition.
//
//   node derive.mjs --run 2026-08-15
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, readJson, writeJson } from "./lib/http.mjs";
import { WINDOW, NORMALIZED_TAX_RATE, ALT_CIKS } from "./lib/frozen.mjs";

const NFY = WINDOW.fy_count;
const EXTRA = WINDOW.extra_prior_years;
const MIN_D = WINDOW.min_fy_days;
const MAX_D = WINDOW.max_fy_days;
const DAY = 86400000;
const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F", "10-K405", "10-KT"]);
const ASU842 = new Date("2019-01-01");

// Concept specs: { name, tags: [primary, ...fallback], kind: flow|instant|either,
// magnitude?: bool, preAsu842Zero?: bool, stalePolicy?: "staleYearsTreatedAsZero" }.
const CONCEPTS = [
  // income
  { name: "pretax_continuing", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], kind: "flow" },
  { name: "pretax_domestic", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"], kind: "flow" },
  { name: "pretax_foreign", tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesForeign"], kind: "flow" },
  { name: "operating_income", tags: ["OperatingIncomeLoss"], kind: "flow" },
  { name: "interest_expense", tags: ["InterestExpense", "InterestExpenseNonoperating", "InterestIncomeExpenseNonoperatingNet"], kind: "flow", magnitude: true },
  { name: "net_income_common", tags: ["NetIncomeLossAvailableToCommonStockholdersBasic"], kind: "flow" },
  { name: "net_income", tags: ["NetIncomeLoss", "ProfitLoss"], kind: "flow" },
  { name: "revenues", tags: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], kind: "flow" },
  { name: "cogs", tags: ["CostOfGoodsAndServicesSold", "CostOfRevenue"], kind: "flow" },
  // cash flow
  { name: "cfo", tags: ["NetCashProvidedByUsedInOperatingActivities"], kind: "flow" },
  { name: "capex_ppe", tags: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], kind: "flow", magnitude: true },
  { name: "capex_og_equip", tags: ["PaymentsToAcquireOilAndGasPropertyAndEquipment"], kind: "flow", magnitude: true },
  { name: "capex_other_ppe", tags: ["PaymentsToAcquireOtherPropertyPlantAndEquipment"], kind: "flow", magnitude: true },
  { name: "capex_intangible", tags: ["PaymentsToAcquireIntangibleAssets"], kind: "flow", magnitude: true, stalePolicy: "staleYearsTreatedAsZero" },
  { name: "interest_paid", tags: ["InterestPaidNet", "InterestPaid"], kind: "flow", magnitude: true },
  { name: "dda", tags: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"], kind: "flow" },
  { name: "dividends", tags: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"], kind: "flow", magnitude: true },
  { name: "repurchases", tags: ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"], kind: "flow", magnitude: true },
  { name: "issuance", tags: ["ProceedsFromIssuanceOfCommonStock", "ProceedsFromIssuanceOrSaleOfEquity"], kind: "flow", magnitude: true },
  { name: "stock_comp", tags: ["ShareBasedCompensation"], kind: "flow", magnitude: true },
  // balance (instant)
  { name: "equity", tags: ["StockholdersEquity"], kind: "instant" },
  { name: "assets", tags: ["Assets"], kind: "instant" },
  { name: "cash", tags: ["CashAndCashEquivalentsAtCarryingValue"], kind: "instant" },
  { name: "st_investments", tags: ["ShortTermInvestments"], kind: "instant" },
  { name: "ar_current", tags: ["AccountsReceivableNetCurrent"], kind: "instant" },
  { name: "ar_noncurrent", tags: ["AccountsReceivableNetNoncurrent"], kind: "instant" },
  { name: "inventory", tags: ["InventoryNet"], kind: "instant" },
  { name: "prepaid_current", tags: ["PrepaidExpenseAndOtherAssetsCurrent"], kind: "instant" },
  { name: "ppe_net", tags: ["PropertyPlantAndEquipmentNet"], kind: "instant" },
  { name: "ap_current", tags: ["AccountsPayableCurrent"], kind: "instant" },
  { name: "accrued_current", tags: ["AccruedLiabilitiesCurrent", "OtherAccruedLiabilitiesCurrent"], kind: "instant" },
  { name: "ap_accrued_combined", tags: ["AccountsPayableAndAccruedLiabilitiesCurrent"], kind: "instant" },
  { name: "nci_equity", tags: ["StockholdersEquityAttributableToNoncontrollingInterest"], kind: "instant" },
  { name: "pension_oci", tags: ["AccumulatedOtherComprehensiveIncomeLossPensionAndOtherPostretirementBenefitPlansAdjustmentNetOfTax"], kind: "instant" },
  { name: "shares_outstanding", tags: ["CommonStockSharesOutstanding", "dei:EntityCommonStockSharesOutstanding"], kind: "instant" },
  // debt components (instant)
  { name: "debt_current", tags: ["DebtCurrent"], kind: "instant" },
  { name: "ltd_current", tags: ["LongTermDebtCurrent"], kind: "instant" },
  { name: "commercial_paper", tags: ["CommercialPaper"], kind: "instant" },
  { name: "debt_noncurrent", tags: ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"], kind: "instant" },
  { name: "finance_lease_liability_current", tags: ["FinanceLeaseLiabilityCurrent", "CapitalLeaseObligationsCurrent"], kind: "instant" },
  { name: "finance_lease_liability_noncurrent", tags: ["FinanceLeaseLiabilityNoncurrent", "CapitalLeaseObligationsNoncurrent", "FinanceLeaseLiability", "CapitalLeaseObligations"], kind: "instant" },
  // operating leases (regime policy)
  { name: "op_lease_rou", tags: ["OperatingLeaseRightOfUseAsset"], kind: "instant", preAsu842Zero: true },
  { name: "op_lease_liab_current", tags: ["OperatingLeaseLiabilityCurrent"], kind: "instant", preAsu842Zero: true },
  { name: "op_lease_liab_noncurrent", tags: ["OperatingLeaseLiabilityNoncurrent"], kind: "instant", preAsu842Zero: true },
  // misc
  { name: "maturities_12m", tags: ["LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"], kind: "instant" },
  { name: "diluted_shares", tags: ["WeightedAverageNumberOfDilutedSharesOutstanding"], kind: "either" },
  { name: "nonrecourse_debt", tags: ["NonrecourseDebt"], kind: "instant" },
  // specialist classification tags
  { name: "spec_LoansAndLeasesReceivableNetReportedAmount", tags: ["LoansAndLeasesReceivableNetReportedAmount"], kind: "instant" },
  { name: "spec_Deposits", tags: ["Deposits"], kind: "instant" },
  { name: "spec_PolicyLiabilities", tags: ["PolicyLiabilities"], kind: "instant" },
  { name: "spec_RegulatoryAssets", tags: ["RegulatoryAssets"], kind: "instant" },
  { name: "spec_NonrecourseDebt", tags: ["NonrecourseDebt"], kind: "instant" },
  { name: "spec_FinancingReceivableAllowanceForCreditLosses", tags: ["FinancingReceivableAllowanceForCreditLosses"], kind: "instant" },
];

const NTOA_POS = ["ar_current", "ar_noncurrent", "inventory", "prepaid_current", "ppe_net", "op_lease_rou"];
const NTOA_NEG = ["ap_current", "accrued_current", "op_lease_liab_current", "op_lease_liab_noncurrent"];
const DEBT_COMPONENTS = ["debt_current", "debt_noncurrent", "finance_lease_liability_current", "finance_lease_liability_noncurrent"];

function collectFacts(facts, tag, kind) {
  const node = facts["us-gaap"]?.[tag];
  if (!node) return [];
  const out = [];
  for (const [unit, arr] of Object.entries(node.units || {})) {
    for (const f of arr) {
      if (!f.end) continue;
      if (f.form && !ANNUAL_FORMS.has(f.form)) continue;
      const start = f.start ? new Date(f.start) : null;
      const end = new Date(f.end);
      const d = start ? (end - start) / DAY : 0;
      if (kind === "flow") {
        if (d < MIN_D || d > MAX_D) continue;
      } else if (kind === "instant" && d !== 0) {
        if (d < MIN_D || d > MAX_D) continue; // some filers report balances as duration
      } else if (kind === "either" && d !== 0 && (d < MIN_D || d > MAX_D)) {
        continue;
      }
      out.push({ ...f, unit, duration_days: d });
    }
  }
  return out;
}

function dedupe(facts) {
  const m = new Map();
  for (const f of facts) {
    const cur = m.get(f.end);
    if (!cur || new Date(f.filed || 0) > new Date(cur.filed || 0)) m.set(f.end, f);
  }
  return [...m.values()].sort((a, b) => new Date(a.end) - new Date(b.end));
}

function valueAt(series, end, magnitude) {
  const hit = series.find((f) => f.end === end);
  if (!hit) return null;
  let v = hit.val;
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return magnitude ? Math.abs(v) : v;
}

// First tag in the chain with a value at this end; a tag whose series
// stopped >2y before `end` is stale (discontinued/migrated) and yields.
function pickValue(seriesByTag, spec, end) {
  const endT = new Date(end).getTime();
  for (const tag of spec.tags) {
    const s = seriesByTag.get(tag);
    if (!s) continue;
    const lastEnd = s.fs.length ? new Date(s.fs[s.fs.length - 1].end).getTime() : 0;
    if (endT - lastEnd > 730 * DAY) continue;
    const v = valueAt(s.fs, end, spec.magnitude);
    if (v !== null) return { value: v, tag };
  }
  return null;
}

// Three outcomes for a chain: value; 0 when every tag is absent or
// stale; null when a tag is current but has no value at this year.
function chainStaleAware(seriesByTag, tags, end) {
  const p = pickValue(seriesByTag, { name: tags[0], tags, kind: "instant" }, end);
  if (p) return p.value;
  let anyCurrentPresent = false;
  for (const tag of tags) {
    const s = seriesByTag.get(tag);
    if (!s || !s.fs.length) continue;
    const lastEnd = new Date(s.fs[s.fs.length - 1].end).getTime();
    if (new Date(end).getTime() - lastEnd > 730 * DAY) continue;
    anyCurrentPresent = true;
  }
  return anyCurrentPresent ? null : 0;
}

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node derive.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const population = await readJson(runId, "population.json");
  const byCik = new Map(population.companies.map((c) => [c.cik, c]));
  const rawDir = path.join(runDir(runId), "raw");
  const outDir = path.join(runDir(runId), "derived");
  await fs.mkdir(outDir, { recursive: true });
  const asOf = new Date(population.fetched_at);

  const entries = await fs.readdir(rawDir);
  const meta = [];
  for (const cik of entries.filter((d) => /^\d+$/.test(d))) {
    const factsPath = path.join(rawDir, cik, "companyfacts.json");
    const subsPath = path.join(rawDir, cik, "submissions.json");
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(factsPath, "utf8"));
    } catch {
      meta.push({ cik, error: "no companyfacts" });
      continue;
    }
    let subs = null;
    try {
      subs = JSON.parse(await fs.readFile(subsPath, "utf8"));
    } catch {}
    const pop = byCik.get(cik) || {};

    const seriesByTag = new Map();
    const addSeriesFrom = (facts) => {
      for (const spec of CONCEPTS) {
        for (const tag of spec.tags) {
          if (seriesByTag.has(tag)) continue;
          const fs = dedupe(collectFacts(facts, tag, spec.kind));
          if (fs.length) seriesByTag.set(tag, { fs });
        }
      }
    };
    addSeriesFrom(raw.facts);
    // dei cover-page share count
    const deiShares = raw.facts?.["dei"]?.["EntityCommonStockSharesOutstanding"];
    if (deiShares) {
      const fs = dedupe(
        Object.entries(deiShares.units || {}).flatMap(([, arr]) => arr.filter((f) => f.end).map((f) => ({ ...f, unit: "shares" }))),
      );
      if (fs.length) seriesByTag.set("dei:EntityCommonStockSharesOutstanding", { fs });
    }
    // old-CIK merge (CIK re-registration)
    const altCik = ALT_CIKS[cik];
    if (altCik) {
      try {
        const altRaw = JSON.parse(await fs.readFile(path.join(rawDir, cik, `companyfacts-alt-${altCik}.json`), "utf8"));
        addSeriesFrom(altRaw.facts ?? altRaw);
      } catch {}
    }

    // fiscal-year grid: union of flow-series ends within the window
    const ends = new Set();
    for (const { fs } of seriesByTag.values()) {
      for (const f of fs) {
        const e = new Date(f.end);
        if (e <= asOf && f.duration_days >= MIN_D && f.duration_days <= MAX_D) ends.add(f.end);
      }
    }
    const grid = [...ends].sort();
    const window = grid.slice(-(NFY + EXTRA));

    const fys = window.map((end) => {
      const endDate = new Date(end);
      const f = { end, fields: {} };
      for (const spec of CONCEPTS) {
        const p = pickValue(seriesByTag, spec, end);
        if (p) {
          f.fields[spec.name] = p.value;
          f.fields[`${spec.name}_tag`] = p.tag;
        } else if (spec.preAsu842Zero && endDate < ASU842) {
          f.fields[spec.name] = 0;
          f.fields[`${spec.name}_tag`] = "pre-asu842-zero";
        }
      }
      // pretax composite: domestic + foreign
      if (f.fields.pretax_continuing === null || f.fields.pretax_continuing === undefined) {
        const dom = f.fields.pretax_domestic;
        const frg = f.fields.pretax_foreign;
        if (dom !== null && dom !== undefined && frg !== null && frg !== undefined) {
          f.fields.pretax_continuing = dom + frg;
          f.fields.pretax_continuing_tag = "domestic+foreign";
        }
      }
      // OEP: cfo - |capex_ppe| - |capex_intangible|; missing core capex -> unknown
      if (f.fields.cfo !== null && f.fields.cfo !== undefined) {
        let ppe = f.fields.capex_ppe;
        if (ppe === null || ppe === undefined) {
          const a = f.fields.capex_og_equip;
          const b = f.fields.capex_other_ppe;
          if (a === null && b === null) ppe = null;
          else ppe = (a ?? 0) + (b ?? 0);
        }
        const inta = f.fields.capex_intangible ?? 0;
        f.fields.oep = ppe === null || ppe === undefined ? null : f.fields.cfo - Math.abs(ppe) - Math.abs(inta);
      }
      return f;
    });

    // stale-series flag for capex_intangible
    const staleFlags = {};
    const capexSeries = seriesByTag.get("PaymentsToAcquireIntangibleAssets")?.fs || [];
    if (capexSeries.length && window.length) {
      const lastEnd = new Date(capexSeries[capexSeries.length - 1].end);
      const windowEnd = new Date(window[window.length - 1]);
      if ((windowEnd - lastEnd) / DAY > 730) {
        staleFlags.capex_intangible = { last_fact_end: capexSeries[capexSeries.length - 1].end, policy: "years after last fact treated as 0 (tag discontinued)" };
        for (const fy of fys) {
          if (new Date(fy.end) > lastEnd && (fy.fields.capex_intangible === null || fy.fields.capex_intangible === undefined)) {
            fy.fields.capex_intangible = 0;
            fy.fields.capex_intangible_tag = "stale-series-zero";
          }
        }
      }
    }

    // composites
    const conceptPresent = new Set();
    for (const fy of fys) {
      for (const k of Object.keys(fy.fields)) {
        if (!k.endsWith("_tag") && fy.fields[k] !== null && fy.fields[k] !== undefined) conceptPresent.add(k);
      }
    }
    const absentZero = (fy, name) => (conceptPresent.has(name) ? (fy.fields[name] ?? null) : 0);
    for (const fy of fys) {
      const f = fy.fields;
      // gross debt
      const dcTotal = pickValue(seriesByTag, { name: "debt_current", tags: ["DebtCurrent"], kind: "instant" }, fy.end);
      let dc = dcTotal ? dcTotal.value : null;
      if (dc === null) {
        const a = chainStaleAware(seriesByTag, ["LongTermDebtCurrent"], fy.end);
        const b = chainStaleAware(seriesByTag, ["CommercialPaper"], fy.end);
        dc = a === null || b === null ? null : a + b;
        if (dc === null) {
          const s = seriesByTag.get("DebtCurrent");
          const staleOrAbsent =
            !s || !s.fs.length || new Date(fy.end).getTime() - new Date(s.fs[s.fs.length - 1].end).getTime() > 730 * DAY;
          if (staleOrAbsent) dc = 0;
        }
      }
      const dnc = chainStaleAware(seriesByTag, ["LongTermDebtNoncurrent", "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations"], fy.end);
      const flc = chainStaleAware(seriesByTag, ["FinanceLeaseLiabilityCurrent", "CapitalLeaseObligationsCurrent"], fy.end);
      const fln = chainStaleAware(seriesByTag, ["FinanceLeaseLiabilityNoncurrent", "CapitalLeaseObligationsNoncurrent", "FinanceLeaseLiability", "CapitalLeaseObligations"], fy.end);
      const debtParts = [dc, dnc, flc, fln];
      const debtMissing = debtParts.filter((p) => p === null);
      f.gross_debt = debtMissing.length ? null : debtParts.reduce((a, b) => a + b, 0);
      // NTOA
      const pos = NTOA_POS.map((n) => absentZero(fy, n));
      const combinedAp = !conceptPresent.has("ap_current") && conceptPresent.has("ap_accrued_combined");
      const neg = combinedAp
        ? [absentZero(fy, "ap_accrued_combined"), absentZero(fy, "op_lease_liab_current"), absentZero(fy, "op_lease_liab_noncurrent")]
        : NTOA_NEG.map((n) => absentZero(fy, n));
      const posMissing = pos.filter((p) => p === null);
      const negMissing = neg.filter((p) => p === null);
      f.ntoa = posMissing.length || negMissing.length ? null : pos.reduce((a, b) => a + b, 0) - neg.reduce((a, b) => a + b, 0);
    }
    const absent_components = {
      ntoa: [...NTOA_POS, ...NTOA_NEG].filter((n) => !conceptPresent.has(n)),
      debt: DEBT_COMPONENTS.filter((n) => !conceptPresent.has(n)),
    };

    await writeJson(runId, path.join("derived", `${cik}.json`), {
      cik,
      ticker: pop.ticker,
      name: subs?.name || pop.name || null,
      sic: subs?.sic ? String(subs.sic) : null,
      sic_description: subs?.sicDescription || null,
      fiscal_year_end: subs?.fiscalYearEnd || null,
      as_of: population.fetched_at,
      fy_count: fys.length,
      fys,
      stale_flags: staleFlags,
      absent_components,
      has_us_gaap_facts: seriesByTag.size > 0,
      mapping_version: "2026-08-15.1",
    });
    meta.push({ cik, ticker: pop.ticker, fys: fys.length, tags: seriesByTag.size });
  }
  await writeJson(runId, "derive-meta.json", meta);
  console.log(`derived ${meta.length} entities; <5 FYs or errors: ${meta.filter((m) => m.error || m.fys < 5).length}`);
  void NORMALIZED_TAX_RATE;
}

function parseArgsFrom(argv) {
  const args = { runId: new Date().toISOString().slice(0, 10) };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--run" || argv[i] === "-r") args.runId = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
  }
  return args;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
