import { readFileSync, writeFileSync } from "node:fs";
const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, from = 0, until = buf.length, max = 15) {
  const n = Buffer.from(needle);
  const out = [];
  let i = from;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0 || j >= until) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

function around(i, before, after) {
  return ascii(
    buf
      .subarray(Math.max(0, i - before), Math.min(buf.length, i + after))
      .toString("latin1"),
  );
}

const lines = [];

for (const n of [
  "function HG(",
  "function L7(",
  "HG(e)",
  "L7(e)",
  "FRONTMATTER",
  "^---",
  "function parseFrontmatter",
  "---\\s*\\n",
  "charCodeAt(0)===65279?e.slice(1)",
  "function GCe(e,t)",
  "kind:\"main\"",
  "kind:\"teammate\"",
  "kind:\"cloud\"",
  "teammates on your team",
  "V1w",
  "function V1w",
]) {
  const hs = hits(n);
  lines.push(`#### "${n}" [${hs.join(",")}]`);
  for (const i of hs.slice(0, 3)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 120, 280));
  }
}

// Full GCe from 303699654
lines.push("\n==== GCe 303699654 ====\n");
lines.push(around(303699654, 80, 3500));

// HG at 305142126
lines.push("\n==== HG 305142126 ====\n");
lines.push(around(305142126, 400, 2500));

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-continue20b.txt",
  lines.join("\n"),
);
console.log("ok");
