// Shared HTTP + checkpoint machinery for the A-share fetch scripts.
// No dependencies beyond Node's built-ins. Every stored raw body keeps
// its URL, fetch time, and any stage metadata — the doctrine contract
// requires a figure to walk back to a stored record.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const EASTMONEY_REFERER = "https://data.eastmoney.com/";
export const CNINFO_REFERER = "http://www.cninfo.com.cn/";

// Version of the endpoint/field mapping this build was written against.
// Recorded on every stored raw body so a derived figure can always
// state which mapping produced it.
export const MAPPING_VERSION = "2026-08-15.1";

// ---------- rate limiting ----------

const lastStart = new Map(); // host -> timestamp of last request start

export async function throttle(host, minMs = 300) {
  const prev = lastStart.get(host) ?? 0;
  const wait = Math.max(0, prev + minMs - Date.now());
  if (wait > 0) await sleep(wait);
  lastStart.set(host, Date.now());
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- retrying fetch ----------

export async function fetchText(url, { headers = {}, method = "GET", body, retries = 4, minMs = 300, timeoutMs = 30000, host } = {}) {
  const h = host ?? new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    await throttle(h, minMs);
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": UA, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return await res.text();
      // 429/5xx are retryable; other statuses are terminal for this key.
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${url}`);
        continue;
      }
      throw new Error(`HTTP ${res.status} for ${url}`);
    } catch (err) {
      // Terminal HTTP statuses rethrow; network errors are retryable.
      if (err instanceof Error && err.message.startsWith("HTTP")) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

export async function fetchBuffer(url, opts = {}) {
  const { headers = {}, minMs = 300, timeoutMs = 60000, host } = opts;
  const h = host ?? new URL(url).host;
  await throttle(h, minMs);
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
}

function backoffMs(attempt) {
  // exponential with jitter, capped at 30s
  const base = Math.min(30000, 500 * 2 ** attempt);
  return base / 2 + Math.random() * base;
}

// ---------- checkpointed raw storage ----------

// Run storage lives outside the skill tree: default
// ~/.buffett-screening/ashare/<runId>/ (per-user, shared across harness
// installs so checkpoints resume anywhere). Override the family root
// with the BUFFETT_RUNS_DIR env var; this adapter appends its name.
// Structure: <runId>/raw/<key>.json — one record per key.
// saveRaw is atomic (tmp + rename) so a killed run never leaves a
// half-written record; loadRaw is the resume predicate.
export function runDir(runId) {
  const root = process.env.BUFFETT_RUNS_DIR ?? path.join(os.homedir(), ".buffett-screening");
  return path.resolve(root, "ashare", runId);
}

export function keyFor(parts) {
  return parts.map((p) => String(p).replaceAll("/", "_")).join("__");
}

export async function loadRaw(runId, key) {
  const file = path.join(runDir(runId), "raw", `${key}.json`);
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function saveRaw(runId, key, { url, body, meta = {} }) {
  const file = path.join(runDir(runId), "raw", `${key}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(
    tmp,
    JSON.stringify(
      {
        url,
        fetched_at: new Date().toISOString(),
        mapping_version: MAPPING_VERSION,
        meta,
        body,
      },
      null,
      1,
    ),
  );
  await fs.rename(tmp, file);
}

export async function writeJson(runId, name, value) {
  const file = path.join(runDir(runId), name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 1));
  await fs.rename(tmp, file);
}

export async function readJson(runId, name) {
  return JSON.parse(await fs.readFile(path.join(runDir(runId), name), "utf8"));
}

export function asOf() {
  const d = new Date();
  return d.toISOString().slice(0, 10).replaceAll("-", "-");
}

// Parse --run <id> / --help style args.
export function parseArgs(argv) {
  const args = { runId: new Date().toISOString().slice(0, 10), positionals: [], minMs: 300 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run" || a === "-r") args.runId = argv[++i];
    else if (a === "--min-ms") args.minMs = Number(argv[++i]);
    else if (a === "--help" || a === "-h") args.help = true;
    else args.positionals.push(a);
  }
  return args;
}

export function fiscalYears(asOfIso, count, extraPrior = 1) {
  // Completed CAS fiscal years (calendar years) ending before the
  // as-of year, ascending: the window years plus one prior year for
  // opening balances.
  const asOfYear = Number(asOfIso.slice(0, 4));
  const years = [];
  for (let i = count + extraPrior - 1; i >= 0; i--) years.push(asOfYear - 1 - i);
  return years;
}
