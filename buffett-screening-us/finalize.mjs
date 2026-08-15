#!/usr/bin/env node
// Stage 8: fold valuations into the screen (S9 points, G7 price gate),
// recompute lo/hi, re-rank, and emit scope/funnel/coverage counts for
// the report. Idempotent: terminal/pending are rebuilt from the base
// gates before each fold, so re-runs never double-count g7.
//
//   node finalize.mjs --run 2026-08-15
import { runDir, readJson, writeJson } from "./lib/http.mjs";
import { N_SHORTLIST, TIE_BREAK } from "./lib/frozen.mjs";

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node finalize.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const screen = await readJson(runId, "screen.json");
  const valuations = await readJson(runId, "valuations.json");
  const classification = await readJson(runId, "classification.json");
  const byCik = new Map(valuations.map((v) => [v.cik, v]));

  // Rebuild terminal/pending from the base gates (idempotent fold).
  for (const r of screen) {
    const baseFail = r.g3?.state === "fail" ? "g3_earning_power" : r.g4?.state === "fail" ? "g4_moat" : r.g5?.state === "fail" ? "g5_survivability" : null;
    r.terminal = !!baseFail;
    r.pending = !baseFail;
    r.first_fail_gate = baseFail;
    r.g7 = null;
    r.scores.S9 = { state: "unknown", ptsLo: 0, ptsHi: 4, deferred: "valuation" };
  }

  for (const r of screen) {
    const v = byCik.get(r.cik);
    if (!r.pending || !v) continue; // unvalued pending keep g7/S9 unknown
    if (v.state !== "valued") {
      r.g7 = { state: "unknown", reason: v.reason || "valuation not estimable" };
      continue;
    }
    r.g7 = {
      state: v.g7,
      price_now: v.price_now,
      low: v.per_share.low,
      base: v.per_share.base,
      high: v.per_share.high,
      margin: v.margin,
      threshold: v.threshold,
    };
    r.scores.S9 = { state: "settled", ptsLo: v.s9, ptsHi: v.s9, price_now: v.price_now, low: v.per_share.low, base: v.per_share.base, high: v.per_share.high };
    if (v.g7 === "fail") {
      r.terminal = true;
      r.pending = false;
      r.first_fail_gate = "g7_price";
    }
  }

  for (const r of screen) {
    let lo = 0;
    let hi = 0;
    const unknownCriterions = [];
    for (const [id, s] of Object.entries(r.scores)) {
      if (s.state === "unknown") {
        unknownCriterions.push(id);
        hi += s.ptsHi;
      } else if (s.state === "na") {
        // nothing
      } else {
        lo += s.ptsLo;
        hi += s.ptsLo;
      }
    }
    r.lo = lo;
    r.hi = hi;
    r.unknown_criterions = unknownCriterions;
    r.unknown_gates = [
      "g4_moat(causal)",
      "g6_management",
      ...(r.g3?.state === "unknown" ? ["g3_earning_power"] : []),
      ...(r.g4?.state === "unknown" ? [`g4_moat(outcome)${r.g4.outcome === "pass" ? "_passed" : ""}`] : []),
      ...(r.g5?.state === "unknown" ? ["g5_survivability"] : []),
      ...(r.g7?.state === "unknown" ? ["g7_price"] : []),
    ];
  }

  screen.sort(
    (a, b) => b.lo - a.lo || b.hi - a.hi || (b.g4?.median_rontoa ?? -1e9) - (a.g4?.median_rontoa ?? -1e9) || (b.scores.S1?.median ?? -1e9) - (a.scores.S1?.median ?? -1e9) || a.ticker.localeCompare(b.ticker),
  );

  const scope = {};
  for (const cls of classification) scope[cls.model] = (scope[cls.model] || 0) + 1;

  const funnel = {};
  for (const r of screen) {
    if (r.terminal) funnel[r.first_fail_gate] = (funnel[r.first_fail_gate] || 0) + 1;
    else funnel.pending = (funnel.pending || 0) + 1;
  }

  const coverage = {};
  for (const r of screen) {
    for (const [id, s] of Object.entries(r.scores)) {
      coverage[id] = coverage[id] || { resolved: 0, unknown: 0, na: 0 };
      if (s.state === "unknown") coverage[id].unknown++;
      else if (s.state === "na") coverage[id].na++;
      else coverage[id].resolved++;
    }
  }

  const final = {
    run: { as_of: new Date().toISOString(), N: N_SHORTLIST, tie_break: TIE_BREAK },
    scope,
    funnel,
    coverage,
    evaluated_count: screen.length,
    pending_count: screen.filter((r) => r.pending).length,
    terminal_count: screen.filter((r) => r.terminal).length,
    ranked: screen.map((r) => ({
      ticker: r.ticker,
      cik: r.cik,
      name: r.name,
      sic: r.sic,
      lo: r.lo,
      hi: r.hi,
      terminal: r.terminal,
      first_fail_gate: r.first_fail_gate,
      pending: r.pending,
      unknown_gates: r.unknown_gates,
      unknown_criterions: r.unknown_criterions,
      g3: r.g3,
      g4: { outcome: r.g4.outcome, median_rontoa: r.g4.median_rontoa, min_rontoa: r.g4.min_rontoa, n_years: r.g4.n_years },
      g5: { state: r.g5.state, coverage_state: r.g5.coverage_state, debt_state: r.g5.debt_state, maturity_state: r.g5.maturity_state, debt_latest: r.g5.debt_latest, oep_median_3y: r.g5.oep_median_3y, debt_multiple: r.g5.debt_multiple },
      g7: r.g7 || null,
      scores: r.scores,
    })),
  };
  await writeJson(runId, "final.json", final);
  await writeJson(runId, "screen.json", screen);
  console.log("final.json written");
  console.log("scope:", JSON.stringify(scope));
  console.log("funnel:", JSON.stringify(funnel));
  console.log("coverage:", JSON.stringify(coverage));
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
