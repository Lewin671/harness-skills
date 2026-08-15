#!/usr/bin/env node
// Stage 7b: locate each valuation candidate's latest 10-K accession and
// primary document URL from the stored submissions.json, for the
// maintenance-capex adjudication in references/governance.md.
//
//   node fetch-10k-list.mjs --run 2026-08-15
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, readJson, writeJson } from "./lib/http.mjs";

async function main() {
  const args = parseArgsFrom(process.argv);
  if (args.help) {
    console.log("usage: node fetch-10k-list.mjs --run <id>");
    process.exit(0);
  }
  const runId = args.runId;
  const valuations = await readJson(runId, "valuations.json");
  const out = [];
  for (const v of valuations) {
    const subs = JSON.parse(await fs.readFile(path.join(runDir(runId), "raw", v.cik, "submissions.json"), "utf8"));
    const recent = subs.filings?.recent || { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] };
    let idx = -1;
    for (let i = 0; i < recent.form.length; i++) {
      if (["10-K", "10-K/A"].includes(recent.form[i])) {
        idx = i;
        break;
      }
    }
    if (idx < 0) {
      out.push({ ticker: v.ticker, cik: v.cik, error: "no 10-K in recent" });
      continue;
    }
    const acc = recent.accessionNumber[idx].replace(/-/g, "");
    out.push({
      ticker: v.ticker,
      cik: v.cik,
      accession: recent.accessionNumber[idx],
      filing_date: recent.filingDate[idx],
      report_date: recent.reportDate[idx],
      url: `https://www.sec.gov/Archives/edgar/data/${parseInt(v.cik, 10)}/${acc}/${recent.primaryDocument[idx]}`,
    });
  }
  await writeJson(runId, "tenk-locations.json", out);
  console.log(`located ${out.filter((o) => !o.error).length}/${out.length} latest 10-Ks`);
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
