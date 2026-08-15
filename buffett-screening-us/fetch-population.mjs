#!/usr/bin/env node
// Stage 1: fetch the S&P 500 constituent list and the SEC ticker->CIK
// map, join them, and persist the population with source URLs and fetch
// times. Also usable with any US ticker list — the join only needs the
// SEC map, and unmatched tickers are reported, never dropped silently.
//
//   node fetch-population.mjs --run 2026-08-15
//
// Writes, under runs/<runId>/:
//   raw/population__wikipedia.json      (constituent page, raw)
//   raw/population__sec_tickers.json    (ticker->CIK map, raw)
//   population.json                     (derived: one row per entity)
import { fetchText, saveRaw, loadRaw, writeJson, readJson, parseArgs } from "./lib/http.mjs";

const WIKI = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies";
const SEC_TICKERS = "https://www.sec.gov/files/company_tickers.json";

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ");
}

// The constituents table carries id="constituents" and 8 columns:
// Symbol, Security, GICS Sector, GICS Sub-Industry, HQ, Date added,
// CIK, Founded. A rowspan anywhere shifts cells silently — treat a
// non-standard cell count as a layout change and say so.
function parseWiki(html) {
  const table = html.match(/<table class="wikitable sortable[^"]*"[^>]*id="constituents"[^>]*>[\s\S]*?<\/table>/i);
  if (!table) throw new Error("constituents table not found - wikipedia layout changed?");
  const rows = [...table[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(1);
  const cells = (row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      decodeEntities(c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()));
  const out = [];
  for (const row of rows) {
    const c = cells(row);
    if (!c.length || !c[0]) continue;
    if (c.length !== 8) {
      console.error(`WARN row with ${c.length} cells (expected 8): ${c[0]} - layout changed? row kept but fields may be off`);
    }
    const sym = (c[0].match(/[A-Z][A-Z0-9.-]{0,6}/) || [""])[0];
    if (!sym || c.length < 2) continue;
    const cikM = c[6] ? c[6].match(/\d{5,10}/) : null;
    out.push({
      ticker: sym,
      name: c[1] || "",
      sector: c[2] || "",
      subindustry: c[3] || "",
      wiki_cik: cikM ? String(parseInt(cikM[0], 10)) : null,
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("usage: node fetch-population.mjs [--run <id>] [--min-ms N]");
    process.exit(0);
  }
  const runId = args.runId;

  // --- land raw pages (checkpointed) ---
  let wikiRec = await loadRaw(runId, "population__wikipedia");
  if (!wikiRec) {
    const html = await fetchText(WIKI, { host: "en.wikipedia.org" });
    wikiRec = { url: WIKI, body: html, meta: { stage: "population" } };
    await saveRaw(runId, "population__wikipedia", wikiRec);
  }
  let tickersRec = await loadRaw(runId, "population__sec_tickers");
  if (!tickersRec) {
    const text = await fetchText(SEC_TICKERS, { host: "www.sec.gov", headers: { "User-Agent": "harness-skills buffett-screening-us local-test@example.com" } });
    tickersRec = { url: SEC_TICKERS, body: JSON.parse(text), meta: { stage: "population" } };
    await saveRaw(runId, "population__sec_tickers", tickersRec);
  }

  const companies = parseWiki(wikiRec.body);
  console.log(`wikipedia: ${companies.length} constituents`);

  const tickers = tickersRec.body;
  const byTicker = new Map(Object.values(tickers).map((e) => [e.ticker, e]));
  console.log(`sec map: ${byTicker.size} tickers`);

  // SEC tickers use dashes, Wikipedia uses dots (BRK-B vs BRK.B).
  const norm = (s) => s.toUpperCase().replace(/\./g, "-");
  const matched = [];
  const unmatched = [];
  for (const c of companies) {
    const sec = byTicker.get(norm(c.ticker));
    if (sec) {
      matched.push({ ...c, cik: String(sec.cik_str), match: "sec", sec_title: sec.title });
    } else if (c.wiki_cik) {
      matched.push({ ...c, cik: c.wiki_cik, match: "wiki", sec_title: null });
    } else {
      unmatched.push(c);
    }
  }
  console.log(`matched: ${matched.length}, unmatched: ${unmatched.length}`);
  if (unmatched.length) console.log("UNMATCHED:", JSON.stringify(unmatched.map((u) => u.ticker), null, 1));

  await writeJson(runId, "population.json", {
    run: runId,
    fetched_at: new Date().toISOString(),
    sources: [
      { url: WIKI, fetched_at: wikiRec.fetched_at, note: "constituent membership source (convenience mirror; authoritative list is S&P's)" },
      { url: SEC_TICKERS, fetched_at: tickersRec.fetched_at, note: "ticker->CIK mapping" },
    ],
    counts: {
      total: matched.length,
      matched_sec: matched.filter((m) => m.match === "sec").length,
      matched_wiki: matched.filter((m) => m.match === "wiki").length,
      unmatched: unmatched.length,
    },
    companies: matched,
    unmatched,
  });
  void readJson;
  console.log("wrote population.json");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
