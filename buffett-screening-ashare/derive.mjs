// Derive the frozen CAS metrics from the stored raw statements.
//
//   node derive.mjs --run 2026-08-15 600519 000002 300750
//
// Implements exactly the definitions in references/cas-conventions.md,
// from the stored raw bodies only (never from vendor pre-computed
// fields). Per (code, year): adjusted EBIT, NOPAT, average NTOA and
// RONTOA, average-equity ROE, the owner-earnings proxy, gross debt,
// interest coverage, and the audit opinion. Missing components are
// `unknown`, never zero — except where the frozen null semantics say
// null counts as zero (cas-conventions.md § Null Semantics), and every
// such substitution is counted and reported.
//
// Output: <runId>/derived.json plus per-field coverage and
// null-as-zero counts. This script is the exact stage's arithmetic; it
// is not the funnel — gates, scoring and valuation belong to the run.
import { loadRaw, writeJson, parseArgs, fiscalYears, keyFor } from "./lib/http.mjs";

const TAX = 0.25;

// Core fields: must be present (null -> unknown).
const CORE = {
  GINCOME: ["OPERATE_PROFIT", "PARENT_NETPROFIT"],
  GBALANCE: ["TOTAL_ASSETS", "TOTAL_PARENT_EQUITY", "SHORT_LOAN", "LONG_LOAN", "BOND_PAYABLE", "LEASE_LIAB", "NONCURRENT_LIAB_1YEAR"],
  GCASHFLOW: ["NETCASH_OPERATE", "CONSTRUCT_LONG_ASSET"],
};

// EBIT adjustment fields: null counts as zero (frozen policy).
const EBIT_ADJUST = ["OTHER_INCOME", "INVEST_INCOME", "FAIRVALUE_CHANGE_INCOME", "ASSET_DISPOSAL_INCOME"];

// NTOA subtraction list: null counts as zero (frozen policy).
const NTOA_SUBTRACT = [
  "MONETARYFUNDS",
  "GOODWILL",
  "INTANGIBLE_ASSET",
  "LONG_EQUITY_INVEST",
  "TRADE_FINASSET",
  "FVTPL_FINASSET",
  "FVTOCI_FINASSET",
  "HOLD_MATURITY_INVEST",
  "OTHER_NONCURRENT_FINASSET",
  "INVEST_REALESTATE",
  "ACCOUNTS_PAYABLE",
  "NOTE_PAYABLE",
  "CONTRACT_LIAB",
  "ADVANCE_RECEIVABLES",
  "STAFF_SALARY_PAYABLE",
  "TAX_PAYABLE",
  "OTHER_PAYABLE",
  "ACCRUED_EXPENSE",
];

function annualRow(rec) {
  const rows = rec?.body?.result?.data ?? [];
  return rows.find((r) => r.REPORT_TYPE === "年报") ?? null;
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function present(row, field) {
  return row && num(row[field]) !== null;
}

// ---------- per-year derivations ----------

function deriveYear(inc, bal, cf, nullCounts) {
  const r = { states: {} };
  const bump = (f) => (nullCounts[f] = (nullCounts[f] ?? 0) + 1);

  // EBIT (null-as-zero on adjustments, frozen)
  if (present(inc, "OPERATE_PROFIT")) {
    let v = inc.OPERATE_PROFIT;
    for (const f of EBIT_ADJUST) {
      if (num(inc[f]) === null) bump(`ebit_adj_null:${f}`);
      else v -= inc[f];
    }
    // interest: null counts as zero only when debt is provably zero
    if (num(inc.FE_INTEREST_EXPENSE) === null) {
      if (debtIsZero(bal)) bump("ebit_interest_null_debtfree");
      else r.states.interest = "unknown";
    } else {
      v += inc.FE_INTEREST_EXPENSE;
      r.interest_expense = inc.FE_INTEREST_EXPENSE;
    }
    r.ebit = r.states.interest === "unknown" ? null : v;
    r.states.ebit = r.ebit === null ? "unknown" : "pass";
  } else {
    r.states.ebit = "unknown";
  }
  r.nopat = r.ebit === null ? null : r.ebit * (1 - TAX);

  // NTOA (null-as-zero on the subtraction list, frozen)
  if (present(bal, "TOTAL_ASSETS")) {
    let v = bal.TOTAL_ASSETS;
    for (const f of NTOA_SUBTRACT) {
      if (num(bal[f]) === null) bump(`ntoa_null:${f}`);
      else v -= bal[f];
    }
    r.ntoa = v;
    r.states.ntoa = "pass";
  } else {
    r.states.ntoa = "unknown";
  }

  // gross debt (all five fields must be present)
  const debtFields = ["SHORT_LOAN", "LONG_LOAN", "BOND_PAYABLE", "LEASE_LIAB", "NONCURRENT_LIAB_1YEAR"];
  if (debtFields.every((f) => present(bal, f))) {
    r.gross_debt = debtFields.reduce((s, f) => s + bal[f], 0);
    r.states.debt = "pass";
  } else {
    r.states.debt = "unknown";
  }

  // OEP
  if (present(cf, "NETCASH_OPERATE") && present(cf, "CONSTRUCT_LONG_ASSET")) {
    r.oep = cf.NETCASH_OPERATE - cf.CONSTRUCT_LONG_ASSET;
    r.states.oep = "pass";
  } else {
    r.states.oep = "unknown";
  }

  // coverage (frozen branch policy)
  if (r.ebit === null) r.states.coverage = "unknown";
  else if (r.interest_expense === undefined) {
    r.states.coverage = r.states.debt === "pass" && r.gross_debt === 0 ? "pass" : "unknown";
  } else if (r.interest_expense === 0) {
    r.coverage = null;
    r.states.coverage = r.states.debt === "pass" && r.gross_debt === 0 ? "pass" : "fail";
  } else {
    r.coverage = r.ebit / r.interest_expense;
    r.states.coverage = "pass";
  }

  r.parent_profit = num(inc?.PARENT_NETPROFIT);
  r.parent_equity = num(bal?.TOTAL_PARENT_EQUITY);
  r.audit_opinion = inc?.OPINION_TYPE ?? null;
  return r;
}

function debtIsZero(bal) {
  const debtFields = ["SHORT_LOAN", "LONG_LOAN", "BOND_PAYABLE", "LEASE_LIAB", "NONCURRENT_LIAB_1YEAR"];
  return debtFields.every((f) => present(bal, f)) && debtFields.every((f) => bal[f] === 0);
}

// ---------- main ----------

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.positionals.length) {
    console.log("usage: node derive.mjs [--run <id>] [codes...]");
    process.exit(args.help ? 0 : 1);
  }
  const runId = args.runId;
  const codes = args.positionals.filter((a) => !a.startsWith("--"));
  const years = fiscalYears(runId, 5, 1);
  const window = years.slice(1);

  const nullCounts = {};
  const coverage = {};
  const companies = [];

  for (const code of codes) {
    const company = { code, years: {} };
    let prevNtoa = null;
    let prevEq = null;

    for (const year of years) {
      const inc = annualRow(await loadRaw(runId, keyFor(["stmt", code, year, "GINCOME"])));
      const bal = annualRow(await loadRaw(runId, keyFor(["stmt", code, year, "GBALANCE"])));
      const cf = annualRow(await loadRaw(runId, keyFor(["stmt", code, year, "GCASHFLOW"])));
      const rec = deriveYear(inc, bal, cf, nullCounts);

      // average-based ratios need the prior period
      if (rec.states.ntoa === "pass" && prevNtoa !== null) {
        const avg = (rec.ntoa + prevNtoa) / 2;
        rec.avg_ntoa = avg;
        if (avg > 0) {
          rec.rontoa = rec.nopat === null ? null : rec.nopat / avg;
          rec.states.rontoa = rec.nopat === null ? "unknown" : "pass";
        } else {
          rec.rontoa = null;
          rec.states.rontoa = "na";
        }
      } else {
        rec.states.rontoa = "unknown";
      }
      if (rec.parent_equity !== null && prevEq !== null) {
        const avg = (rec.parent_equity + prevEq) / 2;
        rec.avg_parent_equity = avg;
        if (avg > 0) {
          rec.roe = rec.parent_profit === null ? null : rec.parent_profit / avg;
          rec.states.roe = rec.parent_profit === null ? "unknown" : "pass";
        } else {
          rec.roe = null;
          rec.states.roe = "na";
        }
      } else {
        rec.states.roe = "unknown";
      }

      company.years[year] = rec;
      prevNtoa = rec.states.ntoa === "pass" ? rec.ntoa : null;
      prevEq = rec.parent_equity;
    }

    const w = window.map((y) => company.years[y]).filter(Boolean);
    const med = (arr) => {
      const s = arr.filter((x) => x !== null).sort((a, b) => a - b);
      return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
    };
    const medianOep = med(w.map((r) => r.oep));
    const debt = w.find((r) => r.states.debt === "pass")?.gross_debt ?? null;
    let debtToOep = null;
    if (debt !== null && medianOep !== null) {
      debtToOep = medianOep > 0 ? debt / medianOep : debt > 0 ? "fail" : debt === 0 ? "pass" : null;
    }
    company.summary = {
      median_rontoa: med(w.map((r) => r.rontoa)),
      median_roe: med(w.map((r) => r.roe)),
      median_oep: medianOep,
      debt_to_median_oep: debtToOep,
    };

    for (const y of window) {
      const r = company.years[y];
      if (!r) continue;
      for (const f of ["ebit", "ntoa", "roe", "rontoa", "oep", "debt", "coverage"]) {
        coverage[f] = coverage[f] ?? { total: 0, pass: 0, unknown: 0, na: 0 };
        coverage[f].total++;
        coverage[f][r.states[f] === "pass" ? "pass" : r.states[f] === "unknown" ? "unknown" : r.states[f] === "na" ? "na" : r.states[f]]++;
      }
    }
    companies.push(company);
  }

  await writeJson(runId, "derived.json", {
    run: runId,
    definitions: "references/cas-conventions.md, frozen 2026-08-15",
    tax_rate: TAX,
    null_as_zero_counts: nullCounts,
    field_coverage: coverage,
    companies,
  });

  console.log("coverage:", JSON.stringify(coverage, null, 2));
  console.log("null-as-zero:", JSON.stringify(nullCounts, null, 2));
  for (const c of companies) {
    const s = c.summary;
    const pct = (x) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);
    console.log(
      `${c.code} | RONTOA ${pct(s.median_rontoa)} | ROE ${pct(s.median_roe)} | OEP ${s.median_oep === null ? "n/a" : (s.median_oep / 1e8).toFixed(1)}亿 | debt/OEP ${typeof s.debt_to_median_oep === "number" ? s.debt_to_median_oep.toFixed(1) : String(s.debt_to_median_oep)}`,
    );
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
