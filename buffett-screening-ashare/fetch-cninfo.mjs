// Fetch the cninfo announcement record and annual-report PDFs for a
// list of codes (the raw-filing and governance layer).
//
//   node fetch-cninfo.mjs --run 2026-08-15 600519 000002 300750
//   node fetch-cninfo.mjs --run 2026-08-15 --max-pages 15 002625
//
// For each code: the full announcement record over the window (titles
// only, for governance keyword classification) and the latest annual
// report PDF. Raw bodies stored under <runId>/raw/:
//   cninfo__<code>__p<page>.json   (announcement query pages)
//   cninfo__<code>__<id>.pdf       (annual report, if found)
//
// Recipe (verified): searchkey=<code> works for both exchanges; the
// Shenzhen stock= parameter does not. column=sse for 6xxxxx, szse
// otherwise.
//
// Pollution guard (verified 2026-08-15): searchkey + fulltext is a
// full-text search, NOT a per-company filter — 002625 returned ~5,600
// announcements including other companies' (鹏鼎控股, 中电科芯片).
// Two controls: (1) --max-pages caps the announcement-record pages per
// code so an announcement-heavy company cannot blow the work budget
// (default 30 pages = 900 rows, far beyond a normal 6-year record);
// (2) every stored page records secCode-match counts in meta so the
// governance pass can drop polluted rows and the report can show how
// much was dropped. A page with zero rows whose secCode matches the
// target is treated as pollution and stops the record early.
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  fetchJson,
  fetchBuffer,
  saveRaw,
  loadRaw,
  runDir,
  parseArgs,
  keyFor,
  CNINFO_REFERER,
} from "./lib/http.mjs";

const QUERY = "http://www.cninfo.com.cn/new/hisAnnouncement/query";
const PDF = "https://static.cninfo.com.cn/";
const DEFAULT_MAX_PAGES = 30;

function columnFor(code) {
  return code.startsWith("6") ? "sse" : "szse";
}

function form(code, page, category, seDate) {
  return new URLSearchParams({
    pageNum: String(page),
    pageSize: "30",
    column: columnFor(code),
    tabName: "fulltext",
    plate: "",
    stock: "",
    searchkey: code,
    secid: "",
    category: category ?? "",
    trade: "",
    seDate: seDate ?? "",
    sortName: "",
    sortType: "",
    isHLtitle: "true",
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.positionals.length) {
    console.log("usage: node fetch-cninfo.mjs [--run <id>] [--years N] [--max-pages N] [codes...]");
    process.exit(args.help ? 0 : 1);
  }
  const runId = args.runId;
  const maxIdx = process.argv.indexOf("--max-pages");
  const maxPages = maxIdx > -1 ? Number(process.argv[maxIdx + 1]) : DEFAULT_MAX_PAGES;
  if (!(maxPages > 0)) throw new Error("--max-pages must be a positive integer");
  const yearsIdx = process.argv.indexOf("--years");
  const windowYears = yearsIdx > -1 ? Number(process.argv[yearsIdx + 1]) : 6;
  // positionals include "--max-pages"/"--years" and their values; keep only
  // bare codes (6-digit) so option values never leak into the code list.
  const codes = args.positionals.filter((a) => /^\d{6}$/.test(a));
  const seDate = `${Number(runId.slice(0, 4)) - windowYears}-01-01~${runId.slice(0, 10)}`;

  for (const code of codes) {
    // 1. announcement record over the window, titles only, pollution-guarded
    let page = 1;
    let matched = 0;
    let dropped = 0;
    let truncated = false;
    for (; page <= maxPages; page++) {
      const key = keyFor(["cninfo", code, `p${page}`]);
      if (await loadRaw(runId, key)) {
        // already fetched: reuse its pollution stats for the tally
        const rec = await loadRaw(runId, key);
        matched += rec.meta?.sec_matched ?? 0;
        dropped += rec.meta?.sec_dropped ?? 0;
        if (rec.meta?.record_ended) break;
        continue;
      }
      const body = await fetchJson(QUERY, {
        method: "POST",
        headers: {
          Referer: CNINFO_REFERER,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form(code, page, null, seDate),
        minMs: args.minMs,
        host: "www.cninfo.com.cn",
      });
      const anns = body?.announcements ?? [];
      const pageMatched = anns.filter((a) => String(a.secCode ?? "") === code).length;
      const pageDropped = anns.length - pageMatched;
      matched += pageMatched;
      dropped += pageDropped;
      const recordEnded = !pageMatched && pageDropped > 0 && page > 1;
      await saveRaw(runId, key, {
        url: QUERY,
        body,
        meta: { stage: "cninfo", code, page, seDate, sec_matched: pageMatched, sec_dropped: pageDropped, record_ended: recordEnded },
      });
      const total = body?.totalAnnouncement ?? 0;
      const pages = body?.totalpages ?? 0;
      if (!total || page >= pages) break;
      if (recordEnded) { truncated = true; break; } // pure-pollution page: stop early
      if (page >= maxPages) { truncated = true; break; } // budget cap
    }
    if (page > maxPages) truncated = true;
    console.log(`  ${code}: ${matched} matched / ${dropped} dropped${truncated ? " (record truncated by budget or pollution)" : ""}`);

    // 2. latest annual report PDF (category filter, first hit wins)
    const key = keyFor(["cninfo_ar", code]);
    if (!(await loadRaw(runId, key))) {
      const body = await fetchJson(QUERY, {
        method: "POST",
        headers: {
          Referer: CNINFO_REFERER,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form(code, 1, "category_ndbg_szsh", seDate),
        minMs: args.minMs,
        host: "www.cninfo.com.cn",
      });
      await saveRaw(runId, key, { url: QUERY, body, meta: { stage: "cninfo_ar", code } });
      const anns = body?.announcements ?? [];
      const ar = anns.find((a) => /年度报告(摘要)?$/.test(a.announcementTitle) && !/英文|摘要/.test(a.announcementTitle)) ?? anns[0];
      if (ar?.adjunctUrl) {
        const pdfUrl = PDF + ar.adjunctUrl;
        const pdfKey = keyFor(["cninfo", code, String(ar.announcementId ?? "latest")]);
        if (!(await loadRaw(runId, pdfKey))) {
          const pdf = await fetchBuffer(pdfUrl, {
            headers: { Referer: CNINFO_REFERER },
            minMs: args.minMs,
            host: "static.cninfo.com.cn",
          });
          const file = path.join(runDir(runId), "raw", `${pdfKey}.pdf`);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, pdf);
          await saveRaw(runId, pdfKey, {
            url: pdfUrl,
            body: { stored_as: `${pdfKey}.pdf`, bytes: pdf.length, title: ar.announcementTitle },
            meta: { stage: "cninfo_pdf", code },
          });
          console.log(`  pdf ${pdfKey}.pdf (${pdf.length} bytes)`);
        }
      }
    }
    console.log(`done ${code}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
