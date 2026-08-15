#!/usr/bin/env node
// Stage 7: low/base/high valuation for the frozen budget (top of the
// pending set in `lo` order). Frozen model parameters from
// lib/frozen.mjs; maintenance-capex guesses are injected from
// runs/<runId>/maint-capex-guesses.json (each with its 10-K source);
// freeze defaults apply where undisclosed.
//
//   node value.mjs --run 2026-08-15
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, readJson, writeJson } from "./lib/http.mjs";
import { G7, NORMALIZED_TAX_RATE, VALUATION_BUDGET } from "./lib/frozen.mjs";

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const N = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function dcfCase({ r, g, tg, nopat0, dda0, maint, dwc1, intensity }) {
  const uoe = (t) => {
    const nopat = nopat0 * Math.pow(1 + g, t);
    const reinvest = g * intensity * nopat; // growth bought with reinvestment
    return nopat - reinvest + dda0 - maint - (t === 1 ? dwc1 : 0);
  };
  let pv = 0;
  for (let t = 1; t <= G7.horizon; t++) pv += uoe(t) / Math.pow(1 + r, t);
  const tv = (uoe(G7.horizon) * (1 + tg)) / (r - tg);
  return pv + tv / Math.pow(1 + r, G7.horizon);
}

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node value.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const screen = await readJson(runId, "screen.json");
  const prices = await readJson(runId, "prices.json");
  let guesses = {};
  try {
    guesses = JSON.parse(await fs.readFile(path.join(runDir(runId), "maint-capex-guesses.json"), "utf8"));
  } catch {}

  const pending = screen
    .filter((r) => r.pending)
    .sort(
      (a, b) => b.lo - a.lo || b.hi - a.hi || (b.g4.median_rontoa ?? -1e9) - (a.g4.median_rontoa ?? -1e9) || (b.scores.S1.median ?? -1e9) - (a.scores.S1.median ?? -1e9) || a.ticker.localeCompare(b.ticker),
    );
  const valued = pending.slice(0, VALUATION_BUDGET);
  console.log(`valuing ${valued.length} of ${pending.length} pending`);

  const out = [];
  for (const r of valued) {
    const d = JSON.parse(await fs.readFile(path.join(runDir(runId), "derived", `${r.cik}.json`), "utf8"));
    const fys = d.fys;
    const last = fys[fys.length - 1];
    const prev = fys[fys.length - 2];
    const F = (y, k) => N(y.fields[k]);
    const ebit0 = (() => {
      const op = F(last, "operating_income");
      if (op !== null) return op;
      const pt = F(last, "pretax_continuing");
      const ie = F(last, "interest_expense");
      return pt !== null && ie !== null ? pt + Math.abs(ie) : null;
    })();
    const nopat0 = ebit0 === null ? null : ebit0 * (1 - NORMALIZED_TAX_RATE);
    const dda0 = F(last, "dda");
    const capex0 = Math.abs(F(last, "capex_ppe") ?? 0) + Math.abs(F(last, "capex_intangible") ?? 0);
    const wc = (y) => {
      const a = [F(y, "ar_current"), F(y, "inventory")].filter((x) => x !== null);
      const l = [F(y, "ap_current"), F(y, "accrued_current")].filter((x) => x !== null);
      return sum(a) - sum(l);
    };
    const dwc1 = wc(last) - wc(prev);
    const wcIncomplete = [F(last, "ar_current"), F(last, "inventory"), F(last, "ap_current"), F(last, "accrued_current"), F(prev, "ar_current"), F(prev, "inventory"), F(prev, "ap_current"), F(prev, "accrued_current")].some((x) => x === null);

    // capital intensity from the last 5y NOPAT/NTOA
    const nopatHist = [];
    const ntoaHist = [];
    for (let i = fys.length - 5; i < fys.length; i++) {
      const y = fys[i];
      const eb = F(y, "operating_income");
      if (eb === null) continue;
      const na = F(y, "ntoa");
      if (na === null) continue;
      nopatHist.push(eb * (1 - NORMALIZED_TAX_RATE));
      ntoaHist.push(na);
    }
    let intensity = 0;
    if (nopatHist.length >= 3) {
      const ratios = nopatHist.map((n, i) => (n > 0 ? ntoaHist[i] / n : null)).filter((x) => x !== null);
      if (ratios.length) intensity = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    }
    if (intensity < 0) intensity = 0;

    const shares = F(last, "shares_outstanding") ?? F(last, "diluted_shares");
    const priceNow = prices[r.ticker]?.as_of_close?.close ?? null;
    const g = guesses[r.ticker] || {};

    const bridgeInputs = {
      cash: F(last, "cash") ?? 0,
      st_inv: F(last, "st_investments") ?? 0,
      gross_debt: F(last, "gross_debt"),
      op_lease: (() => {
        const a = F(last, "op_lease_liab_current");
        const b = F(last, "op_lease_liab_noncurrent");
        return a === null && b === null ? 0 : (a ?? 0) + (b ?? 0);
      })(),
      nci: F(last, "nci_equity") ?? 0,
      pension_deficit: (() => {
        const p = F(last, "pension_oci");
        return p === null ? 0 : Math.max(0, -p);
      })(),
    };

    let rec = { cik: r.cik, ticker: r.ticker, state: "unknown" };
    if (nopat0 === null || dda0 === null || shares === null || priceNow === null || bridgeInputs.gross_debt === null) {
      rec.reason = "missing valuation input (NOPAT/DDA/shares/price/debt)";
      out.push(rec);
      continue;
    }
    if (nopat0 <= 0) {
      rec.reason = "NOPAT <= 0 - valuation not estimable";
      out.push(rec);
      continue;
    }
    if (capex0 <= 0) {
      rec.reason = "capex series missing/untagged - maintenance capex not estimable";
      out.push(rec);
      continue;
    }

    const maintBase = g.pct_base ?? G7.maintenance_capex_defaults.base;
    const maintHigh = g.pct_high ?? G7.maintenance_capex_defaults.high;
    const maintLow = g.pct_low ?? Math.max(0.60, dda0 / Math.max(capex0, 1));
    const low = dcfCase({ r: G7.discount_rates.low, g: G7.growth.low, tg: G7.terminal_growth, nopat0, dda0, maint: maintLow * capex0, dwc1, intensity });
    const base = dcfCase({ r: G7.discount_rates.base, g: G7.growth.base, tg: G7.terminal_growth, nopat0, dda0, maint: maintBase * capex0, dwc1, intensity });
    const high = dcfCase({ r: G7.discount_rates.high, g: G7.growth.high, tg: G7.terminal_growth, nopat0, dda0, maint: maintHigh * capex0, dwc1, intensity });
    const bridge = (ev) => ev + bridgeInputs.cash + bridgeInputs.st_inv - bridgeInputs.gross_debt - bridgeInputs.op_lease - bridgeInputs.nci - bridgeInputs.pension_deficit;
    const lowPs = bridge(low) / shares;
    const basePs = bridge(base) / shares;
    const highPs = bridge(high) / shares;
    const margin = Math.min(G7.margin_cap, G7.margin_base + (highPs - lowPs) / basePs);
    const threshold = lowPs * (1 - margin);
    const g7state = priceNow <= threshold ? "pass" : "fail";
    const s9 = priceNow <= lowPs ? 4 : priceNow <= basePs ? 3 : priceNow <= highPs ? 2 : 0;
    rec = {
      cik: r.cik,
      ticker: r.ticker,
      state: "valued",
      nopat0,
      dda0,
      capex0,
      dwc1,
      wc_incomplete: wcIncomplete,
      intensity,
      intensity_n: nopatHist.length,
      maint_pct: { low: maintLow, base: maintBase, high: maintHigh },
      maint_source: g.source || "freeze default (undisclosed)",
      maint_basis: g.basis || null,
      bridge: bridgeInputs,
      shares,
      price_now: priceNow,
      per_share: { low: lowPs, base: basePs, high: highPs },
      margin,
      threshold,
      g7: g7state,
      s9,
      assumptions: { ...G7.discount_rates, growth: G7.growth, terminal_growth: G7.terminal_growth },
    };
    out.push(rec);
  }
  await writeJson(runId, "valuations.json", out);
  console.log(`valued ${out.filter((o) => o.state === "valued").length}/${out.length}`);
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
