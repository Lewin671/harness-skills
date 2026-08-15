#!/usr/bin/env node
// Check every quotation in the doctrine canon against the corpus.
//
//   node verify-citations.mjs          # report misses, exit 1 if any
//   node verify-citations.mjs --list   # print each quotation and its verdict
//
// doctrine.md promises that quoted text keeps the source's punctuation so
// it can be pasted straight into a literal search. That promise decays
// the moment someone edits a quotation for readability -- straightening a
// curly apostrophe, converting a hyphen to an em dash, or folding a
// markdown emphasis marker into the quoted span. Each of those reads
// better and quietly makes the citation uncheckable, which is the exact
// failure this skill exists to prevent. So the promise is executable.
//
// Limits worth knowing: this proves a quoted string appears somewhere in
// the corpus, not that it appears in the letter the row names, and not
// that the surrounding claim is a fair reading of it. It is a floor
// against fabricated and mangled quotations, not a substitute for
// reading the source.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIST = process.argv.includes("--list");

const doc = readFileSync(join(HERE, "references/doctrine.md"), "utf8");

const dir = join(HERE, "sources");
const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
if (!files.length) {
  console.error(`no corpus in ${dir} -- run: node fetch-sources.mjs`);
  process.exit(2);
}
const corpus = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));

// Every quoted span in the file, not only the canon table: the promise
// in doctrine.md covers the whole document, and a quotation in the prose
// is exactly as citable as one in a row. Short spans are ordinary prose
// ("moat", "enduring") rather than citations.
// Prose is hard-wrapped, so a quotation routinely straddles a newline.
// Matching line by line silently skips those -- rejoin each paragraph
// first, keeping table rows intact since each is its own record.
const lines = [];
for (const raw of doc.split("\n")) {
  const prev = lines[lines.length - 1];
  const mergeable = prev && prev.text.trim() && !prev.text.startsWith("|") && raw.trim() && !raw.startsWith("|") && !raw.startsWith("#") && !/^\s*[-*>]/.test(raw);
  if (mergeable) prev.text += " " + raw.trim();
  else lines.push({ text: raw, n: lines.length + 1 });
}

let ok = 0;
const misses = [];

for (const { text: line, n } of lines) {
  const label = line.startsWith("|") ? line.split("|")[1]?.trim() : `para ${n}`;
  for (const m of line.matchAll(/"([^"]{25,})"/g)) {
    // An ellipsis marks an omission, so no single literal spans the whole
    // quotation. Check **every** fragment: verifying only the longest
    // lets anything on the short side of an ellipsis drift unnoticed.
    const fragments = m[1]
      .split(/\s*…\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 12);
    if (!fragments.length) continue;
    // One file must contain *all* the fragments. Checking each fragment
    // against the corpus as a whole would let a quotation assembled from
    // two different letters pass as a single citation.
    const hit = Object.entries(corpus).find(([, t]) => fragments.every((f) => t.includes(f)));
    if (hit) {
      ok++;
      if (LIST) console.log(`  ok    [${label}] -> ${hit[0]}`);
    } else {
      const bad = fragments.filter((f) => !Object.values(corpus).some((t) => t.includes(f)));
      misses.push({ label, bad: bad.length ? bad : fragments, split: !bad.length });
    }
  }
}

for (const { label, bad, split } of misses) {
  console.error(`  MISS  [${label}]${split ? "  (fragments found, but not together in one source)" : ""}`);
  for (const f of bad) console.error(`        ${JSON.stringify(f.slice(0, 96))}`);
}

console.log(`\n${ok} of ${ok + misses.length} canon quotations found in the corpus`);
if (misses.length) {
  console.error(
    "\nA miss means the quotation was edited away from the source, or the\n" +
      "attribution is wrong. Fix the quotation to match the letter -- do not\n" +
      "relax this check."
  );
  process.exitCode = 1;
}
