#!/usr/bin/env node
// Fetch Berkshire Hathaway shareholder letters into sources/ as plain text.
//
// Why this script exists rather than a curl one-liner: the site serves
// brotli regardless of Accept-Encoding, and the 2004+ letters are PDFs.
// Both are handled here so the corpus stays greppable.
//
//   node fetch-sources.mjs           # fetch anything missing
//   node fetch-sources.mjs --force   # re-fetch everything
//   node fetch-sources.mjs --list    # show what would be fetched
//
// New letters are discovered from the site's own index, so running it
// again after Berkshire publishes one picks it up with no code change.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "sources");
const BASE = "https://www.berkshirehathaway.com";
const args = new Set(process.argv.slice(2));
const FORCE = args.has("--force");
const LIST = args.has("--list");

// ---------- fetch ----------

async function get(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// The CDN answers with content-encoding: br even when asked for identity.
// fetch() decodes br transparently; this is the belt-and-braces path for
// a body that arrives still compressed.
function decompress(buf) {
  for (const fn of [zlib.brotliDecompressSync, zlib.inflateSync, zlib.gunzipSync]) {
    try {
      const out = fn(buf);
      if (out.length) return out;
    } catch {}
  }
  return buf;
}

// The letters are written in Windows-1252, where 0x80-0x9F carry the
// curly quotes, dashes and ellipsis. Both input paths land there: the
// pre-1989 HTML pages are served in that encoding, and PDF content
// streams are read as latin1, which leaves the same bytes as control
// characters. Get this wrong and `it's` becomes `it<fffd>s` or
// `enduring "moat"` carries two unprintable bytes -- the phrase is then
// unfindable, which defeats the only purpose these files have.
const CP1252 = {
  0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†",
  0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹",
  0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“",
  0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜",
  0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž",
  0x9f: "Ÿ", 0x80: "€",
};

const fixEncoding = (s) => s.replace(/[\x80-\x9f]/g, (c) => CP1252[c.charCodeAt(0)] ?? " ");

// Decode a page body. UTF-8 first, since the modern pages are UTF-8; a
// replacement character means the guess was wrong, so fall back to
// Windows-1252 rather than shipping text with holes in it.
function decodeText(buf) {
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  return fixEncoding(buf.toString("latin1"));
}

// The letters are typeset to a fixed column width, so a sentence is
// split across several physical lines. grep is line-oriented, which means
// a quotation that spans a line break cannot be found -- and looking
// things up is the only reason this corpus exists. So rejoin each
// paragraph onto one line. Lines that look like ledger rows (multiple
// runs of whitespace, i.e. columns) are left alone, since flattening a
// table destroys more than it gains.
function unwrap(text) {
  const isTabular = (l) => /\S {2,}\S/.test(l) && /[\d.$%]/.test(l);
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split("\n").filter((l) => l.trim());
      if (!lines.length) return "";
      const tabular = lines.filter(isTabular).length;
      if (tabular * 2 >= lines.length) return lines.join("\n");
      return lines.map((l) => l.trim()).join(" ");
    })
    .filter(Boolean)
    .join("\n\n");
}

// ---------- html ----------

function htmlToText(buf) {
  let s = decodeText(decompress(buf));
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&[a-z]+;/gi, " ");
  return unwrap(
    s
      .split("\n")
      .map((l) => l.replace(/[^\S\n]+/g, " ").trimEnd())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ---------- pdf ----------

// Minimal text extraction: inflate the content streams and read the
// text-showing operators. The subtlety that matters for grep is that PDFs
// usually encode inter-word gaps as kerning numbers inside a TJ array
// rather than as space characters -- ignore those and the output comes out
// as "AcquisitionCriteria", which no search will ever match.
const GAP = 120; // kerning units below which a gap is a word break

function pdfToText(buf) {
  const chunks = [];
  let i = 0;
  while (true) {
    const s = buf.indexOf("stream", i);
    if (s < 0) break;
    const e = buf.indexOf("endstream", s);
    if (e < 0) break;
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    let dec = null;
    const raw = buf.subarray(start, e);
    for (const fn of [zlib.inflateSync, zlib.inflateRawSync]) {
      try {
        dec = fn(raw);
        break;
      } catch {}
    }
    if (dec) {
      const t = dec.toString("latin1");
      if (/\bT[Jj]\b/.test(t)) chunks.push(t);
    }
    i = e + 9;
  }

  const unescape = (lit) =>
    lit
      .replace(/\\([nrtbf])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" })[c])
      .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
      .replace(/\\(.)/g, (_, ch) => ch);

  let out = "";
  for (const stream of chunks) {
    // Split on text operators so positioning ops become line breaks.
    const re = /(\[(?:[^\[\]\\]|\\.)*\]\s*TJ)|(\((?:[^()\\]|\\.)*\)\s*Tj)|(T\*|TD|Td|'|")/g;
    let m;
    while ((m = re.exec(stream))) {
      if (m[1]) {
        // TJ array: string literals interleaved with kerning numbers.
        const body = m[1];
        const parts = body.match(/\((?:[^()\\]|\\.)*\)|-?\d+(?:\.\d+)?/g) || [];
        for (const p of parts) {
          if (p.startsWith("(")) out += unescape(p.slice(1, -1));
          else if (-parseFloat(p) >= GAP) out += " ";
        }
      } else if (m[2]) {
        out += unescape(m[2].slice(1, m[2].lastIndexOf(")")));
      } else {
        out += "\n";
      }
    }
    out += "\n";
  }

  return unwrap(
    fixEncoding(out)
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .filter((l, idx, a) => l || a[idx - 1])
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// ---------- targets ----------

async function discover() {
  const idx = htmlToText(await get(`${BASE}/letters/letters.html`));
  const raw = decompress(await get(`${BASE}/letters/letters.html`)).toString("utf8");
  const hrefs = [...raw.matchAll(/href="([^"]+\.(?:html|pdf))"/gi)].map((m) => m[1]);
  const seen = new Map();
  for (const h of hrefs) {
    const y = h.match(/(19|20)\d\d/);
    if (!y) continue;
    const year = y[0];
    if (!seen.has(year)) seen.set(year, `${BASE}/letters/${h.replace(/^\.?\//, "")}`);
  }
  if (!seen.size) throw new Error("no letters found on index page - layout changed?");
  void idx;
  return [...seen.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, url]) => ({ name: `${year}.txt`, url }));
}

// The 1998-2003 pages are landing pages offering an HTML and a PDF
// edition rather than the letter itself. Detect that by how little text
// came out, then follow to the real document -- preferring the HTML
// edition, which extracts more cleanly than the PDF.
async function extract(url, depth = 0) {
  const buf = await get(url);
  const isPdf = url.toLowerCase().endsWith(".pdf");
  const text = isPdf ? pdfToText(buf) : htmlToText(buf);
  if (text.length >= 5000 || isPdf || depth > 1) return text;

  const raw = decompress(buf).toString("utf8");
  const links = [...raw.matchAll(/href="([^"]+\.(?:html?|pdf))"/gi)]
    .map((m) => new URL(m[1], url).href)
    .filter((u) => u !== url && !/adobe/i.test(u));
  const next =
    links.find((u) => /(htm\.html|letter\.html)$/i.test(u)) ||
    links.find((u) => /\.html?$/i.test(u)) ||
    links.find((u) => /\.pdf$/i.test(u));
  if (!next) return text;
  console.log(`        follow -> ${next.replace(BASE, "")}`);
  return extract(next, depth + 1);
}

const EXTRA = [
  { name: "owners-manual.txt", url: `${BASE}/owners.html` },
  // Anchor on a phrase unique to the criteria themselves. Searching for
  // the heading finds the table of contents first, which lists it with a
  // page number and none of the content.
  { name: "acquisition-criteria-2017.txt", url: `${BASE}/2017ar/2017ar.pdf`, slice: "Demonstrated consistent earning power" },
];

// ---------- run ----------

const targets = [...(await discover()), ...EXTRA];

if (LIST) {
  for (const t of targets) console.log(`${t.name}\t${t.url}`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });

let fetched = 0,
  skipped = 0,
  failed = 0;

for (const t of targets) {
  const dest = join(OUT, t.name);
  if (!FORCE && existsSync(dest) && statSync(dest).size > 1000) {
    skipped++;
    continue;
  }
  try {
    let text = await extract(t.url);
    if (t.slice) {
      const i = text.toUpperCase().indexOf(t.slice.toUpperCase());
      if (i < 0) throw new Error(`anchor "${t.slice}" not found`);
      // Window around the anchor. The anchor is a phrase unique to the
      // criteria themselves: the heading also appears in the table of
      // contents hundreds of pages earlier, and a looser phrase like
      // "large purchases" occurs in the letter's own prose.
      text = text.slice(Math.max(0, i - 700), i + 2200);
    }
    if (text.length < 500) throw new Error(`extracted only ${text.length} chars`);
    writeFileSync(dest, `Source: ${t.url}\nRetrieved by fetch-sources.mjs\n\n${text}\n`);
    console.log(`  ok    ${t.name}  ${(text.length / 1024).toFixed(0)}KB`);
    fetched++;
  } catch (err) {
    console.error(`  FAIL  ${t.name}  ${err.message}`);
    failed++;
  }
}

console.log(`\ndone  fetched=${fetched} skipped=${skipped} failed=${failed}  ->  ${OUT}`);
if (failed) process.exitCode = 1;
