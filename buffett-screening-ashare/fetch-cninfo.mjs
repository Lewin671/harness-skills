// Fetch the cninfo announcement record and annual-report PDFs for a
// list of codes (the raw-filing and governance layer).
//
//   node fetch-cninfo.mjs --run 2026-08-15 600519 000002 300750
//   node fetch-cninfo.mjs --run 2026-08-15 --max-pages 15 002625
//   node fetch-cninfo.mjs --run 2026-08-15 --no-early-stop 002625
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
// much was dropped. Early stop fires only after TWO consecutive pages
// with zero matching rows (a single sparse page amid an interleaved
// record should not truncate); --no-early-stop disables it. The stop
// reason is recorded in the last page's meta, so a resume reproduces
// the same outcome; re-running with --no-early-stop resumes past a
// recorded pollution stop (raw pages are kept regardless).
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
  const earlyStop = !process.argv.includes("--no-early-stop");
  if (args.help || !args.positionals.length) {
    console.log("usage: node fetch-cninfo.mjs [--run <id>] [--years N] [--max-pages N] [--no-early-stop] [codes...]");
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
  if (!codes.length) {
    console.error("no 6-digit codes given");
    process.exit(1);
  }
  const seDate = `${Number(runId.slice(0, 4)) - windowYears}-01-01~${runId.slice(0, 10)}`;

  for (const code of codes) {
    // 1. announcement record over the window, titles only, pollution-guarded
    let page = 1;
    let matched = 0;
    let dropped = 0;
    let truncated = false;
    let stopReason = null;
    let consecutivePollution = 0;
    for (; page <= maxPages; page++) {
      const key = keyFor(["cninfo", code, `p${page}`]);
      let rec = await loadRaw(runId, key);
      if (rec) {
        // already fetched: reuse its per-page stats for the tally and honor
        // its recorded stop reason so a resume reproduces the same outcome —
        // unless --no-early-stop is given, which ignores a recorded pollution
        // stop and keeps fetching (the raw pages are kept regardless, so a
        // user can always resume past a stop by re-running with that flag).
        matched += rec.meta?.sec_matched ?? 0;
        dropped += rec.meta?.sec_dropped ?? 0;
        if (rec.meta?.stop_reason === "natural") break;
        if (rec.meta?.stop_reason === "budget" || (rec.meta?.stop_reason === "pollution" && earlyStop)) {
          truncated = true;
          stopReason = rec.meta.stop_reason;
          break;
        }
        if (rec.meta?.page_polluted) consecutivePollution++;
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
      const pagePolluted = pageMatched === 0 && pageDropped > 0;
      if (pagePolluted) consecutivePollution++;
      else consecutivePollution = 0;
      const total = body?.totalAnnouncement ?? 0;
      const pages = body?.totalpages ?? 0;
      // Decide the stop reason for THIS page before storing it, so the
      // stored meta is the single source of truth on resume.
      let thisStop = null;
      if (!total || page >= pages) thisStop = "natural";
      else if (earlyStop && consecutivePollution >= 2) thisStop = "pollution";
      else if (page >= maxPages) thisStop = "budget";
      await saveRaw(runId, key, {
        url: QUERY,
        body,
        meta: { stage: "cninfo", code, page, seDate, sec_matched: pageMatched, sec_dropped: pageDropped, page_polluted: pagePolluted, stop_reason: thisStop },
      });
      if (thisStop) {
        if (thisStop !== "natural") { truncated = true; stopReason = thisStop; }
        break;
      }
    }
    if (page > maxPages) { truncated = true; stopReason = "budget"; }
    const why = truncated ? ` (truncated: ${stopReason ?? "budget"})` : "";
    console.log(`  ${code}: ${matched} matched / ${dropped} dropped${why}`);

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
