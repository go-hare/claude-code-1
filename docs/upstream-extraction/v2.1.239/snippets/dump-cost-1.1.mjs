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
function around(i, b, a) {
  return ascii(
    buf.subarray(Math.max(0, i - b), Math.min(buf.length, i + a)).toString("latin1"),
  );
}
const needles = [
  "function tWb",
  "e.inference_geo===\"us\"",
  "inference_geo===\"us\"",
  "var eWb",
  "eWb=",
  "function ima",
  "function Q4b",
  "function sma",
  "US-only",
  "us-only",
  "data residency",
  "inference geo",
  "residency premium",
  "1.1\u00d7",
  "1.1x premium",
  "cost * 1.1",
  "*eWb",
  "tWb(",
  "updateCodeSession",
  "lastPatchedTitle",
  "titleAtMs",
  "TITLE_PATCH",
  "titleThrottle",
  "throttleTitle",
  "dedupeTitle",
  "same title",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  for (const i of hs.slice(0, 2)) {
    const big = n.includes("tWb") || n.includes("ima") || n.includes("eWb") || n.includes("sma") || n.includes("Q4b") || n.includes("inference_geo");
    lines.push(`--- ${i} ---`);
    lines.push(around(i, big ? 80 : 60, big ? 1400 : 400));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-cost-1.1.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
