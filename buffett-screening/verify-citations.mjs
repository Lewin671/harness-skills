#!/usr/bin/env node
// Check every citation claim in references/ against the primary-source
// corpus in sources/.
//
//   node verify-citations.mjs          # report misses, exit 1 if any
//   node verify-citations.mjs --list   # print each verdict
//
// Three tiers, strongest first:
//
// 1. Canon table rows in doctrine.md. Each canon row names exactly one
//    source — where two documents are quoted, the row is split in two —
//    so the checker can hold every quotation in a row (the Position
//    cell and the Source cell alike) to that single file: fragments in
//    order, no overlap. This is the per-letter check, not mere corpus
//    membership.
//
// 2. Everywhere else. Quotations in doctrine.md prose and in the other
//    reference files must appear somewhere in the corpus. Those files
//    also quote required output wording ("cheap", "guaranteed", "has no
//    such history") that is not a citation; each such span is registered
//    in WORDING below. An unregistered span that matches nothing is a
//    miss — deny by default, so a new quotation cannot enter these files
//    unvetted.
//
// 3. Assertions. Fixed facts about the corpus that the misattribution
//    and corrected-attribution sections of doctrine.md depend on (the
//    15% goal, the circle-of-competence vintage, the intrinsic-value
//    definition, the acquisition-scale clauses). Checked even when no
//    quotation happens to reference them.
//
// Limits worth knowing: this proves a quoted string appears in the named
// file (tier 1) or in the corpus (tier 2), not that the surrounding
// claim is a fair reading of it. It is a floor against fabricated and
// mangled quotations, not a substitute for reading the source.
//
// The quotation-detection promise is documented in doctrine.md: quoted
// text keeps the source's own punctuation, including curly apostrophes
// and the scare quotes around terms like “moat”, so a quotation can be
// pasted straight into a literal search. That promise decays the moment
// someone edits a quotation for readability — straightening a curly
// apostrophe, converting a hyphen to an em dash, or folding a markdown
// emphasis marker into the quoted span. Each of those reads better and
// quietly makes the citation uncheckable, which is the exact failure
// this skill exists to prevent. So the promise is executable.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIST = process.argv.includes("--list");

const REFS = join(HERE, "references");
const SOURCES = join(HERE, "sources");

const corpusFiles = readdirSync(SOURCES).filter((f) => f.endsWith(".txt"));
if (!corpusFiles.length) {
  console.error(`no corpus in ${SOURCES} -- run: node fetch-sources.mjs`);
  process.exit(2);
}
const corpus = Object.fromEntries(
  corpusFiles.map((f) => [f, readFileSync(join(SOURCES, f), "utf8")])
);

// ---------- shared mechanics ----------

// Prose is hard-wrapped, so a quotation routinely straddles a newline.
// Matching line by line silently skips those -- rejoin each paragraph
// first, keeping table rows intact since each is its own record.
function paragraphs(doc) {
  const lines = [];
  for (const raw of doc.split("\n")) {
    const prev = lines[lines.length - 1];
    const mergeable =
      prev && prev.text.trim() && !prev.text.startsWith("|") &&
      raw.trim() && !raw.startsWith("|") && !raw.startsWith("#") &&
      !/^\s*[-*>]/.test(raw);
    if (mergeable) prev.text += " " + raw.trim();
    else lines.push({ text: raw, n: lines.length + 1 });
  }
  return lines;
}

// Every double-quoted span is a citation claim, including short ones
// like "An offering price". A length floor here is not a filter on
// prose, it is a hole: whatever sits under it can be corrupted later
// and still pass. Anything that is not a citation claim must therefore
// avoid double quotes (or be registered in WORDING) rather than rely on
// being short.
const QUOTE = /"([^"]{4,})"/g;
const spansOf = (line) => [...line.matchAll(QUOTE)].map((m) => m[1]);

// An ellipsis marks an omission, so no single literal spans the whole
// quotation. Every fragment is checked, at any length.
const splitFragments = (span) =>
  span.split(/\s*…\s*/).map((s) => s.trim()).filter(Boolean);

// All the fragments must appear, in order and without overlap. Checking
// membership alone would accept a quotation assembled from two different
// letters, or one whose clauses were reordered into a sentence Buffett
// never wrote.
function findIn(text, fragments) {
  let from = 0;
  for (const f of fragments) {
    const at = text.indexOf(f, from);
    if (at < 0) return false;
    from = at + f.length;
  }
  return true;
}

// Resolve the sources a table row names, in the order they appear.
// "Acquisition criteria, 2017 annual report p. 23" must land in the
// criteria file, not the 2017 shareholder letter.
function namedFiles(sourceCell) {
  return sourceCell
    .split(";")
    .map((part) => {
      if (/acquisition criteria/i.test(part)) return "acquisition-criteria-2017.txt";
      if (/owner'?s manual/i.test(part)) return "owners-manual.txt";
      const y = part.match(/(19|20)\d\d/);
      return y ? `${y[0]}.txt` : null;
    })
    .filter(Boolean);
}

const checks = []; // { label, verdict, detail }

// ---------- tier 1: canon table rows, against the first named letter ----------

const doctrine = readFileSync(join(REFS, "doctrine.md"), "utf8");
const tier1Lines = new Set();

for (const { text: line } of paragraphs(doctrine)) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  // A canon row carries Element, Position and Source; the Numbers table
  // has no Source cell and is not a per-letter claim.
  if (cells.length < 5) continue;
  const element = cells[1];
  if (!element || element === "Element" || /^:?-+:?$/.test(element)) continue;
  const position = cells[2];
  const source = cells[3];
  tier1Lines.add(line);

  const files = namedFiles(source ?? "");
  if (!files.length) {
    checks.push({ label: `doctrine.md row “${element}”`, verdict: "MISS", detail: "row names no resolvable source file" });
    continue;
  }
  const target = corpus[files[0]];
  if (!target) {
    checks.push({ label: `doctrine.md row “${element}”`, verdict: "MISS", detail: `named file ${files[0]} missing from sources/` });
    continue;
  }
  for (const cell of [position, source]) {
    for (const span of spansOf(cell ?? "")) {
      const fragments = splitFragments(span);
      if (!fragments.length) continue;
      const found = findIn(target, fragments);
      checks.push({
        label: `doctrine.md row “${element}”`,
        verdict: found ? "ok" : "MISS",
        detail: found
          ? `${files[0]}${files.length > 1 ? ` (first of: ${files.join(", ")})` : ""}`
          : `not in ${files[0]}${files.length > 1 ? ` (row names: ${source})` : ""}`,
      });
    }
  }
}

// ---------- tier 2: everything else, against the corpus ----------

// Quoted spans in the non-doctrine reference files that are required
// output wording rather than citations. Registering them here is the
// alternative to matching the corpus; anything unregistered must match
// or fail.
const WORDING = {
  "criteria.md": [
    "Non-cash",
    "passes a stress test",
    "unmeasurable leaves the gate `unknown`",
    "competent",
    "cheap",
  ],
  "adjudication.md": ["has no such history", "has any row"],
  "pruning.md": [
    "this is pruning, not sampling",
    "One-sided",
    "guaranteed",
    "Loses",
    "no cutoff yet",
    "fetch everything",
    "fetch everything whose bound is 100",
    "every other gate `pass`",
  ],
  "applicability.md": [
    "this screen has no valid insurance model",
    "insurance fails Buffett's criteria",
  ],
};

const TIER2 = ["doctrine.md", "criteria.md", "adjudication.md", "applicability.md", "pruning.md"];

for (const name of TIER2) {
  const doc = readFileSync(join(REFS, name), "utf8");
  for (const { text: line } of paragraphs(doc)) {
    if (name === "doctrine.md" && tier1Lines.has(line)) continue; // tier 1
    for (const span of spansOf(line)) {
      const fragments = splitFragments(span);
      if (!fragments.length) continue;
      const inCorpus = Object.values(corpus).some((t) => findIn(t, fragments));
      const registered = (WORDING[name] ?? []).includes(span);
      checks.push({
        label: `${name} quotation`,
        verdict: inCorpus || registered ? "ok" : "MISS",
        detail: inCorpus
          ? "in corpus"
          : registered
            ? "registered wording"
            : `matches nothing in the corpus and is not registered as wording: ${JSON.stringify(span.slice(0, 96))}`,
      });
    }
  }
}

// ---------- tier 3: fixed assertions the doctrine depends on ----------

// Each entry pins a claim made in doctrine.md (or a citation in the
// other references) to the file it names. Keep these in sync with the
// prose they pin: if the prose changes, this list must change with it.
const ASSERTIONS = [
  { label: "doctrine.md §Misattributed Thresholds — 15% is Berkshire's own objective", file: "1993.txt", must: ["our long-standing goal of increasing Berkshire's per-share intrinsic value at an average annual rate of 15%"] },
  { label: "doctrine.md §Corrected Attributions — circle of competence is in the 1996 letter", file: "1996.txt", must: ["circle of competence"] },
  { label: "doctrine.md §Corrected Attributions — circle of competence is not in the 1992 letter", file: "1992.txt", mustNot: ["circle of competence"] },
  { label: "doctrine.md §Corrected Attributions — intrinsic-value definition is in the Owner's Manual", file: "owners-manual.txt", must: ["the discounted value of the cash that can be taken out of a business during its remaining life"] },
  { label: "doctrine.md §Corrected Attributions — intrinsic-value definition is not in the 1992 letter", file: "1992.txt", mustNot: ["the discounted value of the cash that can be taken out"] },
  { label: "doctrine.md §What Must Not Be Copied — the document rules out stock-market use", file: "acquisition-criteria-2017.txt", must: ["We are not interested, however, in receiving suggestions about purchases we might make in the general stock market."] },
  { label: "doctrine.md §What Must Not Be Copied — acquisition-scale clauses", file: "acquisition-criteria-2017.txt", must: ["75 million", "5-20 billion"] },
  { label: "doctrine.md §What Must Not Be Copied — technology clause names the buyer", file: "acquisition-criteria-2017.txt", must: ["Simple businesses (if there’s lots of technology, we won’t understand it)"] },
  { label: "criteria.md gate 6 — management clause is in the 1977 letter", file: "1977.txt", must: ["operated by honest and competent people"] },
  { label: "criteria.md gate 7 — margin of safety is in the 1992 letter", file: "1992.txt", must: ["we insist on a margin of safety in our purchase price"] },
  { label: "criteria.md §Owner earnings — maintenance capex is a guess (1986)", file: "1986.txt", must: ["must be a guess - and one sometimes very difficult to make"] },
  { label: "criteria.md §Intrinsic Value — growth can destroy value (2000)", file: "2000.txt", must: ["growth can destroy value if it requires cash inputs"] },
];

for (const a of ASSERTIONS) {
  const text = corpus[a.file];
  if (!text) {
    checks.push({ label: a.label, verdict: "MISS", detail: `${a.file} missing from sources/` });
    continue;
  }
  for (const s of a.must ?? []) {
    const found = text.includes(s);
    checks.push({
      label: a.label,
      verdict: found ? "ok" : "MISS",
      detail: found
        ? `${a.file} has it`
        : `${a.file} lacks ${JSON.stringify(s.slice(0, 90))}`,
    });
  }
  for (const s of a.mustNot ?? []) {
    const found = text.includes(s);
    checks.push({
      label: a.label,
      verdict: !found ? "ok" : "MISS",
      detail: !found
        ? `absent from ${a.file}`
        : `${a.file} contains ${JSON.stringify(s.slice(0, 90))}`,
    });
  }
}

// ---------- report ----------

const okCount = checks.filter((c) => c.verdict === "ok").length;
const missCount = checks.length - okCount;

if (LIST) {
  for (const c of checks) {
    console.log(`  ${c.verdict === "ok" ? "ok   " : "MISS "} [${c.label}] ${c.detail}`);
  }
}

console.log(
  `\n${okCount} of ${checks.length} checks passed (canon rows against their named letter, other quotations against the corpus, fixed assertions)`
);
if (missCount) {
  for (const c of checks.filter((c) => c.verdict !== "ok")) {
    console.error(`  MISS  [${c.label}] ${c.detail}`);
  }
  console.error(
    "\nA miss means the quotation was edited away from the source, or the\n" +
      "attribution is wrong. Fix the quotation to match the letter -- do not\n" +
      "relax this check."
  );
  process.exitCode = 1;
}
