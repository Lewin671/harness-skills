#!/usr/bin/env node
// Stage 4: accounting-model classification (hard gate 1) from the
// derived layer + filing SIC, per the frozen rule order and 10%
// materiality. First match wins; the rule is documented in
// references/freeze-template.md.
//
//   node classify.mjs --run 2026-08-15
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, writeJson } from "./lib/http.mjs";
import { CLASSIFICATION } from "./lib/frozen.mjs";

function sicIn(sic, lo, hi) {
  if (!sic) return false;
  const n = parseInt(sic, 10);
  return n >= lo && n <= hi;
}
const inAny = (sic, ranges) => ranges.some(([lo, hi]) => sicIn(sic, lo, hi));

const last3 = (d, key) => d.fys.slice(-3).map((f) => f.fields[key]).filter((v) => v !== null && v !== undefined);
const frac = (xs, ys) => {
  let n = 0, s = 0;
  xs.forEach((x, i) => {
    const y = ys[i];
    if (x === null || y === null || y <= 0) return;
    s += x / y;
    n++;
  });
  return n ? s / n : null;
};

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node classify.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const derivedDir = path.join(runDir(runId), "derived");
  const out = [];
  for (const file of await fs.readdir(derivedDir)) {
    if (!file.endsWith(".json")) continue;
    const d = JSON.parse(await fs.readFile(path.join(derivedDir, file), "utf8"));
    const sic = d.sic;
    const assets3 = last3(d, "assets");
    const loans3 = last3(d, "spec_LoansAndLeasesReceivableNetReportedAmount");
    const deposits3 = last3(d, "spec_Deposits");
    const policy3 = last3(d, "spec_PolicyLiabilities");
    const reg3 = last3(d, "spec_RegulatoryAssets");
    const nonrec3 = last3(d, "spec_NonrecourseDebt");
    const allow3 = last3(d, "spec_FinancingReceivableAllowanceForCreditLosses");
    const cogs3 = last3(d, "cogs");
    const rev3 = last3(d, "revenues");
    const ni3 = last3(d, "net_income");

    const grossDebts = d.fys.slice(-3).map((f) => (typeof f.fields.gross_debt === "number" ? f.fields.gross_debt : null));
    const nrFrac = frac(nonrec3, grossDebts);
    const loanFrac = frac(loans3, assets3);
    const depFrac = frac(deposits3, assets3);
    const allowBig = allow3.length > 0 && assets3.length > 0 && Math.max(...allow3) > 0.001 * Math.max(...assets3.filter((x) => x !== null));
    const hasCogs = cogs3.some((v) => v !== null && v !== undefined && v !== 0);
    const matFin = (loanFrac !== null && loanFrac >= 0.10) || (depFrac !== null && depFrac >= 0.10) || policy3.some((v) => v > 0) || allowBig;

    let model = null;
    let evidence = null;
    if (nrFrac !== null && nrFrac >= 0.10) {
      model = "project_finance_or_nonrecourse";
      evidence = `nonrecourse/gross debt = ${(nrFrac * 100).toFixed(1)}%`;
    } else if (loanFrac !== null && loanFrac >= 0.10 || depFrac !== null && depFrac >= 0.10 || sicIn(sic, 6000, 6099)) {
      model = "bank_or_deposit_taker";
      evidence = `loans/assets=${loanFrac === null ? "n/a" : (loanFrac * 100).toFixed(1)}% deposits/assets=${depFrac === null ? "n/a" : (depFrac * 100).toFixed(1)}% sic=${sic}`;
    } else if (policy3.some((v) => v > 0) || sicIn(sic, 6300, 6499)) {
      model = "insurer_or_reinsurer";
      evidence = `policyLiabilitiesPresent=${policy3.length > 0} sic=${sic}`;
    } else if (reg3.some((v) => v > 0)) {
      model = "regulated_utility";
      evidence = "RegulatoryAssets > 0";
    } else if (matFin && hasCogs) {
      model = "mixed_specialized";
      evidence = `material financial tags + COGS present; sic=${sic}`;
    } else if (inAny(sic, CLASSIFICATION.sic_ranges.other_financial)) {
      model = "other_specialized_financial";
      evidence = `sic=${sic}`;
    } else if (rev3.length > 0 || ni3.length > 0) {
      model = "ordinary_nonfinancial";
      evidence = "revenues/ni facts in last 3 FYs";
    } else {
      model = "unknown";
      evidence = "no revenue/NI facts";
    }

    out.push({ cik: d.cik, ticker: d.ticker, sic, sic_description: d.sic_description, model, evidence, has_us_gaap_facts: d.has_us_gaap_facts, name: d.name });
  }
  await writeJson(runId, "classification.json", out);
  const counts = {};
  for (const o of out) counts[o.model] = (counts[o.model] || 0) + 1;
  console.log(counts);
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
