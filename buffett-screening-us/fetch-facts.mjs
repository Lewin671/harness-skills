#!/usr/bin/env node
// Stage 2: fetch SEC submissions.json + companyfacts.json per CIK.
// Stores the raw bodies under <runId>/raw/<cik>/, plus a
// fetch-manifest with URL, fetch time, bytes and sha256 per request.
// Polite rate ~4 req/s (SEC asks <= 10/s), exponential backoff on
// retry, checkpointed per (CIK, file) so a killed run resumes.
// Merges ALT_CIKS old-CIK companyfacts as a secondary source.
//
//   node fetch-facts.mjs --run 2026-08-15
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runDir, readJson, parseArgs, throttle, sleep, keyFor, SEC_UA } from "./lib/http.mjs";
import { ALT_CIKS } from "./lib/frozen.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function get(url, host = "data.sec.gov") {
  await throttle(host, 260);
  const res = await fetch(url, { headers: { "User-Agent": SEC_UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("usage: node fetch-facts.mjs [--run <id>] [--min-ms N]");
    process.exit(0);
  }
  const runId = args.runId;
  const population = await readJson(runId, "population.json");
  const seen = new Map();
  for (const c of population.companies) {
    if (!seen.has(c.cik)) seen.set(c.cik, c);
  }
  const targets = [...seen.values()];
  console.log(`targets: ${targets.length} distinct CIKs (${population.companies.length} tickers)`);

  const rawDir = path.join(runDir(runId), "raw");
  const manifestPath = path.join(rawDir, "fetch-manifest.json");
  let manifest = [];
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {}

  let done = 0;
  let failed = 0;
  for (const c of targets) {
    const dir = path.join(rawDir, c.cik);
    await fs.mkdir(dir, { recursive: true });
    const jobs = [
      { url: `https://data.sec.gov/submissions/CIK${c.cik.padStart(10, "0")}.json`, kind: "submissions", dest: path.join(dir, "submissions.json") },
      { url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik.padStart(10, "0")}.json`, kind: "companyfacts", dest: path.join(dir, "companyfacts.json") },
    ];
    if (ALT_CIKS[c.cik]) {
      jobs.push({
        url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${ALT_CIKS[c.cik].padStart(10, "0")}.json`,
        kind: "companyfacts-alt",
        dest: path.join(dir, `companyfacts-alt-${ALT_CIKS[c.cik]}.json`),
      });
    }
    for (const job of jobs) {
      let size = 0;
      try {
        size = (await fs.stat(job.dest)).size;
      } catch {}
      if (size > 0) continue; // checkpoint: already fetched
      let ok = false;
      for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
        try {
          const buf = await get(job.url);
          await fs.writeFile(job.dest, buf);
          manifest.push({
            cik: c.cik, kind: job.kind, url: job.url, status: 200,
            bytes: buf.length, fetched_at: new Date().toISOString(), sha256: sha256(buf), attempt,
          });
          ok = true;
        } catch (err) {
          if (attempt < 4 && (err.status === 429 || err.status >= 500 || !err.status)) {
            console.error(`  retry ${attempt + 1}/4 ${job.kind} ${c.ticker} (${err.message})`);
            await sleep(2000 * 2 ** (attempt - 1));
          } else {
            console.error(`  FAIL ${job.kind} ${c.ticker} (${c.cik}): ${err.message}`);
            failed++;
          }
        }
      }
      await sleep(args.minMs);
    }
    done++;
    if (done % 50 === 0 || done === targets.length) {
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1));
      console.log(`progress ${done}/${targets.length}  records=${manifest.length} failed=${failed}`);
    }
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`done. requests recorded=${manifest.length} failed=${failed}`);
  void keyFor;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
