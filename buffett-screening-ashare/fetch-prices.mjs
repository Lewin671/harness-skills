// Fetch daily price history for a list of codes from the Eastmoney
// history endpoint (the realtime host is unreliable from automation —
// see references/data-sources.md).
//
//   node fetch-prices.mjs --run 2026-08-15 600519 000002 300750
//
// Fetches both 前复权 (fqt=1, price gate) and 后复权 (fqt=2, the
// one-dollar test) series. Raw CSV bodies stored under
// <runId>/raw/price__<code>__<fqt>.txt. Suspended days are absent
// from the series — never zero, never interpolated.
import { fetchText, saveRaw, loadRaw, parseArgs, keyFor } from "./lib/http.mjs";

const BASE = "https://push2his.eastmoney.com/api/qt/stock/kline/get";

function marketPrefix(code) {
  return code.startsWith("6") ? "1" : "0";
}

function priceUrl(code, fqt, beg, end) {
  const q = new URLSearchParams({
    secid: `${marketPrefix(code)}.${code}`,
    fields1: "f1,f2,f3",
    fields2: "f51,f52,f53,f54,f55,f56",
    klt: "101",
    fqt: String(fqt),
    beg,
    end,
  });
  return `${BASE}?${q}`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.positionals.length) {
    console.log("usage: node fetch-prices.mjs [--run <id>] [--from YYYYMMDD] [codes...]");
    process.exit(args.help ? 0 : 1);
  }
  const runId = args.runId;
  const codes = args.positionals.filter((a) => !a.startsWith("--"));
  const begIdx = process.argv.indexOf("--from");
  const beg = begIdx > -1 ? process.argv[begIdx + 1] : `${Number(runId.slice(0, 4)) - 6}0101`;
  const end = `${runId.slice(0, 4)}${runId.slice(5, 7)}${runId.slice(8, 10)}`;

  for (const code of codes) {
    for (const fqt of [1, 2]) {
      const key = keyFor(["price", code, `fqt${fqt}`]);
      if (await loadRaw(runId, key)) continue;
      const url = priceUrl(code, fqt, beg, end);
      const body = await fetchText(url, {
        headers: { Referer: "https://quote.eastmoney.com/" },
        minMs: args.minMs,
        host: "push2his.eastmoney.com",
      });
      await saveRaw(runId, key, { url, body, meta: { stage: "price", code, fqt } });
    }
    console.log(`done ${code}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
