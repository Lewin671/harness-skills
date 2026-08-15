#!/usr/bin/env node
// Stage 9: extract every number the report needs from final.json and
// valuations.json, so the report contains no hand-typed figure — the
// doctrine layer's rule against stale narrative numbers.
//
//   node report-data.mjs --run 2026-08-15
import { runDir, readJson, writeJson } from "./lib/http.mjs";

const b = (v, d = 1) => (typeof v === "number" ? (Math.abs(v) >= 1e9 ? (v / 1e9).toFixed(d) + "B" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(d) + "M" : v.toFixed(d)) : "—");
const pct = (v, d = 1) => (typeof v === "number" ? (v * 100).toFixed(d) + "%" : "—");

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node report-data.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const final = await readJson(runId, "final.json");
  const valuations = await readJson(runId, "valuations.json");

  const scopeRows = Object.entries(final.scope).map(([k, v]) => `| ${k} | ${v} |`).join("\n");
  const funnelRows = Object.entries(final.funnel).map(([k, v]) => `| ${k} | ${v} |`).join("\n");
  const coverageRows = Object.entries(final.coverage)
    .map(([k, v]) => `| ${k} | ${v.resolved} | ${v.unknown} | ${v.na} |`)
    .join("\n");

  const pending = final.ranked.filter((r) => r.pending);
  const topN = pending.slice(0, final.run.N);
  const tableHeader = "| # | Ticker | lo | hi | RONTOA med | ROE med | OEP conv | 1$ test | unresolved gates beyond moat-causal/management |";
  const tableRows = topN
    .map((r, i) => {
      const s = r.scores;
      const cells = [
        i + 1,
        r.ticker,
        r.lo,
        r.hi,
        pct(r.g4.median_rontoa, 0),
        pct(s.S1.median, 0),
        s.S3.state === "unknown" ? "?" : s.S3.ratio !== undefined ? s.S3.ratio.toFixed(2) : s.S3.denom ? "denom≤0" : "?",
        s.S7.state === "unknown" ? "?" : s.S7.ratio !== undefined ? s.S7.ratio.toFixed(2) : "ret≤0",
        r.unknown_gates.filter((g) => !g.startsWith("g4_moat(causal)") && g !== "g6_management").join(", ") || "—",
      ];
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");

  const valRows = valuations
    .filter((v) => v.state === "valued")
    .map(
      (v) =>
        `| ${v.ticker} | ${v.price_now.toFixed(2)} | ${v.per_share.low.toFixed(0)} / ${v.per_share.base.toFixed(0)} / ${v.per_share.high.toFixed(0)} | ${pct(v.margin)} | ${v.g7} | ${pct(v.maint_pct.base)} / ${pct(v.maint_pct.high)} / ${v.maint_pct.low === null ? "default" : pct(v.maint_pct.low)} | ${v.maint_basis || v.maint_source} |`,
    )
    .join("\n");

  const byC = { g3_earning_power: 0, g4_moat: 0, g5_survivability: 0, g7_price: 0 };
  for (const r of final.ranked) if (r.terminal) byC[r.first_fail_gate] = (byC[r.first_fail_gate] || 0) + 1;

  const report = {
    scope_rows: scopeRows,
    funnel_rows: funnelRows,
    coverage_rows: coverageRows,
    table_header: tableHeader,
    table_rows: tableRows,
    val_rows: valRows,
    counts: {
      ordinary: final.scope.ordinary_nonfinancial,
      evaluated: final.evaluated_count,
      pending: final.pending_count,
      terminal: final.terminal_count,
      g3_fail: byC.g3_earning_power || 0,
      g4_fail: byC.g4_moat || 0,
      g5_fail: byC.g5_survivability || 0,
      g7_fail: byC.g7_price || 0,
    },
  };
  await writeJson(runId, "report-data.json", report);
  console.log(JSON.stringify(report.counts, null, 1));
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
