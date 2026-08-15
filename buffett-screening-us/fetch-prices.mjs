#!/usr/bin/env node
// Stage 6: price series for pending candidates from the Yahoo Finance
// chart API (no key), checkpointed per ticker. Prices needed on a date
// are the last close on or before it; a missing trade is `unknown`,
// never zero. (stooq is dead for automation — JS proof-of-work wall.)
//
//   node fetch-prices.mjs --run 2026-08-15
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, readJson, writeJson, parseArgs, throttle, sleep } from "./lib/http.mjs";
import { PRICE_LOOKBACK_START } from "./lib/frozen.mjs";

function parseYahoo(json) {
  const r = json.chart?.result?.[0];
  if (!r) return null;
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (v === null || v === undefined) continue;
    rows.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: v });
  }
  return rows;
}

function closeOnOrBefore(rows, dateISO) {
  const target = new Date(dateISO).getTime();
  let best = null;
  for (const r of rows) {
    const t = new Date(r.date + "T00:00:00Z").getTime();
    if (!isNaN(t) && t <= target) best = r;
  }
  return best;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("usage: node fetch-prices.mjs [--run <id>] [--min-ms N]");
    process.exit(0);
  }
  const runId = args.runId;
  const screen = await readJson(runId, "screen.json");
  const pending = screen.filter((r) => r.pending);
  console.log(`pending candidates to price: ${pending.length}`);

  const pricesDir = path.join(runDir(runId), "raw", "prices");
  await fs.mkdir(pricesDir, { recursive: true });
  const p1 = Math.floor(new Date(PRICE_LOOKBACK_START).getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000);

  const out = {};
  const manifest = [];
  for (const r of pending) {
    const sym = r.ticker.replace(/\./g, "-");
    const dest = path.join(pricesDir, `${sym}.yahoo.json`);
    let rows = null;
    try {
      rows = parseYahoo(JSON.parse(await fs.readFile(dest, "utf8")));
    } catch {}
    if (!rows) {
      let ok = false;
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`;
          await throttle("query1.finance.yahoo.com", args.minMs || 450);
          const res = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" },
            signal: AbortSignal.timeout(30000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.text();
          const json = JSON.parse(body);
          const parsed = parseYahoo(json);
          if (!parsed || !parsed.length) throw new Error("empty series");
          await fs.writeFile(dest, body);
          manifest.push({ ticker: r.ticker, url, fetched_at: new Date().toISOString(), bytes: body.length, attempt, source: "yahoo" });
          rows = parsed;
          ok = true;
        } catch (err) {
          console.error(`  retry ${r.ticker} (${err.message})`);
          await sleep(2000 * attempt);
        }
      }
      await sleep(args.minMs || 450);
    }
    out[r.ticker] = { fetched: !!rows, source: rows ? "yahoo" : null };
    if (rows) {
      const d = JSON.parse(await fs.readFile(path.join(runDir(runId), "derived", `${r.cik}.json`), "utf8"));
      const fys = d.fys;
      const start = fys[0].end;
      const end = fys[fys.length - 1].end;
      out[r.ticker] = {
        fetched: true,
        source: "yahoo",
        fy_start_end: start,
        fy_start_close: closeOnOrBefore(rows, start),
        fy_end: end,
        fy_end_close: closeOnOrBefore(rows, end),
        as_of_close: closeOnOrBefore(rows, new Date().toISOString().slice(0, 10)),
        rows: rows.length,
      };
    }
  }
  await writeJson(runId, "prices.json", out);
  await fs.writeFile(path.join(pricesDir, "manifest.json"), JSON.stringify(manifest, null, 1));
  const withData = Object.values(out).filter((o) => o.fetched && o.as_of_close).length;
  console.log(`prices for ${withData}/${pending.length} pending candidates`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
