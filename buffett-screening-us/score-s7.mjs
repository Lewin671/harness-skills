#!/usr/bin/env node
// Stage 6b: one-dollar test (S7) once prices exist. Window = 10 FYs
// between fys[0] (prior year end) and fys[10] (latest). Folds into
// screen.json and recomputes lo/hi.
//
//   node score-s7.mjs --run 2026-08-15
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, readJson, writeJson } from "./lib/http.mjs";

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const mag = (v) => (typeof v === "number" ? Math.abs(v) : null);

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node score-s7.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const screen = await readJson(runId, "screen.json");
  const prices = await readJson(runId, "prices.json");

  for (const r of screen) {
    if (!r.pending) continue;
    const p = prices[r.ticker];
    if (!p || !p.fetched || !p.fy_start_close || !p.fy_end_close) {
      r.scores.S7 = { state: "unknown", ptsLo: 0, ptsHi: 2, reason: "price data missing" };
      continue;
    }
    const d = JSON.parse(await fs.readFile(path.join(runDir(runId), "derived", `${r.cik}.json`), "utf8"));
    const fys = d.fys;
    if (fys.length < 11) {
      r.scores.S7 = { state: "unknown", ptsLo: 0, ptsHi: 2, reason: `only ${fys.length} FYs` };
      continue;
    }
    const win = fys.slice(1, 11);
    const F = (y, k) => (typeof y.fields[k] === "number" ? y.fields[k] : null);
    const ni = win.map((y) => F(y, "net_income_common") ?? F(y, "net_income"));
    const div = win.map((y) => mag(F(y, "dividends")));
    const rep = win.map((y) => mag(F(y, "repurchases")));
    const iss = win.map((y) => mag(F(y, "issuance")));
    if (ni.some((x) => x === null) || div.some((x) => x === null) || rep.some((x) => x === null) || iss.some((x) => x === null)) {
      r.scores.S7 = { state: "unknown", ptsLo: 0, ptsHi: 2, reason: "missing distribution/issuance series" };
      continue;
    }
    const retained = sum(ni) - sum(div) - sum(rep);
    if (retained <= 0) {
      r.scores.S7 = { state: "fail", ptsLo: 0, ptsHi: 0, retained, note: "retained capital <= 0" };
      continue;
    }
    const sh0 = F(fys[0], "shares_outstanding");
    const sh10 = F(fys[10], "shares_outstanding");
    if (sh0 === null || sh10 === null) {
      r.scores.S7 = { state: "unknown", ptsLo: 0, ptsHi: 2, reason: "shares outstanding missing" };
      continue;
    }
    const mc0 = sh0 * p.fy_start_close.close;
    const mc1 = sh10 * p.fy_end_close.close;
    const valueCreated = mc1 - mc0 - sum(iss);
    const test = valueCreated / retained;
    const pts = test >= 1.0 ? 2 : test >= 0.7 ? 1 : 0;
    r.scores.S7 = {
      state: pts > 0 ? "pass" : "fail",
      ptsLo: pts,
      ptsHi: pts,
      value_created: valueCreated,
      retained,
      ratio: test,
      mc_start: mc0,
      mc_end: mc1,
    };
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
  }
  await writeJson(runId, "screen.json", screen);
  console.log("S7 folded in; screen.json updated");
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
