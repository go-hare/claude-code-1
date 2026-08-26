import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function hits(needle, max = 8) {
  const n = Buffer.from(needle);
  const out = [];
  let i = 0;
  while (out.length < max) {
    const j = buf.indexOf(n, i);
    if (j < 0) break;
    out.push(j);
    i = j + 1;
  }
  return out;
}

const needles = [
  "function nxh",
  "function rxh",
  "nxh=",
  "rxh=",
];

const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(ascii(buf.subarray(Math.max(0, i - 40), i + 1800).toString("latin1")));
  }
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-plan13e.txt",
  lines.join("\n"),
);
console.log("ok");
