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
  "function I8r",
  "function H8r",
  "function e5(",
  "function jTi",
  "function zTi",
  "function wNe",
  "ZGn(",
  "reloadCustomThemes",
  "IDE diagnostics fetch timed out",
  "isJetBrainsIdeTerminal",
  "jediterm",
  "JediTerm",
];
const lines = [];
for (const n of needles) {
  const hs = hits(n);
  lines.push(`#### "${n}" count=${hs.length} [${hs.slice(0, 8).join(",")}]`);
  const big = n.startsWith("function") || n === "ZGn(";
  for (const i of hs.slice(0, 2)) {
    lines.push(`--- ${i} ---`);
    lines.push(around(i, 80, big ? 2200 : 800));
  }
}
writeFileSync(
  "docs/upstream-extraction/v2.1.239/snippets/gold-u18c.txt",
  lines.join("\n"),
);
console.log("ok", lines.length);
