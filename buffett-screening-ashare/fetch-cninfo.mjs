// Fetch the cninfo announcement record and annual-report PDFs for a
// list of codes (the raw-filing and governance layer).
//
//   node fetch-cninfo.mjs --run 2026-08-15 600519 000002 300750
//
// For each code: the full announcement record over the window (titles
// only, for governance keyword classification) and the latest annual
// report PDF. Raw bodies stored under runs/<runId>/raw/:
//   cninfo__<code>__p<page>.json   (announcement query pages)
//   cninfo__<code>__<id>.pdf       (annual report, if found)
//
// Recipe (verified): searchkey=<code> works for both exchanges; the
// Shenzhen stock= parameter does not. column=sse for 6xxxxx, szse
// otherwise.
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
    console.log("usage: node fetch-cninfo.mjs [--run <id>] [--years N] [codes...]");
    process.exit(args.help ? 0 : 1);
  }
  const runId = args.runId;
  const codes = args.positionals.filter((a) => !a.startsWith("--"));
  const yearsIdx = process.argv.indexOf("--years");
  const windowYears = yearsIdx > -1 ? Number(process.argv[yearsIdx + 1]) : 6;
  const seDate = `${Number(runId.slice(0, 4)) - windowYears}-01-01~${runId.slice(0, 10)}`;

  for (const code of codes) {
    // 1. full announcement record over the window, titles only
    let page = 1;
    for (;;) {
      const key = keyFor(["cninfo", code, `p${page}`]);
      if (await loadRaw(runId, key)) {
        page++;
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
      await saveRaw(runId, key, { url: QUERY, body, meta: { stage: "cninfo", code, page, seDate } });
      const total = body?.totalAnnouncement ?? 0;
      const pages = body?.totalpages ?? 0;
      if (!total || page >= pages) break;
      page++;
    }

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
