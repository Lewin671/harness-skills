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
const canon = doc.split("## Primary-Source Canon")[1]?.split("\n## ")[0];
if (!canon) {
  console.error("could not find the canon table in references/doctrine.md");
  process.exit(2);
}

const dir = join(HERE, "sources");
const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));
if (!files.length) {
  console.error(`no corpus in ${dir} -- run: node fetch-sources.mjs`);
  process.exit(2);
}
const corpus = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));

const rows = canon.split("\n").filter((l) => l.startsWith("|")).slice(2);
let ok = 0;
const misses = [];

for (const row of rows) {
  const cells = row.split("|");
  const label = cells[1]?.trim() ?? "?";
  // Quotations are the double-quoted spans; short ones are ordinary prose
  // ("moat"), not citations.
  for (const m of row.matchAll(/"([^"]{25,})"/g)) {
    // An ellipsis marks an omission, so no single literal spans it --
    // check the longest fragment, which is what doctrine.md tells a
    // reader to search on.
    const fragment = m[1]
      .split(/\s*…\s*/)
      .map((s) => s.trim())
      .reduce((a, b) => (b.length > a.length ? b : a));
    const hit = Object.entries(corpus).find(([, text]) => text.includes(fragment));
    if (hit) {
      ok++;
      if (LIST) console.log(`  ok    [${label}] -> ${hit[0]}`);
    } else {
      misses.push({ label, fragment });
    }
  }
}

for (const { label, fragment } of misses) {
  console.error(`  MISS  [${label}]`);
  console.error(`        ${JSON.stringify(fragment.slice(0, 100))}`);
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
