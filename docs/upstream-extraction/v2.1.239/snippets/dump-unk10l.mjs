import { readFileSync, writeFileSync } from "node:fs";

const exe = process.env.TEMP + "\\official-239\\package\\claude.exe";
const buf = readFileSync(exe);

function ascii(s) {
  return s.replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ".");
}

function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}

function hits(needle, max = 4) {
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

const lines = [];
lines.push("==== hook exec before ies ====");
lines.push(around(317132044, 2500, 200));

lines.push("==== function Ry ====");
for (const n of ["async function Ry(", "function Ry("]) {
  const hs = hits(n);
  lines.push(`${n} ${hs.join(",")}`);
  for (const i of hs.slice(0, 2)) lines.push(around(i, 40, 400));
}

writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-unk10l.txt",
  lines.join("\n"),
);
console.log("ok");
