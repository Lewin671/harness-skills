#!/usr/bin/env node
// Stage 5: hard gates 3-5 and scored criteria S1-S7 (S7 deferred to the
// price stage) over the ordinary_nonfinancial population. Four-state
// verdicts; fail/na are terminal with the first gate recorded; unknown
// is pending and blocks admission.
//
//   node screen.mjs --run 2026-08-15
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, readJson, writeJson } from "./lib/http.mjs";
import { G3, G4, G5, SCORED, NORMALIZED_TAX_RATE, WINDOW } from "./lib/frozen.mjs";

const NFY = WINDOW.fy_count;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const avg = (a, b) => (num(a) !== null && num(b) !== null ? (a + b) / 2 : null);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

const grossDebt = (f) => num(f.fields.gross_debt);
const ntoa = (f) => num(f.fields.ntoa);
const oep = (f) => num(f.fields.oep);

function ebit(f) {
  const op = num(f.fields.operating_income);
  if (op !== null) return op;
  const pt = num(f.fields.pretax_continuing);
  const ie = num(f.fields.interest_expense);
  if (pt !== null && ie !== null) return pt + ie;
  return null;
}
function cashInterest(f) {
  const paid = num(f.fields.interest_paid);
  if (paid !== null) return Math.abs(paid);
  const exp = num(f.fields.interest_expense);
  return exp !== null ? Math.abs(exp) : null;
}

function screenCompany(d) {
  const fys = d.fys;
  const Y = fys.slice(-NFY);
  const prior = fys[-(NFY + 1)] || null;
  const F = (y, k) => num(y.fields[k]);

  const r = { cik: d.cik, ticker: d.ticker, name: d.name, sic: d.sic };
  const shortHistory = Y.length < NFY;

  // ---------- G3 earning power ----------
  const pretax = Y.map((y) => F(y, "pretax_continuing"));
  const g3Missing = shortHistory || pretax.some((p) => p === null);
  const last5Pos = pretax.slice(-5).every((p) => p !== null && p > 0);
  const posCount = pretax.filter((p) => p !== null && p > 0).length;
  r.g3 = {
    state: g3Missing ? "unknown" : last5Pos && posCount >= G3.min_positive_of_10 ? "pass" : "fail",
    last5_all_positive: last5Pos,
    positive_of_10: posCount,
    missing_year: g3Missing,
  };

  // ---------- EBIT / NOPAT / NTOA / RONTOA ----------
  const ebits = Y.map(ebit);
  const nopats = ebits.map((e) => (e === null ? null : e * (1 - NORMALIZED_TAX_RATE)));
  const ntoas = Y.map(ntoa);
  const avgNtoa = Y.map((y, i) => {
    const prevY = i === 0 ? prior : Y[i - 1];
    return prevY ? avg(ntoa(y), ntoa(prevY)) : null;
  });
  const rontoa = Y.map((y, i) => (nopats[i] === null || avgNtoa[i] === null || avgNtoa[i] <= 0 ? null : nopats[i] / avgNtoa[i]));
  const rontoaAvail = rontoa.filter((x) => x !== null);
  const rontoaMedian = rontoaAvail.length ? median(rontoaAvail) : null;

  // ---------- G4 moat ----------
  const outcome =
    rontoaMedian === null || rontoaAvail.length < G4.min_years
      ? "unknown"
      : rontoaMedian < G4.ron_toa_fail_median
        ? "fail"
        : rontoaMedian >= G4.ron_toa_pass_median && rontoaAvail.every((x) => x > 0)
          ? "pass"
          : "unknown";
  r.g4 = {
    outcome,
    state: outcome === "fail" ? "fail" : "unknown", // causal half always unknown this run
    causal_half: "unknown (no automated source in this run)",
    median_rontoa: rontoaMedian,
    min_rontoa: rontoaAvail.length ? Math.min(...rontoaAvail) : null,
    n_years: rontoaAvail.length,
  };

  // ---------- G5 survivability ----------
  const g5 = { coverage: [], coverage_state: "unknown", debt_state: "unknown", maturity_state: "unknown", state: "unknown" };
  for (const y of Y.slice(-G5.coverage_years)) {
    const debt = grossDebt(y);
    const ci = cashInterest(y);
    const eb = ebit(y);
    let s;
    if (debt === null || ci === null) s = { y: y.end, state: "unknown" };
    else if (debt === 0 && ci === 0) s = { y: y.end, state: "pass_zero_debt" };
    else if (ci > 0 && eb === null) s = { y: y.end, state: "unknown" };
    else if (ci > 0 && eb <= 0) s = { y: y.end, state: "fail", cov: eb / ci };
    else if (ci > 0 && Math.abs(eb) / ci >= G5.coverage_min) s = { y: y.end, state: "pass", cov: Math.abs(eb) / ci };
    else if (ci > 0) s = { y: y.end, state: "fail", cov: Math.abs(eb) / ci };
    else s = { y: y.end, state: "unknown" };
    g5.coverage.push(s);
  }
  g5.coverage_state = g5.coverage.some((c) => c.state === "fail") ? "fail" : g5.coverage.some((c) => c.state === "unknown") ? "unknown" : "pass";

  const debtLatest = grossDebt(Y[Y.length - 1]);
  const oeps3 = Y.slice(-3).map(oep);
  const oepMedian = oeps3.every((o) => o !== null) ? median(oeps3) : null;
  if (debtLatest === null || oepMedian === null) g5.debt_state = "unknown";
  else if (debtLatest === 0) {
    g5.debt_state = "pass_zero_debt";
    g5.debt_multiple = 0;
  } else if (oepMedian <= 0) g5.debt_state = "fail";
  else {
    g5.debt_multiple = debtLatest / oepMedian;
    g5.debt_state = g5.debt_multiple <= G5.debt_max_multiple ? "pass" : "fail";
  }
  g5.oep_median_3y = oepMedian;
  g5.debt_latest = debtLatest;

  const mat = num(F(Y[Y.length - 1], "maturities_12m"));
  const cash = num(F(Y[Y.length - 1], "cash"));
  if (debtLatest === null) g5.maturity_state = "unknown";
  else if (debtLatest === 0) g5.maturity_state = "pass_zero_debt";
  else if (mat === null) g5.maturity_state = "unknown";
  else if (mat <= G5.maturity_pct * debtLatest) g5.maturity_state = "pass";
  else if (cash !== null && cash >= mat) g5.maturity_state = "pass_cash_cover";
  else g5.maturity_state = "unknown"; // committed facilities undisclosed in XBRL
  g5.maturities_12m = mat;
  g5.state =
    g5.coverage_state === "fail" || g5.debt_state === "fail"
      ? "fail"
      : g5.coverage_state === "unknown" || g5.debt_state === "unknown" || g5.maturity_state === "unknown"
        ? "unknown"
        : "pass";
  r.g5 = g5;

  // ---------- gate verdicts ----------
  const gates = [r.g3, r.g4, r.g5];
  const firstFail = gates.find((g) => g.state === "fail");
  r.first_fail_gate = firstFail ? (firstFail === r.g3 ? "g3_earning_power" : firstFail === r.g4 ? "g4_moat" : "g5_survivability") : null;
  r.terminal = !!firstFail;
  r.pending = !firstFail;

  // ---------- scored criteria ----------
  const sc = {};
  const crit = (state, ptsLo, ptsHi, detail) => ({ state, ptsLo, ptsHi, ...detail });

  // S1 ROE
  const roes = Y.map((y, i) => {
    const prevY = i === 0 ? prior : Y[i - 1];
    if (!prevY) return null;
    const eq = avg(F(y, "equity"), F(prevY, "equity"));
    if (eq === null) return null;
    if (eq <= 0) return { na: true };
    const ni = F(y, "net_income_common") ?? F(y, "net_income");
    return ni === null ? null : { v: ni / eq };
  });
  const roeAvail = roes.filter((x) => x && !x.na && x.v !== null).map((x) => x.v);
  const roeNaCount = roes.filter((x) => x && x.na).length;
  if (roeAvail.length < 5) sc.S1 = crit("unknown", 0, 2, {});
  else {
    const m = median(roeAvail);
    const pts = m >= 0.15 ? 2 : m >= 0.10 ? 1 : 0;
    sc.S1 = crit(pts > 0 ? "pass" : "fail", pts, pts, { median: m, min: Math.min(...roeAvail), dispersion: Math.max(...roeAvail) - Math.min(...roeAvail), na_years: roeNaCount });
  }

  // S2 moat depth
  if (rontoaMedian === null) sc.S2 = crit("unknown", 0, 4, {});
  else {
    const pts = rontoaMedian >= 0.18 ? 4 : rontoaMedian >= 0.12 ? 3 : rontoaMedian >= 0.08 ? 1 : 0;
    sc.S2 = crit(pts > 0 ? "pass" : "fail", pts, pts, { median_rontoa: rontoaMedian });
  }

  // S3 OEP conversion (5y cumulative)
  const last5y = Y.slice(-5);
  const oepAll = last5y.map(oep);
  const niAll = last5y.map((y) => num(F(y, "net_income")));
  if (oepAll.some((o) => o === null) || niAll.some((n) => n === null)) sc.S3 = crit("unknown", 0, 2, {});
  else {
    const denom = sum(niAll);
    if (denom <= 0) sc.S3 = crit("fail", 0, 0, { denom });
    else {
      const ratio = sum(oepAll) / denom;
      const pts = ratio >= 1.0 ? 2 : ratio >= 0.7 ? 1 : 0;
      sc.S3 = crit(pts > 0 ? "pass" : "fail", pts, pts, { ratio });
    }
  }

  // S4 incremental ROIC (5y windows)
  const win = (a, b) => {
    const n = nopats.slice(a, b).filter((x) => x !== null);
    const c = avgNtoa.slice(a, b).filter((x) => x !== null);
    return n.length >= 3 && c.length >= 3 ? { n: sum(n) / n.length, c: sum(c) / c.length } : null;
  };
  const older = win(5, 10);
  const newer = win(0, 5);
  if (!older || !newer) sc.S4 = crit("unknown", 0, 2, {});
  else if (newer.c - older.c <= 0) sc.S4 = crit("na", 0, 0, {});
  else {
    const inc = (newer.n - older.n) / (newer.c - older.c);
    const pts = inc >= 0.12 ? 2 : 0;
    sc.S4 = crit(pts > 0 ? "pass" : "fail", pts, pts, { incremental_roic: inc });
  }

  // S5 conservatism beyond survival
  if (debtLatest === null || oepMedian === null) sc.S5 = crit("unknown", 0, 1, {});
  else if (debtLatest === 0) sc.S5 = crit("pass", 1, 1, { debt_oep: 0 });
  else if (oepMedian <= 0) sc.S5 = crit("fail", 0, 0, { debt_oep: Infinity });
  else {
    const ratio = debtLatest / oepMedian;
    const pts = ratio <= 1.5 ? 1 : 0;
    sc.S5 = crit(pts ? "pass" : "fail", pts, pts, { debt_oep: ratio });
  }

  // S6 share-count stewardship: two independent sub-points
  const s6a = (() => {
    if (shortHistory) return { state: "unknown", ptsLo: 0, ptsHi: 2 };
    const sh0 = num(F(Y[0], "diluted_shares"));
    const sh9 = num(F(Y[9], "diluted_shares"));
    if (sh0 === null || sh9 === null) return { state: "unknown", ptsLo: 0, ptsHi: 2 };
    const cagr = Math.pow(sh9 / sh0, 1 / 9) - 1;
    const pts = cagr <= 0 ? 2 : cagr <= 0.01 ? 1 : 0;
    return { state: "settled", ptsLo: pts, ptsHi: pts, cagr };
  })();
  const s6b = (() => {
    if (shortHistory) return { state: "unknown", ptsLo: 0, ptsHi: 1 };
    const sc0 = num(F(Y[9], "stock_comp"));
    const oep0 = oep(Y[9]);
    if (sc0 === null || oep0 === null) return { state: "unknown", ptsLo: 0, ptsHi: 1 };
    const ratio = sc0 / oep0;
    const ok = ratio <= 0.05;
    return { state: "settled", ptsLo: ok ? 1 : 0, ptsHi: ok ? 1 : 0, stock_comp_oep: ratio };
  })();
  sc.S6 = {
    state: s6a.state === "unknown" || s6b.state === "unknown" ? "unknown" : s6a.ptsLo + s6b.ptsLo > 0 ? "pass" : "fail",
    ptsLo: s6a.ptsLo + s6b.ptsLo,
    ptsHi: s6a.ptsHi + s6b.ptsHi,
    cagr: s6a.cagr,
    stock_comp_oep: s6b.stock_comp_oep,
  };

  // S7 one-dollar test: deferred to the price stage
  sc.S7 = crit("unknown", 0, 2, { deferred: "prices" });
  // S8 management: unknown by policy
  sc.S8 = crit("unknown", 0, 3, {});
  // S9 discount to value: deferred to the valuation stage
  sc.S9 = crit("unknown", 0, 4, { deferred: "valuation" });

  let lo = 0;
  let hi = 0;
  const unknownCriterions = [];
  for (const [id, s] of Object.entries(sc)) {
    if (s.state === "unknown") {
      unknownCriterions.push(id);
      hi += s.ptsHi;
    } else if (s.state === "na") {
      // adds nothing
    } else {
      lo += s.ptsLo;
      hi += s.ptsLo;
    }
  }
  r.scores = sc;
  r.lo = lo;
  r.hi = hi;
  r.unknown_criterions = unknownCriterions;
  r.rontoa = rontoa;
  r.roe_series = roeAvail;
  return r;
}

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node screen.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const classification = new Map(
    (await readJson(runId, "classification.json")).map((o) => [o.cik, o]),
  );
  const derivedDir = path.join(runDir(runId), "derived");
  const results = [];
  for (const file of await fs.readdir(derivedDir)) {
    if (!file.endsWith(".json")) continue;
    const d = JSON.parse(await fs.readFile(path.join(derivedDir, file), "utf8"));
    const cls = classification.get(d.cik);
    if (!cls || cls.model !== "ordinary_nonfinancial") continue;
    results.push(screenCompany(d));
  }
  await writeJson(runId, "screen.json", results);

  const funnel = {};
  const pendingList = [];
  for (const r of results) {
    if (r.terminal) funnel[r.first_fail_gate] = (funnel[r.first_fail_gate] || 0) + 1;
    else {
      pendingList.push(r);
      funnel.pending = (funnel.pending || 0) + 1;
    }
  }
  const scope = {};
  for (const [, cls] of classification) scope[cls.model] = (scope[cls.model] || 0) + 1;
  console.log("scope:", scope);
  console.log("funnel:", funnel);
  const top = [...pendingList].sort(
    (a, b) => b.lo - a.lo || b.hi - a.hi || (b.g4.median_rontoa ?? -1e9) - (a.g4.median_rontoa ?? -1e9) || (b.scores.S1.median ?? -1e9) - (a.scores.S1.median ?? -1e9) || a.ticker.localeCompare(b.ticker),
  );
  for (const t of top.slice(0, 10)) {
    console.log(t.ticker.padEnd(8), "lo=" + t.lo, "hi=" + t.hi, "RONTOA=" + (t.g4.median_rontoa === null ? "?" : t.g4.median_rontoa.toFixed(3)));
  }
  void SCORED;
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
