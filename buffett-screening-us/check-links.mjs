#!/usr/bin/env node
// Check that every relative markdown link in this skill resolves.
//
//   node check-links.mjs
//
// SKILL.md points at layered docs as the place the US specifics live;
// a broken link quietly strands the content behind it. Scan SKILL.md
// and references/ for [text](target) links, skip external URLs and bare
// anchors, resolve each target against the file that contains it, and
// fail on a miss. A miss means the target file was renamed, moved, or
// deleted -- fix the link, do not add exceptions.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const files = ["SKILL.md"];
for (const sub of ["references"]) {
  const dir = join(HERE, sub);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".md")) files.push(join(sub, f));
  }
}

let ok = 0;
const misses = [];

for (const name of files) {
  const text = readFileSync(join(HERE, name), "utf8");
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = target.split("#")[0];
    if (!path) continue;
    const resolved = resolve(dirname(join(HERE, name)), path);
    if (existsSync(resolved)) ok++;
    else misses.push(`${name}: ${target} -> ${resolved}`);
  }
}

console.log(`${ok} internal links resolve`);
for (const miss of misses) {
  console.error(`  MISS  ${miss}`);
}
if (misses.length) {
  console.error("\nA miss means a link points at a file that does not exist. Fix the target; do not add exceptions.");
  process.exitCode = 1;
}
