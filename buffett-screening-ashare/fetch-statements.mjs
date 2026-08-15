// Fetch the full CAS statements (balance, income, cashflow) for a list
// of companies from the Eastmoney F10 full-statement tables.
//
//   node fetch-statements.mjs --run 2026-08-15 600519 000002 300750
//   node fetch-statements.mjs --run 2026-08-15 --all --limit 50
//
// `--all` takes codes from population.json and REQUIRES --limit: the
// full population is ~4,400 codes x 6 years x 3 tables ≈ 79,000
// requests (~7 hours at default spacing) and must be a budgeted
// decision, not a typo. Checkpointing makes partial runs resumable.
//
// One request per (code, year, statement); raw bodies stored under
// runs/<runId>/raw/stmt__<code>__<year>__<table>.json. Checkpointed:
// re-running skips completed keys. Uses the annual report-type rows
// only — never quarterly rows, never row order.
import {
  fetchJson,
  saveRaw,
  loadRaw,
  readJson,
  parseArgs,
  fiscalYears,
  keyFor,
  EASTMONEY_REFERER,
} from "./lib/http.mjs";

const BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get";

const TABLES = ["RPT_F10_FINANCE_GBALANCE", "RPT_F10_FINANCE_GINCOME", "RPT_F10_FINANCE_GCASHFLOW"];

function stmtUrl(table, code, year) {
  const q = new URLSearchParams({
    reportName: table,
    columns: "ALL",
    filter: `(SECURITY_CODE="${code}")(REPORT_DATE='${year}-12-31')`,
    pageNumber: "1",
    pageSize: "5",
    source: "HSF10",
    client: "PC",
  });
  return `${BASE}?${q}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.positionals.length && !process.argv.includes("--all"))) {
    console.log("usage: node fetch-statements.mjs [--run <id>] [--all --limit N] [codes...]");
    process.exit(args.help ? 0 : 1);
  }
  const runId = args.runId;
  const years = fiscalYears(runId, 5, 1);

  const limitIdx = process.argv.indexOf("--limit");
  const limit = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) : null;
  const all = process.argv.includes("--all");

  let codes = args.positionals.filter((a) => !a.startsWith("--"));
  if (all) {
    if (!limit || !(limit > 0)) {
      throw new Error(
        "--all requires --limit N (full population ≈ 79,000 requests ≈ 7h at default spacing; budget it or name codes explicitly)",
      );
    }
    const pop = await readJson(runId, "population.json");
    codes = pop.companies.map((c) => c.code).slice(0, limit);
    console.log(`--all: first ${codes.length} of ${pop.companies.length} population codes (limit ${limit})`);
  }
  if (!codes.length) throw new Error("no codes given");

  let fetched = 0;
  for (const code of codes) {
    for (const year of years) {
      for (const table of TABLES) {
        const short = table.replace("RPT_F10_FINANCE_", "");
        const key = keyFor(["stmt", code, year, short]);
        if (await loadRaw(runId, key)) continue;
        const url = stmtUrl(table, code, year);
        const body = await fetchJson(url, {
          headers: { Referer: EASTMONEY_REFERER },
          minMs: args.minMs,
          host: "datacenter-web.eastmoney.com",
        });
        await saveRaw(runId, key, { url, body, meta: { stage: "stmt", code, year, table } });
        fetched++;
      }
    }
    console.log(`done ${code}`);
  }
  console.log(`fetched ${fetched} new statement records (${codes.length} codes x ${years.length} years x ${TABLES.length} tables)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
