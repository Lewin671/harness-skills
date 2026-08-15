// Fetch the A-share population from the Eastmoney 业绩报表 table and
// merge listing dates from the company-profile table.
//
//   node fetch-population.mjs --run 2026-08-15
//
// Writes, under <runId>/:
//   raw/lico__<year>__<market>__p<page>.json   (raw pages)
//   raw/orginfo__p<page>.json                  (raw profile pages)
//   population.json                            (derived: one row per code)
//
// Universe rule (frozen): TRADE_MARKET_CODE in the three main-board /
// ChiNext codes, code prefix 60/00/30, name carries no ST marker.
// Risk-warning boards, NEEQ, BSE and B shares are excluded as a
// universe cut and counted for the report.
import {
  fetchJson,
  saveRaw,
  loadRaw,
  writeJson,
  parseArgs,
  fiscalYears,
  keyFor,
  EASTMONEY_REFERER,
} from "./lib/http.mjs";

const BASE = "https://datacenter-web.eastmoney.com/api/data/v1/get";

const MARKETS = [
  { code: "069001001001", name: "sh_main" }, // 上交所主板
  { code: "069001002001", name: "sz_main" }, // 深交所主板
  { code: "069001002002", name: "chinext" }, // 深交所创业板
];

const RISK_BOARDS = [
  { code: "069001001003", name: "sh_risk" },
  { code: "069001002005", name: "sz_risk" },
];

const LICO_COLUMNS = [
  "SECURITY_CODE",
  "SECURITY_NAME_ABBR",
  "TRADE_MARKET",
  "TRADE_MARKET_CODE",
  "DATATYPE",
  "TOTAL_OPERATE_INCOME",
  "PARENT_NETPROFIT",
  "BPS",
  "DEDUCT_BASIC_EPS",
  "MGJYXJJE",
  "NOTICE_DATE",
].join(",");

function licoUrl(year, marketCode, page) {
  const q = new URLSearchParams({
    reportName: "RPT_LICO_FN_CPD",
    columns: LICO_COLUMNS,
    filter: `(REPORTDATE='${year}-12-31')(TRADE_MARKET_CODE="${marketCode}")`,
    pageNumber: String(page),
    pageSize: "500",
    source: "WEB",
    client: "WEB",
  });
  return `${BASE}?${q}`;
}

function orginfoUrl(page) {
  const q = new URLSearchParams({
    reportName: "RPT_F10_BASIC_ORGINFO",
    columns: "SECURITY_CODE,LISTING_DATE,FORMERNAME,SECURITY_TYPE,TATOLNUMBER,ACCOUNTFIRM_NAME",
    pageNumber: String(page),
    pageSize: "500",
    source: "HSF10",
    client: "PC",
  });
  return `${BASE}?${q}`;
}

const isUniverse = (row) => {
  const code = row.SECURITY_CODE;
  const name = row.SECURITY_NAME_ABBR ?? "";
  const prefixOk = /^(60[0135]|00[0123]|30[01])/.test(code);
  const stFree = !/ST/.test(name);
  const inMarket = MARKETS.some((m) => m.code === row.TRADE_MARKET_CODE);
  return prefixOk && stFree && inMarket;
};

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("usage: node fetch-population.mjs [--run <id>] [--min-ms N]");
    process.exit(0);
  }
  const runId = args.runId;
  const asOf = `${runId}T08:00:00+08:00`;
  const years = fiscalYears(runId, 5, 1);

  // --- land raw pages (checkpointed per page) ---
  for (const year of years) {
    for (const m of MARKETS) {
      let page = 1;
      for (;;) {
        const key = keyFor(["lico", year, m.name, `p${page}`]);
        if (await loadRaw(runId, key)) {
          page++;
          continue;
        }
        const url = licoUrl(year, m.code, page);
        const body = await fetchJson(url, {
          headers: { Referer: EASTMONEY_REFERER },
          minMs: args.minMs,
          host: "datacenter-web.eastmoney.com",
        });
        await saveRaw(runId, key, { url, body, meta: { stage: "lico", year, market: m.name, page } });
        const res = body?.result;
        if (!res || !res.data || !res.data.length) break;
        if (page >= res.pages) break;
        page++;
      }
    }
  }

  // Risk-warning boards: one page each, for the excluded count.
  for (const rb of RISK_BOARDS) {
    const key = keyFor(["lico_risk", years[years.length - 1], rb.name]);
    if (!(await loadRaw(runId, key))) {
      const url = licoUrl(years[years.length - 1], rb.code, 1);
      const body = await fetchJson(url, {
        headers: { Referer: EASTMONEY_REFERER },
        minMs: args.minMs,
        host: "datacenter-web.eastmoney.com",
      });
      await saveRaw(runId, key, { url, body, meta: { stage: "lico_risk", name: rb.name } });
    }
  }

  // --- listing dates: batch over the profile table ---
  let orgPage = 1;
  for (;;) {
    const key = keyFor(["orginfo", `p${orgPage}`]);
    if (!(await loadRaw(runId, key))) {
      const url = orginfoUrl(orgPage);
      const body = await fetchJson(url, {
        headers: { Referer: EASTMONEY_REFERER },
        minMs: args.minMs,
        host: "datacenter-web.eastmoney.com",
      });
      await saveRaw(runId, key, { url, body, meta: { stage: "orginfo", page: orgPage } });
      const res = body?.result;
      if (!res || !res.data || !res.data.length || orgPage >= res.pages) break;
    }
    orgPage++;
  }

  console.log("raw pages landed; deriving population.json");
  await derive(runId, years, asOf);
}

async function derive(runId, years, asOf) {
  const byCode = new Map();

  for (const year of years) {
    for (const m of MARKETS) {
      let page = 1;
      for (;;) {
        const rec = await loadRaw(runId, keyFor(["lico", year, m.name, `p${page}`]));
        if (!rec) break;
        const rows = rec.body?.result?.data ?? [];
        for (const row of rows) {
          const code = row.SECURITY_CODE;
          if (!isUniverse(row)) continue;
          if (!byCode.has(code)) {
            byCode.set(code, { code, name: row.SECURITY_NAME_ABBR, board: m.name, market: row.TRADE_MARKET, years: {} });
          }
          byCode.get(code).years[year] = {
            revenue: row.TOTAL_OPERATE_INCOME,
            parent_profit: row.PARENT_NETPROFIT,
            bps: row.BPS,
            deduct_eps: row.DEDUCT_BASIC_EPS,
            ocf_ps: row.MGJYXJJE,
            notice_date: row.NOTICE_DATE,
          };
        }
        if (!rows.length) break;
        page++;
      }
    }
  }

  // merge listing dates
  let orgPage = 1;
  for (;;) {
    const rec = await loadRaw(runId, keyFor(["orginfo", `p${orgPage}`]));
    if (!rec) break;
    const rows = rec.body?.result?.data ?? [];
    for (const row of rows) {
      const c = byCode.get(row.SECURITY_CODE);
      if (c) {
        c.listing_date = row.LISTING_DATE?.slice(0, 10);
        c.former_name = row.FORMERNAME;
        c.security_type = row.SECURITY_TYPE;
        c.total_shares = row.TATOLNUMBER;
        c.auditor = row.ACCOUNTFIRM_NAME;
      }
    }
    if (!rows.length) break;
    orgPage++;
  }

  // risk-warning counts for the report
  const riskCounts = {};
  for (const rb of [{ name: "sh_risk" }, { name: "sz_risk" }]) {
    const rec = await loadRaw(runId, keyFor(["lico_risk", years[years.length - 1], rb.name]));
    const rows = rec?.body?.result?.data ?? [];
    riskCounts[rb.name] = rows.length;
  }

  const population = [...byCode.values()];
  const lastYear = years[years.length - 1];
  const listingAgeCutoff = `${Number(runId.slice(0, 4)) - 5}-${runId.slice(5, 10)}`;

  const stats = {
    as_of: asOf,
    total_rows_in_window: population.length,
    by_board: {},
    present_latest_year: population.filter((c) => c.years[lastYear]).length,
    listed_5y_before_asof: population.filter((c) => c.listing_date && c.listing_date <= listingAgeCutoff).length,
    risk_warning_excluded_first_page: riskCounts,
    years,
    note: "risk-warning counts are first-page samples; ST exclusion is enforced by market code and name",
  };
  for (const c of population) stats.by_board[c.board] = (stats.by_board[c.board] ?? 0) + 1;

  await writeJson(runId, "population.json", {
    run: runId,
    as_of: asOf,
    sources: [
      { url: BASE, note: "Eastmoney datacenter 业绩报表 RPT_LICO_FN_CPD + 公司概况 RPT_F10_BASIC_ORGINFO" },
    ],
    stats,
    companies: population.sort((a, b) => a.code.localeCompare(b.code)),
  });
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
